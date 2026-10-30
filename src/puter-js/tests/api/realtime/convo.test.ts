import { chromium, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import {
    loadNodePuter,
    closeNodePuter,
} from '../harness/nodeSdkLoader';
import type {
    EnvManifest,
    PuterSDK,
} from '../harness/types';
import { setupPuterTestEnv, type PuterTestEnv } from '@heyputer/backend/testUtil.ts';
import type { IConfig } from '@heyputer/backend/types.ts';

describe('convo built SDK and browser media', () => {
    let env: PuterTestEnv;
    let upstream: WebSocketServer;
    let puter: PuterSDK;
    let browser: Browser | undefined;
    const received: { type: string; audio?: string }[] = [];
    beforeAll(async () => {
        upstream = new WebSocketServer({ port: 0 });
        upstream.on('connection', (socket) => {
            socket.send(
                JSON.stringify({ type: 'session.created', session: {} }),
            );
            socket.on('error', () => {});
            socket.on('message', (data) => {
                const event = JSON.parse(data.toString());
                received.push(event);
                if (event.type === 'session.update')
                    socket.send(
                        JSON.stringify({
                            type: 'session.updated',
                            session: event.session,
                        }),
                    );
                if (event.type === 'response.create') {
                    socket.send(
                        JSON.stringify({
                            type: 'response.created',
                            response: { id: 'r1' },
                        }),
                    );
                    socket.send(
                        JSON.stringify({
                            type: 'response.output_text.delta',
                            response_id: 'r1',
                            delta: 'Hello',
                        }),
                    );
                    socket.send(
                        JSON.stringify({
                            type: 'response.output_audio.delta',
                            response_id: 'r1',
                            item_id: 'item1',
                            content_index: 0,
                            delta: Buffer.alloc(960).toString('base64'),
                        }),
                    );
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
        const manifest: EnvManifest = {
            origin: env.origin,
            apiOrigin: env.apiOrigin,
            users: env.users,
        };
        puter = loadNodePuter(manifest, env.users.user.token);
    }, 60_000);
    afterAll(async () => {
        await browser?.close();
        if (puter) closeNodePuter(puter);
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
            c.sendText('Hello');
            await new Promise((resolve) => setTimeout(resolve, 300));
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
});
