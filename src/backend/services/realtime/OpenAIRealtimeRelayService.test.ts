import {
    createServer,
    type IncomingMessage,
    type Server as HttpServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { checkRateLimit } from '../../core/http/middleware/rateLimit.js';
import { withAiCostFactorHook } from '../../drivers/integrationTestUtil';
import type { IConfig } from '../../types';
import type { PuterServer } from '../../server';
import { installSeatStub } from '../../testFixtures/seatStub';
import {
    allocateEphemeralPort,
    createTestUser,
    setupTestServer,
    type TestUserCredentials,
} from '../../testUtil';
import { kv } from '../../util/kvSingleton';
import {
    MAX_REALTIME_MESSAGE_BYTES,
    MAX_UPSTREAM_MESSAGE_BYTES,
    OpenAIRealtimeRelayService,
    REALTIME_PATH,
    type RealtimeUsage,
    type RealtimeTranscriptionUsage,
    realtimeAuthKey,
    realtimeBillingModel,
    realtimeConnectKey,
    realtimeTokenFrom,
    realtimeTranscriptionRows,
    realtimeUsageRows,
} from './OpenAIRealtimeRelayService';

const reqWith = (headers: Record<string, string>) => ({ headers });

describe('realtimeTokenFrom', () => {
    const url = new URL('http://x/?auth_token=from-query');

    it('prefers the Authorization header', () => {
        const req = reqWith({ authorization: 'Bearer from-header' });
        expect(realtimeTokenFrom(req, url)).toBe('from-header');
    });

    it("reads OpenAI's browser key subprotocol", () => {
        const req = reqWith({
            'sec-websocket-protocol':
                'realtime, openai-insecure-api-key.from-protocol',
        });
        expect(realtimeTokenFrom(req, url)).toBe('from-protocol');
    });

    it('falls back to auth_token, then nothing', () => {
        expect(realtimeTokenFrom(reqWith({}), url)).toBe('from-query');
        expect(realtimeTokenFrom(reqWith({}), new URL('http://x/'))).toBe(
            undefined,
        );
    });
});

describe('realtimeUsageRows', () => {
    it('prices uncached and cached tokens per modality', () => {
        const rows = realtimeUsageRows('gpt-realtime-mini', {
            input_token_details: {
                text_tokens: 100,
                audio_tokens: 50,
                cached_tokens_details: { text_tokens: 40 },
            },
            output_token_details: { text_tokens: 10, audio_tokens: 20 },
        });
        expect(rows).toEqual([
            {
                usageType: 'openai:gpt-realtime-mini:realtime:text_input',
                usageAmount: 60,
                costOverride: 60 * 60,
            },
            {
                usageType: 'openai:gpt-realtime-mini:realtime:text_cached',
                usageAmount: 40,
                costOverride: 40 * 6,
            },
            {
                usageType: 'openai:gpt-realtime-mini:realtime:audio_input',
                usageAmount: 50,
                costOverride: 50 * 1000,
            },
            {
                usageType: 'openai:gpt-realtime-mini:realtime:text_output',
                usageAmount: 10,
                costOverride: 10 * 240,
            },
            {
                usageType: 'openai:gpt-realtime-mini:realtime:audio_output',
                usageAmount: 20,
                costOverride: 20 * 2000,
            },
        ]);
    });

    it('returns nothing for an unknown model or missing usage', () => {
        expect(realtimeUsageRows('constructor', {})).toEqual([]);
        expect(realtimeUsageRows('gpt-4o', {})).toEqual([]);
        expect(realtimeUsageRows('gpt-realtime', undefined)).toEqual([]);
    });
});

describe('realtimeTranscriptionRows', () => {
    it('prices token usage by transcription model', () => {
        const rows = realtimeTranscriptionRows('gpt-4o-mini-transcribe', {
            type: 'tokens',
            input_tokens: 30,
            input_token_details: { text_tokens: 10, audio_tokens: 20 },
            output_tokens: 5,
        });
        expect(rows.map((r) => [r.usageType, r.costOverride])).toEqual([
            [
                'openai:gpt-4o-mini-transcribe:realtime:transcription_text_input',
                10 * 125,
            ],
            [
                'openai:gpt-4o-mini-transcribe:realtime:transcription_audio_input',
                20 * 300,
            ],
            [
                'openai:gpt-4o-mini-transcribe:realtime:transcription_text_output',
                5 * 500,
            ],
        ]);
    });

    it('prices duration usage per second', () => {
        expect(
            realtimeTranscriptionRows('whisper-1', {
                type: 'duration',
                seconds: 2.5,
            }),
        ).toEqual([
            {
                usageType: 'openai:whisper-1:realtime:transcription_seconds',
                usageAmount: 2.5,
                costOverride: 25_000,
            },
        ]);
    });

    it('bills an unknown model at the highest known rate', () => {
        const [row] = realtimeTranscriptionRows(undefined, {
            type: 'tokens',
            input_tokens: 10,
        });
        expect(row).toEqual({
            usageType: 'openai:unknown:realtime:transcription_audio_input',
            usageAmount: 10,
            costOverride: 10 * 600,
        });
    });
});

describe('realtimeBillingModel', () => {
    it('bills the model the session reports, dated snapshots included', () => {
        expect(
            realtimeBillingModel(
                { model: 'gpt-realtime' },
                'gpt-realtime-mini',
            ),
        ).toBe('gpt-realtime');
        expect(
            realtimeBillingModel(
                { model: 'gpt-realtime-mini-2025-10-06' },
                'gpt-realtime',
            ),
        ).toBe('gpt-realtime-mini');
    });

    it('keeps the connection model when the session reports none we price', () => {
        expect(realtimeBillingModel({}, 'gpt-realtime-mini')).toBe(
            'gpt-realtime-mini',
        );
        expect(
            realtimeBillingModel({ model: 'gpt-9' }, 'gpt-realtime-mini'),
        ).toBe('gpt-realtime-mini');
        expect(realtimeBillingModel(null, 'gpt-realtime')).toBe('gpt-realtime');
    });
});

describe('OpenAIRealtimeRelayService relay', () => {
    let server: PuterServer;
    let upstream: WebSocketServer;
    let user: TestUserCredentials;
    let relayUrl: string;
    const upstreamRequests: IncomingMessage[] = [];
    const upstreamEvents: {
        type: string;
        response_id?: string;
        event_id?: string;
    }[] = [];
    const clients = new Set<WebSocket>();
    let responseCount = 0;

    // Realtime is subscriber-only; the test user is on a paid plan with a $10
    // allowance unless a test says otherwise.
    beforeEach(() => {
        const metering = server.services.metering;
        const plan = metering.getActorSubscription.bind(metering);
        vi.spyOn(metering, 'getActorSubscription').mockImplementation(
            async (actor) => ({
                ...(await plan(actor)),
                id: 'test_paid',
                monthUsageAllowance: 1_000_000_000,
            }),
        );
    });

    afterEach(async () => {
        for (const client of clients) client.terminate();
        clients.clear();
        vi.restoreAllMocks();
        // Every session, settle included, has ended its upstream.
        await vi.waitFor(() => expect(upstream.clients.size).toBe(0), {
            timeout: 8_000,
        });
    });

    beforeAll(async () => {
        // A fake OpenAI: echoes every client event back as `echo` and answers
        // `response.create` with a `response.done` carrying usage.
        upstream = new WebSocketServer({
            port: 0,
            // `gpt-realtime` stands in for a model OpenAI refuses.
            verifyClient: (info, done) =>
                info.req.url?.endsWith('model=gpt-realtime')
                    ? done(false, 429)
                    : info.req.url?.endsWith('model=gpt-realtime-1.5')
                      ? void setTimeout(() => done(true), 300)
                      : done(true),
        });
        upstream.on('connection', (ws, req) => {
            upstreamRequests.push(req);
            ws.on('error', () => {});
            ws.send(JSON.stringify({ type: 'session.created' }));
            ws.on('message', (data, isBinary) => {
                // OpenAI rejects binary frames outright.
                if (isBinary) {
                    ws.send(JSON.stringify({ type: 'error', binary: true }));
                    return;
                }
                const event = JSON.parse(data.toString());
                upstreamEvents.push(event);
                if (event.type === 'test.upstream') {
                    ws.send(event.payload, { binary: event.binary ?? false });
                    return;
                }
                if (event.type === 'test.burst') {
                    for (let i = 0; i < event.count; i++) {
                        ws.send(
                            JSON.stringify({
                                type: event.eventType ?? 'response.done',
                                response: {
                                    usage: {
                                        output_token_details: {
                                            text_tokens: 1,
                                        },
                                    },
                                },
                            }),
                        );
                    }
                    return;
                }
                if (event.type === 'test.largeBurst') {
                    const payload = JSON.stringify({
                        type: 'response.output_text.delta',
                        delta: 'x'.repeat(60 * 1024),
                    });
                    for (let i = 0; i < 6; i++) ws.send(payload);
                    return;
                }
                if (event.type === 'test.exact') {
                    const envelope = { type: 'test.exact', pad: '' };
                    envelope.pad = 'x'.repeat(
                        MAX_REALTIME_MESSAGE_BYTES -
                            Buffer.byteLength(JSON.stringify(envelope)),
                    );
                    ws.send(JSON.stringify(envelope));
                    return;
                }
                if (event.type === 'test.retrieve') {
                    ws.send(
                        JSON.stringify({
                            type: 'conversation.item.retrieved',
                            item: { audio: 'A'.repeat(event.bytes) },
                        }),
                    );
                    return;
                }
                // Drops the connection, like a provider ending the session.
                if (event.type === 'test.drop') {
                    ws.terminate();
                    return;
                }
                if (event.type === 'test.oversize') {
                    ws.send(
                        JSON.stringify({
                            type: 'response.output_text.delta',
                            delta: 'x'.repeat(MAX_UPSTREAM_MESSAGE_BYTES),
                        }),
                    );
                    return;
                }
                ws.send(JSON.stringify({ type: 'echo', event }));
                if (event.type === 'transcribe') {
                    ws.send(
                        JSON.stringify({
                            type: 'session.updated',
                            session: {
                                audio: {
                                    input: {
                                        transcription: {
                                            model: 'gpt-4o-transcribe',
                                        },
                                    },
                                },
                            },
                        }),
                    );
                    ws.send(
                        JSON.stringify({
                            type: 'conversation.item.input_audio_transcription.completed',
                            usage: {
                                type: 'tokens',
                                input_tokens: 4,
                                input_token_details: { audio_tokens: 4 },
                                output_tokens: 2,
                            } satisfies RealtimeTranscriptionUsage,
                        }),
                    );
                }
                // Commits on one transcription model, then switches to a
                // cheaper one before the transcription completes.
                if (event.type === 'transcribe.switch') {
                    const model = (name: string) =>
                        JSON.stringify({
                            type: 'session.updated',
                            session: {
                                audio: {
                                    input: { transcription: { model: name } },
                                },
                            },
                        });
                    ws.send(model('gpt-4o-transcribe'));
                    ws.send(
                        JSON.stringify({
                            type: 'input_audio_buffer.committed',
                            item_id: 'item_switch',
                        }),
                    );
                    ws.send(model('gpt-4o-mini-transcribe'));
                    ws.send(
                        JSON.stringify({
                            type: 'conversation.item.input_audio_transcription.completed',
                            item_id: 'item_switch',
                            usage: {
                                type: 'tokens',
                                input_tokens: 4,
                                input_token_details: { audio_tokens: 4 },
                            } satisfies RealtimeTranscriptionUsage,
                        }),
                    );
                }
                // Generates until cancelled, then reports usage like OpenAI.
                if (event.type === 'hold.response') {
                    ws.send(
                        JSON.stringify({
                            type: 'response.created',
                            response: { id: 'resp_hold' },
                        }),
                    );
                }
                if (event.type === 'response.cancel') {
                    ws.send(
                        JSON.stringify({
                            type: 'response.done',
                            response: {
                                id: event.response_id,
                                status: 'cancelled',
                                usage: {
                                    output_token_details: { audio_tokens: 50 },
                                } satisfies RealtimeUsage,
                            },
                        }),
                    );
                }
                // Holds a response open so the drain has one in flight.
                if (event.type === 'slow.response') {
                    ws.send(JSON.stringify({ type: 'response.created' }));
                    setTimeout(
                        () =>
                            ws.send(
                                JSON.stringify({
                                    type: 'response.done',
                                    response: {},
                                }),
                            ),
                        300,
                    );
                }
                // Starts only after a delay, like a reply still being queued.
                if (event.type === 'response.create' && event.late) {
                    setTimeout(
                        () =>
                            ws.send(
                                JSON.stringify({
                                    type: 'response.created',
                                    response: { id: 'resp_late' },
                                }),
                            ),
                        150,
                    );
                } else if (event.type === 'response.create') {
                    const id = `resp_${++responseCount}`;
                    ws.send(
                        JSON.stringify({
                            type: 'response.created',
                            response: { id },
                        }),
                    );
                    ws.send(
                        JSON.stringify({
                            type: 'response.done',
                            response: {
                                id,
                                usage: {
                                    input_token_details: { text_tokens: 7 },
                                    output_token_details: { text_tokens: 3 },
                                } satisfies RealtimeUsage,
                            },
                        }),
                    );
                }
            });
        });
        const upstreamPort = (upstream.address() as AddressInfo).port;

        const port = await allocateEphemeralPort();
        server = await setupTestServer(
            {
                port,
                realtime: { upstreamUrl: `ws://127.0.0.1:${upstreamPort}` },
                providers: { 'openai-completion': { apiKey: 'sk-test' } },
            } satisfies Partial<IConfig> as IConfig,
            { listen: true },
        );
        user = await createTestUser(server, {
            username: 'realtime-user',
            password: 'realtime-user-password',
        });
        relayUrl = `ws://api.puter.localhost:${port}${REALTIME_PATH}`;
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
        await new Promise((r) => upstream?.close(r));
    }, 60_000);

    /** Open a client and collect every event until it closes. */
    const open = (url: string, protocols?: string[]) => {
        const ws = new WebSocket(url, protocols);
        clients.add(ws);
        ws.once('close', () => clients.delete(ws));
        const events: Record<string, unknown>[] = [];
        const closed = new Promise<{ code: number }>((resolve) =>
            ws.on('close', (code) => resolve({ code })),
        );
        ws.on('error', () => {});
        ws.on('message', (d) => events.push(JSON.parse(d.toString())));
        const waitFor = (type: string) =>
            vi.waitFor(
                () => {
                    const e = events.find((x) => x.type === type);
                    if (!e) throw new Error(`no ${type} yet`);
                    return e;
                },
                { timeout: 5_000 },
            );
        const waitForEcho = (type: string) =>
            vi.waitFor(
                () =>
                    expect(
                        events.some(
                            (e) =>
                                e.type === 'echo' &&
                                (e.event as { type: string }).type === type,
                        ),
                    ).toBe(true),
                { timeout: 5_000 },
            );
        return { ws, events, closed, waitFor, waitForEcho };
    };

    it('rejects a missing credential with an error event and 1008', async () => {
        const { closed, waitFor } = open(relayUrl);
        const error = (await waitFor('error')) as {
            error: { code: string };
        };
        expect(error.error.code).toBe('invalid_api_key');
        expect((await closed).code).toBe(1008);
    });

    it('rejects a model outside the realtime catalog', async () => {
        const { closed, waitFor } = open(
            `${relayUrl}?model=gpt-4o&auth_token=${user.token}`,
        );
        const error = (await waitFor('error')) as {
            error: { code: string };
        };
        expect(error.error.code).toBe('model_not_found');
        expect((await closed).code).toBe(1008);
    });

    it('relays events both ways, buffering ones sent before upstream opens, and meters usage', async () => {
        const spy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
        const { ws, waitFor, events } = open(
            `${relayUrl}?model=gpt-realtime-mini`,
            ['realtime', `openai-insecure-api-key.${user.token}`],
        );
        await new Promise((r) => ws.once('open', r));
        expect(ws.protocol).toBe('realtime');
        ws.send(JSON.stringify({ type: 'session.update', session: {} }));
        ws.send(JSON.stringify({ type: 'response.create' }));

        await waitFor('session.created');
        await waitFor('response.done');
        expect(
            events
                .filter((e) => e.type === 'echo')
                .map((e) => (e.event as { type: string }).type),
        ).toEqual(['session.update', 'response.create']);

        const upstreamReq = upstreamRequests.at(-1)!;
        expect(upstreamReq.url).toBe('/?model=gpt-realtime-mini');
        expect(upstreamReq.headers.authorization).toBe('Bearer sk-test');

        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        const [, rows] = spy.mock.calls.at(-1)!;
        expect(rows.map((r) => [r.usageType, r.costOverride])).toEqual([
            ['openai:gpt-realtime-mini:realtime:text_input', 7 * 60],
            ['openai:gpt-realtime-mini:realtime:text_output', 3 * 240],
        ]);
        ws.close();
    });

    it.each(['null', '[]', '{}', '{', '{"type":3}', '{"type":""}'])(
        'rejects malformed client envelope %s',
        async (payload) => {
            const c = open(`${relayUrl}?auth_token=${user.token}`);
            await c.waitFor('session.created');
            c.ws.send(payload);
            expect(await c.waitFor('error')).toMatchObject({
                error: { code: 'invalid_event' },
            });
            expect((await c.closed).code).toBe(1008);
        },
    );

    it('rejects binary client messages before forwarding them', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(Buffer.from('{}'));
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'invalid_event' },
        });
        expect((await c.closed).code).toBe(1008);
    });

    it('accepts an exactly 64 KiB message unchanged', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(JSON.stringify({ type: 'test.exact' }));
        const event = await c.waitFor('test.exact');
        expect(Buffer.byteLength(JSON.stringify(event))).toBe(
            MAX_REALTIME_MESSAGE_BYTES,
        );
        c.ws.close();
    });

    it('closes oversized client messages with 1009', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(
            JSON.stringify({
                type: 'test.large',
                pad: 'x'.repeat(MAX_REALTIME_MESSAGE_BYTES),
            }),
        );
        expect((await c.closed).code).toBe(1009);
    });

    it('bounds fragmented messages before reassembly', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        for (let i = 0; i < 65; i++) c.ws.send(' ', { fin: false });
        c.ws.send(' ', { fin: true });
        expect((await c.closed).code).toBe(1008);
    });

    it('forwards upstream messages beyond the client limit', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(
            JSON.stringify({ type: 'test.retrieve', bytes: 1024 * 1024 }),
        );
        await c.waitFor('conversation.item.retrieved');
        c.ws.send('{"type":"test.alive"}');
        await c.waitForEcho('test.alive');
        c.ws.close();
    });

    // 8,000 audio input and 4,096 audio output tokens at mini rates.
    const MINI_HOLD = 8_000 * 1000 + 4_096 * 2000;
    const unreportedRows = (costOverride: number) => [
        {
            usageType: 'openai:gpt-realtime-mini:realtime:unreported_response',
            usageAmount: 1,
            costOverride,
        },
    ];

    it('closes on an oversized upstream message and bills the response it loses at its hold', async () => {
        const alarm = vi.spyOn(server.clients.alarm, 'create');
        const spy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
        const c = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await c.waitFor('session.created');
        c.ws.send(JSON.stringify({ type: 'hold.response' }));
        await c.waitFor('response.created');
        c.ws.send(JSON.stringify({ type: 'test.oversize' }));
        expect((await c.closed).code).toBe(1011);
        expect(
            c.events.some(
                (event) => event.type === 'response.output_text.delta',
            ),
        ).toBe(false);
        await vi.waitFor(() =>
            expect(spy.mock.calls.map(([, rows]) => rows)).toContainEqual(
                unreportedRows(MINI_HOLD),
            ),
        );
        expect(alarm).toHaveBeenCalledWith(
            'realtime_unreported_response',
            expect.any(String),
            expect.objectContaining({ inFlight: 1 }),
            'warning',
            { dedup: true },
        );
    });

    it('bills a response at its hold through the cost factor when the upstream drops mid-response', async () => {
        const dropped = await createTestUser(server, {
            username: 'realtime-dropped',
            password: 'realtime-dropped-password',
        });
        const row = await server.stores.user.getByUsername(dropped.username);
        const actor = { user: row } as never;
        const metering = server.services.metering;
        const spy = vi.spyOn(metering, 'batchIncrementUsages');
        await withAiCostFactorHook(server.clients.event, 2, async () => {
            const c = open(
                `${relayUrl}?model=gpt-realtime-mini&auth_token=${dropped.token}`,
            );
            await c.waitFor('session.created');
            c.ws.send(JSON.stringify({ type: 'hold.response' }));
            await c.waitFor('response.created');
            await vi.waitFor(async () =>
                expect(await metering.getOutstandingHolds(actor)).toBe(
                    MINI_HOLD * 2,
                ),
            );
            c.ws.send(JSON.stringify({ type: 'test.drop' }));
            expect((await c.closed).code).toBe(1011);
            await vi.waitFor(() =>
                expect(spy.mock.calls.map(([, rows]) => rows)).toContainEqual(
                    unreportedRows(MINI_HOLD * 2),
                ),
            );
        });
        await vi.waitFor(async () =>
            expect(await metering.getOutstandingHolds(actor)).toBe(0),
        );
    });

    const mcpTool = {
        type: 'mcp',
        server_label: 'docs',
        server_url: 'https://mcp.example.com',
    };
    it.each([
        [
            'conversation.item.retrieve',
            { type: 'conversation.item.retrieve', item_id: 'item_1' },
        ],
        [
            'an MCP tool in session.update',
            {
                type: 'session.update',
                session: { type: 'realtime', tools: [mcpTool] },
            },
        ],
        [
            'an MCP tool in response.create',
            { type: 'response.create', response: { tools: [mcpTool] } },
        ],
    ])('refuses %s without forwarding it', async (_name, event) => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        const eventId = `event_refused_${Date.now()}_${Math.random()}`;
        c.ws.send(JSON.stringify({ ...event, event_id: eventId }));
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'invalid_event' },
        });
        expect((await c.closed).code).toBe(1008);
        expect(upstreamEvents.some((e) => e.event_id === eventId)).toBe(false);
    });

    it('forwards function tools', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(
            JSON.stringify({
                type: 'session.update',
                session: {
                    type: 'realtime',
                    tools: [
                        {
                            type: 'function',
                            name: 'lookup',
                            parameters: { type: 'object' },
                        },
                    ],
                },
            }),
        );
        await c.waitForEcho('session.update');
        expect(c.events.some((e) => e.type === 'error')).toBe(false);
        c.ws.close();
    });

    it('treats a null usage as none and keeps the session', async () => {
        const alarm = vi.spyOn(server.clients.alarm, 'create');
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(JSON.stringify({ type: 'hold.response' }));
        await c.waitFor('response.created');
        c.ws.send(
            JSON.stringify({
                type: 'test.upstream',
                payload:
                    '{"type":"response.done","response":{"id":"resp_hold","usage":null}}',
            }),
        );
        await c.waitFor('response.done');
        c.ws.send('{"type":"test.alive"}');
        await c.waitForEcho('test.alive');
        c.ws.close();
        await c.closed;
        expect(alarm).not.toHaveBeenCalledWith(
            'realtime_unreported_response',
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );
    });

    it.each([
        'null',
        '{"type":"response.done","response":{"usage":{"input_tokens":-1}}}',
        '{"type":"response.done","response":{"usage":[]}}',
        '{"type":"response.done","response":{"usage":{"input_token_details":null}}}',
    ])('rejects malformed upstream shape %s', async (payload) => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(JSON.stringify({ type: 'test.upstream', payload }));
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'upstream_error' },
        });
        expect((await c.closed).code).toBe(1011);
    });

    it('caps messages pending an upstream handshake', async () => {
        const c = open(
            `${relayUrl}?model=gpt-realtime-1.5&auth_token=${user.token}`,
        );
        await new Promise((resolve) => c.ws.once('open', resolve));
        for (let i = 0; i < 33; i++) c.ws.send('{"type":"response.create"}');
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'rate_limit_exceeded' },
        });
        expect((await c.closed).code).toBe(1008);
    });

    it('caps client message floods without waiting for a byte budget', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        for (let i = 0; i < 150; i++) c.ws.send('{"type":"test.small"}');
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'rate_limit_exceeded' },
        });
        expect((await c.closed).code).toBe(1008);
    });

    it('asks a session to retry with 1013 when metering falls behind, then bills what it queued', async () => {
        const holder = await createTestUser(server, {
            username: 'realtime-backlog',
            password: 'realtime-backlog-password',
        });
        const row = await server.stores.user.getByUsername(holder.username);
        const actor = { user: row } as never;
        const metering = server.services.metering;
        const record = metering.batchIncrementUsages.bind(metering);
        let open_: () => void = () => {};
        const gate = new Promise<void>((resolve) => (open_ = resolve));
        const recorded = vi
            .spyOn(metering, 'batchIncrementUsages')
            .mockImplementation(async (...args) => {
                await gate;
                return record(...args);
            });
        const url = `${relayUrl}?model=gpt-realtime-mini&auth_token=${holder.token}`;
        const flooding = open(url);
        const quiet = open(url);
        await Promise.all([
            flooding.waitFor('session.created'),
            quiet.waitFor('session.created'),
        ]);
        // Each reply's usage queues behind metering with its credit hold.
        for (let i = 0; i < 40; i++) {
            flooding.ws.send('{"type":"response.create"}');
        }
        expect(await flooding.waitFor('error')).toMatchObject({
            error: { code: 'rate_limit_exceeded' },
        });
        expect((await flooding.closed).code).toBe(1013);
        quiet.ws.send('{"type":"test.quiet"}');
        expect(await quiet.waitFor('echo')).toMatchObject({
            event: { type: 'test.quiet' },
        });
        quiet.ws.close();

        expect(await metering.getOutstandingHolds(actor)).toBeGreaterThan(0);

        // Everything queued is still recorded once metering catches up, and
        // each hold is released after its usage.
        open_();
        await vi.waitFor(
            async () => {
                expect(recorded.mock.calls.length).toBeGreaterThan(32);
                expect(await metering.getOutstandingHolds(actor)).toBe(0);
            },
            { timeout: 10_000 },
        );
    });

    it('reports a refused upstream handshake', async () => {
        const { closed, waitFor } = open(
            `${relayUrl}?model=gpt-realtime&auth_token=${user.token}`,
        );
        expect(await waitFor('error')).toMatchObject({
            error: { code: 'upstream_error' },
        });
        expect((await closed).code).toBe(1011);
    });

    it('meters usage when type follows other event fields', async () => {
        const spy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        const usage = {
            output_token_details: { text_tokens: 13 },
        } satisfies RealtimeUsage;
        c.ws.send(
            JSON.stringify({
                type: 'test.upstream',
                payload: JSON.stringify({
                    event_id: 'test-order',
                    response: { usage },
                    type: 'response.done',
                }),
            }),
        );
        await c.waitFor('response.done');
        await vi.waitFor(() =>
            expect(
                spy.mock.calls.some(([, rows]) =>
                    rows.some(
                        (row) =>
                            row.usageType.endsWith(':text_output') &&
                            row.usageAmount === 13,
                    ),
                ),
            ).toBe(true),
        );
        c.ws.close();
    });

    it('caps bytes retained before session readiness', async () => {
        const c = open(
            `${relayUrl}?model=gpt-realtime-1.5&auth_token=${user.token}`,
        );
        await new Promise((resolve) => c.ws.once('open', resolve));
        const payload = JSON.stringify({
            type: 'test.pending',
            pad: 'x'.repeat(33 * 1024),
        });
        c.ws.send(payload);
        c.ws.send(payload);
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'rate_limit_exceeded' },
        });
        expect((await c.closed).code).toBe(1008);
    });

    it('slows uploads beyond the byte burst without buffering them', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        const first = JSON.stringify({
            type: 'test.bytes',
            pad: 'x'.repeat(60 * 1024),
        });
        c.ws.send(first);
        c.ws.send(first);
        await vi.waitFor(() =>
            expect(c.events.filter((e) => e.type === 'echo')).toHaveLength(2),
        );
        const sentAt = Date.now();
        c.ws.send('{"type":"test.afterBudget"}');
        await vi.waitFor(() =>
            expect(
                c.events.some(
                    (e) =>
                        e.type === 'echo' &&
                        (e.event as { type: string }).type ===
                            'test.afterBudget',
                ),
            ).toBe(true),
        );
        expect(Date.now() - sentAt).toBeGreaterThanOrEqual(200);
        c.ws.close();
    });

    it('forwards upstream bursts faster than real time', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(JSON.stringify({ type: 'test.largeBurst' }));
        c.ws.send(
            JSON.stringify({
                type: 'test.burst',
                count: 250,
                eventType: 'test.delta',
            }),
        );
        await vi.waitFor(
            () => {
                expect(
                    c.events.filter((e) => e.type === 'test.delta'),
                ).toHaveLength(250);
            },
            { timeout: 5_000 },
        );
        expect(
            c.events.filter((e) => e.type === 'response.output_text.delta'),
        ).toHaveLength(6);
        expect(c.events.some((e) => e.type === 'error')).toBe(false);
        c.ws.close();
    });

    it('bills a response still generating when the client disconnects', async () => {
        const spy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
        const c = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await c.waitFor('session.created');
        c.ws.send(JSON.stringify({ type: 'hold.response' }));
        await c.waitFor('response.created');
        c.ws.close();
        await vi.waitFor(() =>
            expect(
                spy.mock.calls.some(([, rows]) =>
                    rows.some(
                        (r) =>
                            r.usageType ===
                            'openai:gpt-realtime-mini:realtime:audio_output',
                    ),
                ),
            ).toBe(true),
        );
        expect(upstreamEvents).toContainEqual({
            type: 'response.cancel',
            response_id: 'resp_hold',
        });
    });

    it('records costs through the AI cost factor', async () => {
        const spy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
        await withAiCostFactorHook(server.clients.event, 2, async () => {
            const c = open(
                `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
            );
            try {
                await c.waitFor('session.created');
                c.ws.send(JSON.stringify({ type: 'response.create' }));
                // Closed sessions can still record usage from earlier tests.
                await vi.waitFor(() =>
                    expect(
                        spy.mock.calls.map(([, rows]) =>
                            rows.map((row) => [
                                row.usageType,
                                row.costOverride,
                            ]),
                        ),
                    ).toContainEqual([
                        [
                            'openai:gpt-realtime-mini:realtime:text_input',
                            7 * 60 * 2,
                        ],
                        [
                            'openai:gpt-realtime-mini:realtime:text_output',
                            3 * 240 * 2,
                        ],
                    ]),
                );
            } finally {
                c.ws.close();
                await c.closed;
            }
        });
    });

    it('refuses a session.update that changes the model', async () => {
        const c = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await c.waitFor('session.created');
        c.ws.send(
            JSON.stringify({
                type: 'session.update',
                session: { type: 'realtime', model: 'gpt-realtime' },
            }),
        );
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'invalid_event' },
        });
        expect((await c.closed).code).toBe(1008);
    });

    it('refuses accounts without a subscription', async () => {
        // The test user's own plan is a free one.
        vi.mocked(server.services.metering.getActorSubscription).mockRestore();
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'subscription_required' },
        });
        expect((await c.closed).code).toBe(1008);
    });

    describe('when the plan lookup fails', () => {
        type Resolvers = { subscriptionResolvers: unknown[] };
        // A resolver that throws makes the plan a provisional fallback.
        const failing = () => {
            throw new Error('billing unavailable');
        };
        const failLookups = (uuid: string) => {
            const metering = server.services.metering;
            (metering as unknown as Resolvers).subscriptionResolvers.unshift(
                failing,
            );
            metering.invalidateActorSubscription(uuid);
        };
        afterEach(async () => {
            const metering = server.services.metering;
            const resolvers = (metering as unknown as Resolvers)
                .subscriptionResolvers;
            resolvers.splice(resolvers.indexOf(failing), 1);
            // The fallback stays cached for its window otherwise.
            const u = await server.stores.user.getByUsername(user.username);
            metering.invalidateActorSubscription(u!.uuid);
        });

        it('asks the client to retry instead of reporting no subscription', async () => {
            const u = await server.stores.user.getByUsername(user.username);
            vi.mocked(
                server.services.metering.getActorSubscription,
            ).mockRestore();
            failLookups(u!.uuid);
            const c = open(`${relayUrl}?auth_token=${user.token}`);
            expect(await c.waitFor('error')).toMatchObject({
                error: { code: 'internal_error' },
            });
            expect((await c.closed).code).toBe(1011);
            expect(
                c.events.some(
                    (e) =>
                        (e.error as { code?: string } | undefined)?.code ===
                        'subscription_required',
                ),
            ).toBe(false);
        });

        it('still asks for a retry when the fallback runs out right after the refusal', async () => {
            // The plan check refuses on a fallback; by the time the refusal is
            // classified, the lookup has recovered.
            const metering = server.services.metering;
            let decided = false;
            vi.mocked(metering.getActorSubscription).mockImplementation(
                async () => {
                    decided = true;
                    return { id: 'user_free', monthUsageAllowance: 0 } as never;
                },
            );
            vi.spyOn(metering, 'getActorSubscriptionStatus').mockImplementation(
                async () =>
                    ({
                        policy: { id: 'user_free', monthUsageAllowance: 0 },
                        paid: false,
                        provisional: !decided,
                    }) as never,
            );
            const c = open(`${relayUrl}?auth_token=${user.token}`);
            expect(await c.waitFor('error')).toMatchObject({
                error: { code: 'internal_error' },
            });
            expect((await c.closed).code).toBe(1011);
        });

        it('asks a session to retry instead of reporting no funds', async () => {
            const u = await server.stores.user.getByUsername(user.username);
            const c = open(
                `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
            );
            await c.waitFor('session.created');
            failLookups(u!.uuid);
            vi.spyOn(
                server.services.metering,
                'getAllowedUsage',
            ).mockResolvedValue({
                remaining: 0,
                monthUsageAllowance: 0,
                addons: {},
            });
            c.ws.send(JSON.stringify({ type: 'hold.response' }));
            expect(await c.waitFor('error')).toMatchObject({
                error: { code: 'internal_error' },
            });
            expect((await c.closed).code).toBe(1011);
        });
    });

    it('forwards a normal stream without waiting for metering', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        const latencies: number[] = [];
        for (let i = 0; i < 20; i++) {
            const start = performance.now();
            const echoed = new Promise<void>((resolve) =>
                c.ws.once('message', () => resolve()),
            );
            c.ws.send(
                JSON.stringify({ type: 'test.audio', pad: 'x'.repeat(2048) }),
            );
            await echoed;
            latencies.push(performance.now() - start);
        }
        latencies.sort((a, b) => a - b);
        process.stdout.write(
            `[realtime test] 2 KiB echo round trip p50=${latencies[9].toFixed(2)}ms p95=${latencies[18].toFixed(2)}ms\n`,
        );
        expect(c.events.filter((event) => event.type === 'echo')).toHaveLength(
            20,
        );
        c.ws.close();
    });

    it('meters input transcription at the session transcription model', async () => {
        const spy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
        spy.mockClear();
        const { ws, waitFor } = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await new Promise((r) => ws.once('open', r));
        ws.send(JSON.stringify({ type: 'transcribe' }));
        await waitFor('conversation.item.input_audio_transcription.completed');
        const expectedPrefix =
            'openai:gpt-4o-transcribe:realtime:transcription_';
        await vi.waitFor(() =>
            expect(
                spy.mock.calls.some(([, rows]) =>
                    rows.some((row) =>
                        row.usageType.startsWith(expectedPrefix),
                    ),
                ),
            ).toBe(true),
        );
        const [, rows] = spy.mock.calls.find(([, rows]) =>
            rows.some((row) => row.usageType.startsWith(expectedPrefix)),
        )!;
        expect(rows.map((r) => [r.usageType, r.costOverride])).toEqual([
            [
                'openai:gpt-4o-transcribe:realtime:transcription_audio_input',
                4 * 600,
            ],
            [
                'openai:gpt-4o-transcribe:realtime:transcription_text_output',
                2 * 1000,
            ],
        ]);
        ws.close();
    });

    it('closes a session whose credential stops authenticating', async () => {
        const relay = server.services.openaiRealtime;
        const auth = vi.spyOn(server.services.auth, 'authenticate');
        const { ws, closed, waitFor } = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await waitFor('session.created');

        // Within the cache window nothing is re-checked.
        auth.mockClear();
        await relay.recheckSessions();
        expect(auth).not.toHaveBeenCalled();
        expect(ws.readyState).toBe(WebSocket.OPEN);

        auth.mockResolvedValue({ invalid: true });
        kv.del(realtimeAuthKey(user.token));
        await relay.recheckSessions();
        const error = (await waitFor('error')) as {
            error: { code: string };
        };
        expect(error.error.code).toBe('invalid_api_key');
        expect((await closed).code).toBe(1008);
        auth.mockRestore();
    });

    it('keeps a session when the re-check lookup itself fails', async () => {
        const relay = server.services.openaiRealtime;
        const auth = vi.spyOn(server.services.auth, 'authenticate');
        const { ws, events, waitFor, waitForEcho } = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await waitFor('session.created');
        auth.mockRejectedValue(new Error('db down'));
        kv.del(realtimeAuthKey(user.token));
        await relay.recheckSessions();
        // Frames arrive in order, so a close from the recheck would beat this.
        ws.send('{"type":"test.alive"}');
        await waitForEcho('test.alive');
        expect(events.some((e) => e.type === 'error')).toBe(false);
        auth.mockRestore();
        ws.close();
    });

    it('reports a failed credential lookup as internal_error and 1011, and caches nothing', async () => {
        const auth = vi
            .spyOn(server.services.auth, 'authenticate')
            .mockRejectedValueOnce(new Error('db down'));
        const before = upstreamRequests.length;
        kv.del(realtimeAuthKey(user.token));
        const failed = open(`${relayUrl}?auth_token=${user.token}`);
        expect(await failed.waitFor('error')).toMatchObject({
            error: {
                code: 'internal_error',
                message: 'Could not verify credentials',
            },
        });
        expect((await failed.closed).code).toBe(1011);
        expect(upstreamRequests.length).toBe(before);
        expect(kv.get(realtimeAuthKey(user.token))).toBeUndefined();

        // The lookup recovers, and so does the next attempt.
        const retry = open(`${relayUrl}?auth_token=${user.token}`);
        await retry.waitFor('session.created');
        expect(auth).toHaveBeenCalledTimes(2);
        expect(kv.get(realtimeAuthKey(user.token))).toBeDefined();
        retry.ws.close();
    });

    it('reports an unexpected setup failure as internal_error and 1011', async () => {
        vi.spyOn(
            server.services.metering,
            'hasEnoughCredits',
        ).mockRejectedValueOnce(new Error('metering down'));
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'internal_error', message: 'Realtime setup failed' },
        });
        expect((await c.closed).code).toBe(1011);
    });

    it('refuses an invalid, blocked or revoked credential with invalid_api_key and 1008', async () => {
        for (const result of [
            { invalid: true },
            { blocked: true },
            { reauth: { reason: 'session_revoked' } },
        ]) {
            vi.spyOn(
                server.services.auth,
                'authenticate',
            ).mockResolvedValueOnce(result as never);
            const c = open(`${relayUrl}?auth_token=${user.token}`);
            expect(await c.waitFor('error')).toMatchObject({
                error: { code: 'invalid_api_key' },
            });
            expect((await c.closed).code).toBe(1008);
        }
    });

    it('refuses a seat whose team requires 2FA the account lacks', async () => {
        const relay = server.services.openaiRealtime;
        const live = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await live.waitFor('session.created');

        const row = await server.stores.user.getByUsername(user.username);
        installSeatStub(server as never, [row!.id], { require2fa: true });

        const fresh = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        expect(await fresh.waitFor('error')).toMatchObject({
            error: { code: 'invalid_api_key' },
        });
        expect((await fresh.closed).code).toBe(1008);

        kv.del(realtimeAuthKey(user.token));
        await relay.recheckSessions();
        expect(await live.waitFor('error')).toMatchObject({
            error: { code: 'invalid_api_key' },
        });
        expect((await live.closed).code).toBe(1008);
    });

    it('holds credit for each response until its usage is recorded', async () => {
        const holder = await createTestUser(server, {
            username: 'realtime-holds',
            password: 'realtime-holds-password',
        });
        const row = await server.stores.user.getByUsername(holder.username);
        const actor = { user: row } as never;
        const metering = server.services.metering;
        const c = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${holder.token}`,
        );
        await c.waitFor('session.created');
        expect(await metering.getOutstandingHolds(actor)).toBe(0);
        c.ws.send(JSON.stringify({ type: 'hold.response' }));
        await c.waitFor('response.created');
        await vi.waitFor(async () =>
            expect(await metering.getOutstandingHolds(actor)).toBe(MINI_HOLD),
        );
        c.ws.close();
        await vi.waitFor(async () =>
            expect(await metering.getOutstandingHolds(actor)).toBe(0),
        );
    });

    it("refuses a session the account can't cover one response of", async () => {
        const subscription = vi.mocked(
            server.services.metering.getActorSubscription,
        );
        const paid = subscription.getMockImplementation()!;
        subscription.mockImplementation(async (actor) => ({
            ...(await paid(actor)),
            monthUsageAllowance: 10_000_000,
        }));
        const c = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'insufficient_funds' },
        });
        expect((await c.closed).code).toBe(1008);
    });

    it('limits session attempts per credential', async () => {
        const burst = await createTestUser(server, {
            username: 'realtime-burst',
            password: 'realtime-burst-password',
        });
        for (let i = 0; i < 60; i++) {
            await checkRateLimit(realtimeConnectKey(burst.token), 60, 60_000);
        }
        const c = open(`${relayUrl}?auth_token=${burst.token}`);
        expect(await c.waitFor('error')).toMatchObject({
            error: { code: 'rate_limit_exceeded' },
        });
        expect((await c.closed).code).toBe(1008);
    });

    it('cancels and bills a requested response that starts after the client leaves', async () => {
        const spy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
        spy.mockClear();
        const c = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await c.waitFor('session.created');
        c.ws.send(JSON.stringify({ type: 'response.create', late: true }));
        await c.waitForEcho('response.create');
        c.ws.close();
        await vi.waitFor(() =>
            expect(upstreamEvents).toContainEqual({
                type: 'response.cancel',
                response_id: 'resp_late',
            }),
        );
        await vi.waitFor(() =>
            expect(
                spy.mock.calls.some(([, rows]) =>
                    rows.some(
                        (r) =>
                            r.usageType ===
                            'openai:gpt-realtime-mini:realtime:audio_output',
                    ),
                ),
            ).toBe(true),
        );
    });

    it('prices a transcription at the costlier of its commit and current models', async () => {
        const spy = vi.spyOn(server.services.metering, 'batchIncrementUsages');
        spy.mockClear();
        const c = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await c.waitFor('session.created');
        c.ws.send(JSON.stringify({ type: 'transcribe.switch' }));
        await c.waitFor(
            'conversation.item.input_audio_transcription.completed',
        );
        await vi.waitFor(() =>
            expect(
                spy.mock.calls.flatMap(([, rows]) =>
                    rows.map((r) => [r.usageType, r.costOverride]),
                ),
            ).toContainEqual([
                'openai:gpt-4o-transcribe:realtime:transcription_audio_input',
                4 * 600,
            ]),
        );
        c.ws.close();
    });

    it('drops rate_limits.updated and redacts organization IDs from errors', async () => {
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        c.ws.send(
            JSON.stringify({
                type: 'test.upstream',
                payload: '{"type":"rate_limits.updated","rate_limits":[]}',
            }),
        );
        c.ws.send(
            JSON.stringify({
                type: 'test.upstream',
                payload: JSON.stringify({
                    type: 'error',
                    error: {
                        code: 'rate_limit_exceeded',
                        message:
                            'Rate limit reached in organization org-AbCdEf1234567890 on tokens',
                    },
                }),
            }),
        );
        const error = (await c.waitFor('error')) as {
            error: { message: string };
        };
        expect(error.error.message).toBe(
            'Rate limit reached in organization org-redacted on tokens',
        );
        expect(c.events.some((e) => e.type === 'rate_limits.updated')).toBe(
            false,
        );
        c.ws.close();
    });

    it('accepts a context replay burst right after full-size settings', async () => {
        // The SDK reapplies large settings as several updates, each sent after
        // the last is acknowledged, then replays up to 40 items and 48 KiB in
        // one burst.
        const c = open(`${relayUrl}?auth_token=${user.token}`);
        await c.waitFor('session.created');
        for (let i = 0; i < 2; i++) {
            c.ws.send(
                JSON.stringify({
                    type: `test.settings${i}`,
                    pad: 'x'.repeat(MAX_REALTIME_MESSAGE_BYTES - 64),
                }),
            );
            await c.waitForEcho(`test.settings${i}`);
        }
        const item = JSON.stringify({
            type: 'test.replay',
            item: { type: 'message', role: 'user', pad: 'x'.repeat(1100) },
        });
        expect(item.length * 40).toBeLessThanOrEqual(48 * 1024);
        for (let i = 0; i < 40; i++) c.ws.send(item);
        await vi.waitFor(
            () =>
                expect(
                    c.events.filter(
                        (e) =>
                            e.type === 'echo' &&
                            (e.event as { type: string }).type ===
                                'test.replay',
                    ),
                ).toHaveLength(40),
            { timeout: 5_000 },
        );
        expect(c.events.some((e) => e.type === 'error')).toBe(false);
        c.ws.close();
    });

    // A relay of its own, so draining it leaves the shared one serving.
    describe('refusing sessions while draining', () => {
        let relay: OpenAIRealtimeRelayService;
        let httpServer: HttpServer;
        let drainUrl: string;
        // Server-side sockets the relay accepted, in order.
        const accepted: WebSocket[] = [];
        const uncaught: unknown[] = [];
        const onUncaught = (err: unknown) => uncaught.push(err);

        beforeAll(async () => {
            relay = new OpenAIRealtimeRelayService(
                {
                    domain: 'puter.localhost',
                    realtime: {
                        upstreamUrl: `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
                    },
                    providers: { 'openai-completion': { apiKey: 'sk-test' } },
                } satisfies Partial<IConfig> as IConfig,
                server.clients,
                server.stores,
                server.services,
            );
            httpServer = createServer();
            relay.attachHttpServer(httpServer);
            await new Promise<void>((resolve) =>
                httpServer.listen(0, '127.0.0.1', resolve),
            );
            const { port } = httpServer.address() as AddressInfo;
            drainUrl = `ws://api.puter.localhost:${port}${REALTIME_PATH}?model=gpt-realtime-mini&auth_token=${user.token}`;
            process.on('uncaughtException', onUncaught);
        });

        beforeEach(() => {
            const handleUpgrade = WebSocketServer.prototype.handleUpgrade;
            vi.spyOn(
                WebSocketServer.prototype,
                'handleUpgrade',
            ).mockImplementation(function (
                this: WebSocketServer,
                req,
                socket,
                head,
                done,
            ) {
                handleUpgrade.call(this, req, socket, head, (ws, r) => {
                    accepted.push(ws);
                    vi.spyOn(ws, 'emit');
                    done(ws, r);
                });
            });
        });

        afterAll(async () => {
            process.off('uncaughtException', onUncaught);
            await relay.onServerPrepareShutdown();
            await new Promise((r) => httpServer.close(r));
        });

        it('handles a socket error on an upgrade for another host', () => {
            const socket = new PassThrough();
            const req = {
                url: REALTIME_PATH,
                headers: { host: 'evil.example' },
            } as IncomingMessage;
            httpServer.emit('upgrade', req, socket, Buffer.alloc(0));
            expect(() =>
                socket.emit('error', new Error('read ECONNRESET')),
            ).not.toThrow();
        });

        // Last in this block: it shuts the relay down.
        it('refuses late sessions, survives a client error mid-refusal, and finishes open ones', async () => {
            const metering = vi.spyOn(
                server.services.metering,
                'batchIncrementUsages',
            );
            const established = open(drainUrl);
            await established.waitFor('session.created');
            await relay.onServerDrainStart({ drainMs: 60_000 });
            await established.waitFor('puter.reconnect');

            const late = open(drainUrl);
            expect(await late.waitFor('error')).toMatchObject({
                error: { code: 'server_restarting' },
            });
            expect((await late.closed).code).toBe(1012);

            const before = accepted.length;
            const oversized = new WebSocket(drainUrl);
            clients.add(oversized);
            oversized.on('error', () => {});
            // Sent on open, before the client reads the refusal: the relay's
            // close frame is already out when this reaches it.
            oversized.once('open', () =>
                oversized.send(Buffer.alloc(MAX_REALTIME_MESSAGE_BYTES + 1)),
            );
            const socket = await vi.waitFor(() => {
                expect(accepted.length).toBeGreaterThan(before);
                return accepted[before];
            });
            await vi.waitFor(() =>
                expect(socket.readyState).toBe(WebSocket.CLOSED),
            );
            expect(
                vi
                    .mocked(socket.emit)
                    .mock.calls.filter(([name]) => name === 'error'),
            ).toEqual([
                [
                    'error',
                    expect.objectContaining({
                        code: 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
                    }),
                ],
            ]);
            expect(uncaught).toEqual([]);

            // The established session keeps working and billing, then
            // finishes its response and closes with 1012 at shutdown.
            metering.mockClear();
            established.ws.send('{"type":"response.create"}');
            await established.waitFor('response.done');
            await vi.waitFor(() => expect(metering).toHaveBeenCalled());
            established.ws.send(JSON.stringify({ type: 'slow.response' }));
            await vi.waitFor(() =>
                expect(
                    established.events.filter(
                        (e) => e.type === 'response.created',
                    ),
                ).toHaveLength(2),
            );
            await relay.onServerPrepareShutdown();
            expect((await established.closed).code).toBe(1012);
            expect(
                established.events.filter((e) => e.type === 'response.done'),
            ).toHaveLength(2);
            expect(uncaught).toEqual([]);
        }, 20_000);
    });

    describe('restart', () => {
        type Notice = {
            type: string;
            event_id: string;
            reason: string;
            close_in_ms?: number;
        };
        const notices = (c: ReturnType<typeof open>) =>
            c.events.filter((e) => e.type === 'puter.reconnect') as Notice[];

        it('sends only a reconnect notice when a host extension announces a restart', async () => {
            const relay = server.services.openaiRealtime;
            const c = open(`${relayUrl}?auth_token=${user.token}`);
            await c.waitFor('session.created');
            server.clients.event.emit(
                'serverRestartAnnounced',
                { closeInMs: 300_000.4 },
                {},
            );
            const notice = (await c.waitFor('puter.reconnect')) as Notice;
            expect(notice).toEqual({
                type: 'puter.reconnect',
                event_id: expect.stringMatching(/^event_puter_/),
                reason: 'server_restarting',
                close_in_ms: 300_000,
            });

            // Repeats within a minute are dropped; the session keeps working.
            server.clients.event.emit('serverRestartAnnounced', {}, {});
            await relay.recheckSessions();
            c.ws.send('{"type":"test.alive"}');
            await c.waitForEcho('test.alive');
            expect(notices(c)).toHaveLength(1);

            // New sessions are still accepted, and get no notice.
            const fresh = open(`${relayUrl}?auth_token=${user.token}`);
            await fresh.waitFor('session.created');
            fresh.ws.send('{"type":"test.alive"}');
            await fresh.waitForEcho('test.alive');
            expect(notices(fresh)).toHaveLength(0);
            expect(c.ws.readyState).toBe(WebSocket.OPEN);
            c.ws.close();
            fresh.ws.close();
        });

        it('omits close_in_ms when the announcement has no usable duration', async () => {
            const c = open(`${relayUrl}?auth_token=${user.token}`);
            await c.waitFor('session.created');
            server.clients.event.emit(
                'serverRestartAnnounced',
                { closeInMs: -1 },
                {},
            );
            const notice = (await c.waitFor('puter.reconnect')) as Notice;
            expect(notice).not.toHaveProperty('close_in_ms');
            c.ws.close();
        });

        // Last: the relay is shut down afterwards.
        it('drains: notifies open sessions, refuses new ones, bills leavers, then closes the rest with 1012', async () => {
            const relay = server.services.openaiRealtime;
            const spy = vi.spyOn(
                server.services.metering,
                'batchIncrementUsages',
            );
            const url = `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`;
            const idle = open(url);
            const busy = open(url);
            const leaver = open(url);
            await Promise.all(
                [idle, busy, leaver].map((c) => c.waitFor('session.created')),
            );
            leaver.ws.send(JSON.stringify({ type: 'hold.response' }));
            await leaver.waitFor('response.created');

            await relay.onServerDrainStart({ drainMs: 90_000 });
            for (const c of [idle, busy, leaver]) {
                expect(await c.waitFor('puter.reconnect')).toMatchObject({
                    reason: 'server_restarting',
                    close_in_ms: 90_000,
                });
            }

            const late = open(url);
            expect(await late.waitFor('error')).toMatchObject({
                error: { code: 'server_restarting' },
            });
            expect((await late.closed).code).toBe(1012);

            // A client that leaves after the notice is billed as before: its
            // response is cancelled and settled.
            spy.mockClear();
            leaver.ws.close();
            await vi.waitFor(() =>
                expect(upstreamEvents).toContainEqual({
                    type: 'response.cancel',
                    response_id: 'resp_hold',
                }),
            );
            await vi.waitFor(() =>
                expect(
                    spy.mock.calls.some(([, rows]) =>
                        rows.some(
                            (r) =>
                                r.usageType ===
                                'openai:gpt-realtime-mini:realtime:audio_output',
                        ),
                    ),
                ).toBe(true),
            );

            // The rest keep working until shutdown.
            idle.ws.send('{"type":"test.alive"}');
            await idle.waitForEcho('test.alive');
            busy.ws.send(JSON.stringify({ type: 'slow.response' }));
            await busy.waitFor('response.created');

            await relay.onServerPrepareShutdown();
            expect((await idle.closed).code).toBe(1012);
            expect((await busy.closed).code).toBe(1012);
            expect(busy.events.some((e) => e.type === 'response.done')).toBe(
                true,
            );
            expect(notices(idle)).toHaveLength(1);
        });
    });
});
