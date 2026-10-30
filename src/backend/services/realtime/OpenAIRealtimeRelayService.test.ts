import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
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
    REALTIME_PATH,
    type RealtimeUsage,
    type RealtimeTranscriptionUsage,
    realtimeAuthKey,
    realtimeBillingModel,
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
            realtimeBillingModel({ model: 'gpt-realtime' }, 'gpt-realtime-mini'),
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
    const upstreamEvents: { type: string; response_id?: string }[] = [];
    const clients = new Set<WebSocket>();

    // Realtime is subscriber-only; the test user is on a paid plan unless a
    // test says otherwise.
    beforeEach(() => {
        const metering = server.services.metering;
        const plan = metering.getActorSubscription.bind(metering);
        vi.spyOn(metering, 'getActorSubscription').mockImplementation(
            async (actor) => ({ ...(await plan(actor)), id: 'test_paid' }),
        );
    });

    afterEach(() => {
        for (const client of clients) client.terminate();
        clients.clear();
        vi.restoreAllMocks();
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
                if (event.type === 'response.create') {
                    ws.send(
                        JSON.stringify({
                            type: 'response.done',
                            response: {
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
        c.ws.send(JSON.stringify({ type: 'test.retrieve', bytes: 1024 * 1024 }));
        await c.waitFor('conversation.item.retrieved');
        c.ws.send('{"type":"test.alive"}');
        await c.waitForEcho('test.alive');
        c.ws.close();
    });

    it('closes on an oversized upstream message and alarms on the response it loses', async () => {
        const alarm = vi.spyOn(server.clients.alarm, 'create');
        const c = open(`${relayUrl}?auth_token=${user.token}`);
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
            expect(alarm).toHaveBeenCalledWith(
                'realtime_unbilled_response',
                expect.any(String),
                expect.objectContaining({ inFlight: 1 }),
                'warning',
                { dedup: true },
            ),
        );
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
            'realtime_unbilled_response',
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

    it('bounds pending metering work while another session remains responsive', async () => {
        const flooding = open(`${relayUrl}?auth_token=${user.token}`);
        const quiet = open(`${relayUrl}?auth_token=${user.token}`);
        await Promise.all([
            flooding.waitFor('session.created'),
            quiet.waitFor('session.created'),
        ]);
        flooding.ws.send(JSON.stringify({ type: 'test.burst', count: 40 }));
        quiet.ws.send('{"type":"test.quiet"}');
        expect(await flooding.waitFor('error')).toMatchObject({
            error: { code: 'rate_limit_exceeded' },
        });
        expect((await flooding.closed).code).toBe(1008);
        expect(await quiet.waitFor('echo')).toMatchObject({
            event: { type: 'test.quiet' },
        });
        quiet.ws.close();
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
                            rows.map((row) => [row.usageType, row.costOverride]),
                        ),
                    ).toContainEqual([
                        ['openai:gpt-realtime-mini:realtime:text_input', 7 * 60 * 2],
                        ['openai:gpt-realtime-mini:realtime:text_output', 3 * 240 * 2],
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

    // Last: the relay stays in drain mode afterwards.
    it('drains: refuses new sessions, finishes in-flight responses, then closes with 1012', async () => {
        const relay = server.services.openaiRealtime;
        const live = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await live.waitFor('session.created');
        live.ws.send(JSON.stringify({ type: 'slow.response' }));
        await live.waitFor('response.created');

        relay.onServerDrainStart();
        const late = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        const error = (await late.waitFor('error')) as {
            error: { code: string };
        };
        expect(error.error.code).toBe('server_restarting');
        expect((await late.closed).code).toBe(1012);
        expect(live.ws.readyState).toBe(WebSocket.OPEN);

        await relay.onServerPrepareShutdown();
        expect((await live.closed).code).toBe(1012);
        expect(live.events.some((e) => e.type === 'response.done')).toBe(true);
    });
});
