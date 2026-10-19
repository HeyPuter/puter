import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { PuterServer } from '../../server';
import {
    allocateEphemeralPort,
    createTestUser,
    setupTestServer,
    type TestUserCredentials,
} from '../../testUtil';
import { kv } from '../../util/kvSingleton';
import {
    REALTIME_PATH,
    realtimeAuthKey,
    realtimeTokenFrom,
    realtimeTranscriptionRows,
    realtimeUsageRows,
} from './OpenAIRealtimeRelayService';

const reqWith = (headers: Record<string, string>) =>
    ({ headers }) as unknown as IncomingMessage;

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

describe('OpenAIRealtimeRelayService relay', () => {
    let server: PuterServer;
    let upstream: WebSocketServer;
    let user: TestUserCredentials;
    let relayUrl: string;
    const upstreamRequests: IncomingMessage[] = [];

    beforeAll(async () => {
        // A fake OpenAI: echoes every client event back as `echo` and answers
        // `response.create` with a `response.done` carrying usage.
        upstream = new WebSocketServer({
            port: 0,
            // `gpt-realtime` stands in for a model OpenAI refuses.
            verifyClient: (info, done) =>
                info.req.url?.endsWith('model=gpt-realtime')
                    ? done(false, 429)
                    : done(true),
        });
        upstream.on('connection', (ws, req) => {
            upstreamRequests.push(req);
            ws.send(JSON.stringify({ type: 'session.created' }));
            ws.on('message', (data, isBinary) => {
                // OpenAI rejects binary frames outright.
                if (isBinary) {
                    ws.send(JSON.stringify({ type: 'error', binary: true }));
                    return;
                }
                const event = JSON.parse(data.toString());
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
                                },
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
            } as never,
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
        const events: Record<string, unknown>[] = [];
        const closed = new Promise<{ code: number }>((resolve) =>
            ws.on('close', (code) => resolve({ code })),
        );
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
        return { ws, events, closed, waitFor };
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

    it('slows a client that sends past its byte budget instead of buffering', async () => {
        const { ws, waitFor, events } = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await new Promise((r) => ws.once('open', r));
        await waitFor('session.created');
        const frame = (type: string, mb: number) =>
            JSON.stringify({ type, pad: 'x'.repeat(mb * 1024 * 1024) });
        // 15.5 + 1.5 MiB overdraws the 16 MiB burst by 1 MiB, which at the
        // default 1 MiB/s pauses reads for about a second. Frames already
        // read when the pause lands still go through, so `c` is sent after.
        ws.send(frame('a', 15.5));
        ws.send(frame('b', 1.5));
        const echoedAt = async (type: string) => {
            await vi.waitFor(
                () => {
                    if (
                        !events.some(
                            (e) =>
                                e.type === 'echo' &&
                                (e.event as { type: string }).type === type,
                        )
                    ) {
                        throw new Error(`no echo of ${type}`);
                    }
                },
                { timeout: 10_000, interval: 20 },
            );
            return Date.now();
        };
        const b = await echoedAt('b');
        ws.send(JSON.stringify({ type: 'c' }));
        const c = await echoedAt('c');
        expect(c - b).toBeGreaterThanOrEqual(700);
        ws.close();
    }, 20_000);

    it('counts a refused upstream handshake once and reports it to the client', async () => {
        const relay = server.services.openaiRealtime;
        const before = relay.stats().upstreamFailed;
        const { closed, waitFor } = open(
            `${relayUrl}?model=gpt-realtime&auth_token=${user.token}`,
        );
        const error = (await waitFor('error')) as {
            error: { code: string };
        };
        expect(error.error.code).toBe('upstream_error');
        expect((await closed).code).toBe(1011);
        // Let the terminated upstream's late error event land, if any.
        await new Promise((r) => setTimeout(r, 200));
        expect(relay.stats().upstreamFailed).toBe(before + 1);
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
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        const [, rows] = spy.mock.calls.at(-1)!;
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

        auth.mockResolvedValue({ invalid: true } as never);
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
        const { ws, waitFor } = open(
            `${relayUrl}?model=gpt-realtime-mini&auth_token=${user.token}`,
        );
        await waitFor('session.created');
        auth.mockRejectedValue(new Error('db down'));
        kv.del(realtimeAuthKey(user.token));
        await relay.recheckSessions();
        expect(ws.readyState).toBe(WebSocket.OPEN);
        auth.mockRestore();
        ws.close();
    });

    it('reports counters, event-loop delay and memory', async () => {
        const relay = server.services.openaiRealtime;
        await vi.waitFor(() => expect(relay.stats().active).toBe(0));
        const stats = relay.stats();
        expect(stats.opened).toBeGreaterThanOrEqual(3);
        expect(stats.rejected).toBeGreaterThanOrEqual(2);
        for (const key of [
            'loopP50Ms',
            'loopP99Ms',
            'loopMaxMs',
            'rssMb',
            'heapMb',
        ] as const) {
            expect(Number.isFinite(stats[key])).toBe(true);
        }
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
