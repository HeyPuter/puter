import { chromium, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import net, { type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { loadNodePuter, closeNodePuter } from '../harness/nodeSdkLoader';
import type { EnvManifest, PuterSDK } from '../harness/types';
import type { Conversation } from '../../../types/modules/ai/convo';
import type { RealtimeServerEvent } from '../../../types/modules/ai/types';
import {
    setupPuterTestEnv,
    type PuterTestEnv,
} from '@heyputer/backend/testUtil.ts';
import type { IConfig } from '@heyputer/backend/types.ts';

describe('convo built SDK and browser media', () => {
    let env: PuterTestEnv;
    let upstream: WebSocketServer;
    let puter: PuterSDK;
    let browser: Browser | undefined;
    let manifest: EnvManifest;
    // A TCP hop in front of the server whose connections a test can cut, so
    // the client sees an abnormal closure (1006).
    let proxy: net.Server;
    let proxyOrigin: string;
    let proxyConnections = 0;
    const proxied = new Set<Socket>();
    const received: { type: string; audio?: string }[] = [];
    // Events each upstream connection received, in connection order.
    const connections: {
        socket: WebSocket;
        received: { type: string; item?: unknown }[];
    }[] = [];
    let ids = 0;
    beforeAll(async () => {
        upstream = new WebSocketServer({ port: 0 });
        upstream.on('connection', (socket) => {
            const connection = {
                socket,
                received: [] as { type: string; item?: unknown }[],
            };
            connections.push(connection);
            socket.send(
                JSON.stringify({ type: 'session.created', session: {} }),
            );
            socket.on('error', () => {});
            socket.on('message', (data) => {
                const event = JSON.parse(data.toString());
                received.push(event);
                connection.received.push(event);
                const send = (payload: Record<string, unknown>) =>
                    socket.send(JSON.stringify(payload));
                if (event.type === 'conversation.item.create') {
                    const item = {
                        ...event.item,
                        id: `item_${++ids}`,
                        object: 'realtime.item',
                        status: 'completed',
                    };
                    send({ type: 'conversation.item.added', item });
                    send({ type: 'conversation.item.done', item });
                }
                if (event.type === 'session.update')
                    socket.send(
                        JSON.stringify({
                            type: 'session.updated',
                            session: event.session,
                        }),
                    );
                if (event.type === 'response.create') {
                    const responseId = `resp_${++ids}`;
                    const item = {
                        id: `item_${++ids}`,
                        object: 'realtime.item',
                        type: 'message',
                        role: 'assistant',
                    };
                    send({
                        type: 'response.created',
                        response: { id: responseId },
                    });
                    send({
                        type: 'response.output_item.added',
                        response_id: responseId,
                        item: { ...item, status: 'in_progress', content: [] },
                    });
                    send({
                        type: 'response.output_text.delta',
                        response_id: responseId,
                        item_id: item.id,
                        content_index: 0,
                        delta: 'Hello',
                    });
                    send({
                        type: 'response.output_audio.delta',
                        response_id: responseId,
                        item_id: item.id,
                        content_index: 0,
                        delta: Buffer.alloc(960).toString('base64'),
                    });
                    send({
                        type: 'response.output_item.done',
                        response_id: responseId,
                        item: {
                            ...item,
                            status: 'completed',
                            content: [{ type: 'output_text', text: 'Hello' }],
                        },
                    });
                    send({
                        type: 'response.done',
                        response: { id: responseId, status: 'completed' },
                    });
                }
                if (event.type === 'response.cancel')
                    socket.send(
                        JSON.stringify({
                            type: 'response.done',
                            response: {
                                id: event.response_id,
                                status: 'cancelled',
                            },
                        }),
                    );
                // Provider events far larger than anything a client sends.
                if (event.type === 'test.large') {
                    send({
                        type: 'session.updated',
                        session: { instructions: 'x'.repeat(1536 * 1024) },
                    });
                    const item = {
                        id: `item_${++ids}`,
                        object: 'realtime.item',
                        type: 'message',
                        role: 'assistant',
                    };
                    send({
                        type: 'conversation.item.added',
                        item: { ...item, status: 'in_progress', content: [] },
                    });
                    const done = {
                        ...item,
                        status: 'completed',
                        content: [
                            {
                                type: 'output_audio',
                                audio: Buffer.alloc(1536 * 1024).toString(
                                    'base64',
                                ),
                                transcript: 'Hello there',
                            },
                        ],
                    };
                    send({ type: 'conversation.item.done', item: done });
                    send({ type: 'conversation.item.retrieved', item: done });
                }
                if (event.type === 'conversation.item.truncate')
                    socket.send(
                        JSON.stringify({
                            type: 'conversation.item.truncated',
                            item_id: event.item_id,
                            content_index: event.content_index,
                            audio_end_ms: event.audio_end_ms,
                        }),
                    );
            });
        });
        const port = (upstream.address() as AddressInfo).port;
        env = await setupPuterTestEnv({
            realtime: { upstreamUrl: `ws://127.0.0.1:${port}` },
            providers: { 'openai-realtime': { apiKey: 'test-provider-key' } },
            unlimitedMetering: true,
        } as IConfig);
        manifest = {
            origin: env.origin,
            apiOrigin: env.apiOrigin,
            users: env.users,
        };
        puter = loadNodePuter(manifest, env.users.user.token);
        const api = new URL(env.apiOrigin);
        proxy = net.createServer((inbound) => {
            proxyConnections++;
            const outbound = net.connect({
                host: api.hostname,
                port: Number(api.port),
            });
            for (const [from, to] of [
                [inbound, outbound],
                [outbound, inbound],
            ]) {
                proxied.add(from);
                from.on('error', () => to.destroy());
                from.on('close', () => {
                    proxied.delete(from);
                    to.destroy();
                });
                from.pipe(to);
            }
        });
        await new Promise<void>((resolve) => proxy.listen(0, resolve));
        proxyOrigin = `http://${api.hostname}:${(proxy.address() as AddressInfo).port}`;
    }, 60_000);
    afterAll(async () => {
        await browser?.close();
        if (puter) closeNodePuter(puter);
        for (const socket of proxied) socket.destroy();
        await new Promise<void>((resolve) => proxy?.close(() => resolve()));
        for (const socket of upstream?.clients ?? []) socket.terminate();
        await env?.shutdown();
        await new Promise<void>((resolve) => upstream?.close(() => resolve()));
    }, 60_000);

    it('prepares, configures, sends, interrupts and truncates using the built SDK', async () => {
        const conversation = await puter.ai.convo({
            output: ['text'],
            turnDetection: false,
        });
        const text: string[] = [];
        conversation.on('text', (event) => text.push(event.delta));
        try {
            expect(conversation.state).toBe('prepared');
            await conversation.connect();
            expect(conversation.state).toBe('connected');
            conversation.sendText('Hello');
            await vi.waitFor(() => expect(text).toEqual(['Hello']));
            await conversation.interrupt({
                itemId: 'item1',
                contentIndex: 0,
                playedMs: 0,
            });
            await conversation.configure({ instructions: 'Keep it short.' });
            conversation.appendAudio(new Int16Array(480));
            conversation.commitAudio();
            await vi.waitFor(() =>
                expect(
                    received.some(
                        (event) => event.type === 'input_audio_buffer.commit',
                    ),
                ).toBe(true),
            );
        } finally {
            conversation.close();
        }
        expect(conversation.state).toBe('closed');
    });

    it('captures through a real AudioWorklet and releases browser media on close', async () => {
        // The first test appends a chunk of the same size.
        received.length = 0;
        browser = await chromium.launch({
            args: [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests',
            ],
        });
        const page = await browser.newPage();
        const sdk = readFileSync(
            new URL('../../../dist/puter.js', import.meta.url),
            'utf8',
        );
        await page.route('**/__convo_test__', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Conversation media test</title>',
            }),
        );
        await page.goto(`${env.apiOrigin}/__convo_test__`);
        await page.evaluate(
            ({ origin, apiOrigin }) => {
                Object.assign(globalThis, {
                    PUTER_ORIGIN: origin,
                    PUTER_API_ORIGIN: apiOrigin,
                });
            },
            { origin: env.origin, apiOrigin: env.apiOrigin },
        );
        await page.addScriptTag({ content: sdk });
        const result = await page.evaluate(async (token) => {
            const sdk = (globalThis as typeof globalThis & { puter: PuterSDK })
                .puter;
            sdk.setAuthToken(token);
            const tracks: MediaStreamTrack[] = [];
            const capture = navigator.mediaDevices.getUserMedia.bind(
                navigator.mediaDevices,
            );
            navigator.mediaDevices.getUserMedia = async (constraints) => {
                const stream = await capture(constraints);
                tracks.push(...stream.getTracks());
                return stream;
            };
            let c;
            try {
                c = await sdk.ai.convo();
            } catch (error) {
                throw new Error(`prepare: ${JSON.stringify(error)}`);
            }
            const errors: string[] = [];
            c.on('error', (event) =>
                errors.push(
                    String(
                        event.code ?? (event.error as { code?: string })?.code,
                    ),
                ),
            );
            c.on('close', (event) => {
                if (event.code !== 1000)
                    errors.push(`close:${event.code}:${event.reason}`);
            });
            try {
                await c.connect();
            } catch (error) {
                throw new Error(
                    `connect: ${JSON.stringify(error)} events=${JSON.stringify(errors)}`,
                );
            }
            try {
                await c.speaker.start();
            } catch (error) {
                throw new Error(`speaker: ${JSON.stringify(error)}`);
            }
            try {
                await c.microphone.start();
            } catch (error) {
                throw new Error(`microphone: ${JSON.stringify(error)}`);
            }
            c.microphone.mute();
            c.microphone.unmute();
            // Closes once captured audio went out and the reply came back.
            await new Promise<void>((resolve, reject) => {
                let appended = false;
                let replied = false;
                const timer = setTimeout(
                    () => reject(new Error('no captured audio or reply')),
                    10_000,
                );
                const check = () => {
                    if (!appended || !replied) return;
                    clearTimeout(timer);
                    resolve();
                };
                const appendAudio = c.appendAudio.bind(c);
                c.appendAudio = (pcm: Int16Array) => {
                    appendAudio(pcm);
                    appended = true;
                    check();
                };
                c.on('turn.done', () => {
                    replied = true;
                    check();
                });
                c.sendText('Hello');
            });
            c.close();
            return {
                state: c.state,
                errors,
                tracksEnded:
                    tracks.length > 0 &&
                    tracks.every((track) => track.readyState === 'ended'),
            };
        }, env.users.user.token);
        expect(result).toEqual({
            state: 'closed',
            errors: [],
            tracksEnded: true,
        });
        await vi.waitFor(() =>
            expect(
                received.some(
                    (event) =>
                        event.type === 'input_audio_buffer.append' &&
                        event.audio &&
                        event.audio.length === 1280,
                ),
            ).toBe(true),
        );
    }, 30_000);
    /** Collects a conversation's events and waits on them. */
    const watch = (conversation: Conversation) => {
        const events: RealtimeServerEvent[] = [];
        conversation.on('*', (event) => events.push(event));
        const count = (type: string) =>
            events.filter((event) => event.type === type).length;
        const until = (check: () => boolean, timeout = 10_000) =>
            vi.waitFor(() => expect(check()).toBe(true), { timeout });
        return { events, count, until };
    };
    const restored = (connection: (typeof connections)[number]) =>
        connection.received
            .filter((event) => event.type === 'conversation.item.create')
            .map((event) => event.item);
    const history = [
        {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Remember the number 7.' }],
        },
        {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hello' }],
        },
    ];

    it('restores context on a new session after the connection drops', async () => {
        const dropping = loadNodePuter(
            { ...manifest, apiOrigin: proxyOrigin },
            env.users.user.token,
        );
        const conversation = await dropping.ai.convo({ output: ['text'] });
        const log = watch(conversation);
        try {
            await conversation.connect();
            const first = connections.at(-1)!;
            conversation.sendText('Remember the number 7.');
            await log.until(() => log.count('turn.done') === 1);

            for (const socket of proxied) socket.destroy();
            await log.until(() =>
                log.events.some(
                    (event) => event.type === 'ready' && event.reconnected,
                ),
            );
            expect(
                log.events.find((event) => event.type === 'reconnecting'),
            ).toMatchObject({ code: 1006 });
            const second = connections.at(-1)!;
            expect(second).not.toBe(first);
            // Sent before ready, so they reach the provider ahead of the next turn.
            await vi.waitFor(() => expect(restored(second)).toEqual(history));
            expect(second.received[0].type).toBe('session.update');
            // The relay ended the old provider session.
            await vi.waitFor(() =>
                expect(first.socket.readyState).toBe(WebSocket.CLOSED),
            );

            conversation.sendText('Which number?');
            await log.until(() => log.count('turn.done') === 2);
            expect(restored(second)).toEqual([
                ...history,
                {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: 'Which number?' }],
                },
            ]);
            expect(log.count('error')).toBe(0);
        } finally {
            conversation.close();
            closeNodePuter(dropping);
        }
    });

    it('reconnects through a credential lookup that fails once', async () => {
        const dropping = loadNodePuter(
            { ...manifest, apiOrigin: proxyOrigin },
            env.users.user.token,
        );
        const conversation = await dropping.ai.convo({ output: ['text'] });
        const log = watch(conversation);
        const auth = vi.spyOn(env.server.services.auth, 'authenticate');
        const warn = vi.spyOn(console, 'warn');
        try {
            await conversation.connect();
            auth.mockRejectedValueOnce(new Error('auth store unavailable'));
            for (const socket of proxied) socket.destroy();
            await log.until(() =>
                log.events.some(
                    (event) => event.type === 'ready' && event.reconnected,
                ),
            );
            // The first attempt failed its lookup, a later one went through.
            expect(warn).toHaveBeenCalledWith(
                '[realtime] credential lookup failed',
                expect.objectContaining({ message: 'auth store unavailable' }),
            );
            expect(log.count('reconnecting')).toBe(1);
            conversation.sendText('Still there?');
            await log.until(() => log.count('turn.done') === 1);
            expect(log.count('close')).toBe(0);
        } finally {
            auth.mockRestore();
            warn.mockRestore();
            conversation.close();
            closeNodePuter(dropping);
        }
    });

    it('delivers provider events larger than an upload and restores them after a drop', async () => {
        const dropping = loadNodePuter(
            { ...manifest, apiOrigin: proxyOrigin },
            env.users.user.token,
        );
        const conversation = await dropping.ai.convo({ output: ['text'] });
        const log = watch(conversation);
        try {
            await conversation.connect();
            conversation.send({ type: 'test.large' });
            await log.until(
                () => log.count('conversation.item.retrieved') === 1,
            );
            expect(log.count('conversation.item.done')).toBe(1);
            const update = log.events.find(
                (event) =>
                    event.type === 'session.updated' &&
                    typeof event.session?.instructions === 'string' &&
                    event.session.instructions.length === 1536 * 1024,
            );
            expect(update).toBeDefined();
            expect(conversation.state).toBe('connected');

            for (const socket of proxied) socket.destroy();
            await log.until(() =>
                log.events.some(
                    (event) => event.type === 'ready' && event.reconnected,
                ),
            );
            await vi.waitFor(() =>
                expect(restored(connections.at(-1)!)).toContainEqual({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Hello there' }],
                }),
            );
            expect(log.count('reconnecting')).toBe(1);
            expect(log.count('close')).toBe(0);
        } finally {
            conversation.close();
            closeNodePuter(dropping);
        }
    });

    it('moves to a new session when a restart is announced, restoring context', async () => {
        const conversation = await puter.ai.convo({ output: ['text'] });
        const log = watch(conversation);
        try {
            await conversation.connect();
            const first = connections.at(-1)!;
            conversation.sendText('Remember the number 7.');
            await log.until(() => log.count('turn.done') === 1);

            env.server.clients.event.emit(
                'serverRestartAnnounced',
                { closeInMs: 60_000 },
                {},
            );
            await log.until(() =>
                log.events.some(
                    (event) => event.type === 'ready' && event.reconnected,
                ),
            );
            expect(
                log.events.find((event) => event.type === 'puter.reconnect'),
            ).toMatchObject({
                reason: 'server_restarting',
                close_in_ms: 60_000,
            });
            expect(
                log.events.find((event) => event.type === 'reconnecting'),
            ).toMatchObject({ code: 1012, reason: 'server_restarting' });
            const second = connections.at(-1)!;
            expect(second).not.toBe(first);
            // Sent before ready, so they reach the provider ahead of the next turn.
            await vi.waitFor(() => expect(restored(second)).toEqual(history));
            await vi.waitFor(() =>
                expect(first.socket.readyState).toBe(WebSocket.CLOSED),
            );

            conversation.sendText('Which number?');
            await log.until(() => log.count('turn.done') === 2);
            expect(log.count('error')).toBe(0);
            expect(log.count('close')).toBe(0);
        } finally {
            conversation.close();
        }
    });

    it('closes with invalid_event when Puter refuses a native event', async () => {
        const conversation = await puter.ai.convo({ output: ['text'] });
        const log = watch(conversation);
        try {
            await conversation.connect();
            conversation.send({
                type: 'conversation.item.retrieve',
                item_id: 'item_1',
            });
            await log.until(() => conversation.state === 'closed');
            expect(
                log.events.find((event) => event.type === 'error'),
            ).toMatchObject({ error: { code: 'invalid_event' } });
            expect(
                log.events.find((event) => event.type === 'close'),
            ).toMatchObject({ code: 1008 });
            expect(log.count('reconnecting')).toBe(0);
            expect(
                received.some(
                    (event) => event.type === 'conversation.item.retrieve',
                ),
            ).toBe(false);
        } finally {
            conversation.close();
        }
    });

    // Last: the relay refuses new sessions from here on.
    it('keeps the session working while a draining server refuses its replacement', async () => {
        const draining = loadNodePuter(
            { ...manifest, apiOrigin: proxyOrigin },
            env.users.user.token,
        );
        const conversation = await draining.ai.convo({ output: ['text'] });
        const log = watch(conversation);
        try {
            await conversation.connect();
            const before = proxyConnections;
            await env.server.services.openaiRealtime.onServerDrainStart({
                drainMs: 60_000,
            });
            await log.until(() => log.count('puter.reconnect') === 1);
            // One replacement within 3 seconds, the next about a second later.
            await log.until(() => proxyConnections - before >= 2, 15_000);
            conversation.sendText('Still there?');
            await log.until(() => log.count('turn.done') === 1);
            expect(conversation.state).toBe('connected');
            expect(log.count('reconnecting')).toBe(0);
            expect(log.count('error')).toBe(0);
        } finally {
            conversation.close();
            closeNodePuter(draining);
        }
        expect(conversation.state).toBe('closed');
    });
});
