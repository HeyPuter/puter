import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeNodePuter, loadNodePuter } from '../harness/nodeSdkLoader';
import type { EnvManifest, PuterSDK } from '../harness/types';
import type { Conversation } from '../../../types/modules/ai/convo';
import type { RealtimeServerEvent } from '../../../types/modules/ai/types';
import { optionalEnv } from '@heyputer/backend/drivers/integrationTestUtil.ts';
import {
    setupPuterTestEnv,
    type PuterTestEnv,
} from '@heyputer/backend/testUtil.ts';
import type { IConfig } from '@heyputer/backend/types.ts';

const apiKey = optionalEnv('PUTER_TEST_AI_OPENAI_API_KEY');

describe.skipIf(!apiKey)('OpenAI realtime live relay', () => {
    let env: PuterTestEnv;
    let puter: PuterSDK;
    const sessions = new Set<Conversation>();

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            providers: { 'openai-realtime': { apiKey } },
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
        for (const session of sessions) session.close();
        if (puter) closeNodePuter(puter);
        await env?.shutdown();
    }, 60_000);

    const waitFor = (
        session: Conversation,
        type: string,
    ): Promise<RealtimeServerEvent> =>
        new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                offEvent();
                offError();
                offClose();
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out waiting for ${type}`));
            }, 20_000);
            const offEvent = session.on(type, (event) => {
                cleanup();
                resolve(event);
            });
            const offError = session.on('error', (event) => {
                cleanup();
                const error = event.error as { code?: string } | undefined;
                reject(
                    new Error(
                        `Realtime provider error: ${error?.code ?? 'unknown'}`,
                    ),
                );
            });
            const offClose = session.on('close', (event) => {
                cleanup();
                reject(new Error(`Realtime closed: ${event.code}`));
            });
        });

    it('streams a native text turn without the SDK', async () => {
        const url = new URL('/puterai/openai/v1/realtime', env.apiOrigin);
        url.protocol = 'ws:';
        url.searchParams.set('model', 'gpt-realtime-2.1-mini');
        const socket = new WebSocket(url, {
            headers: { Authorization: `Bearer ${env.users.user.token}` },
        });
        let text = '';
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error('Realtime timeout')),
                    20_000,
                );
                const fail = (error: Error) => {
                    clearTimeout(timer);
                    reject(error);
                };
                socket.on('error', fail);
                socket.on('close', () =>
                    fail(new Error('Realtime closed before completion')),
                );
                socket.on('message', (data) => {
                    const event = JSON.parse(data.toString());
                    const send = (payload: Record<string, unknown>) =>
                        socket.send(JSON.stringify(payload));
                    if (event.type === 'session.created') {
                        send({
                            type: 'session.update',
                            session: {
                                type: 'realtime',
                                output_modalities: ['text'],
                                instructions: 'Reply with exactly realtime-ok',
                            },
                        });
                    }
                    if (event.type === 'session.updated') {
                        send({
                            type: 'conversation.item.create',
                            item: {
                                type: 'message',
                                role: 'user',
                                content: [
                                    { type: 'input_text', text: 'Hello!' },
                                ],
                            },
                        });
                        send({ type: 'response.create' });
                    }
                    if (event.type === 'response.output_text.delta')
                        text += event.delta;
                    if (event.type === 'error')
                        fail(new Error(`Realtime error: ${event.error?.code}`));
                    if (event.type === 'response.done') {
                        clearTimeout(timer);
                        if (event.response?.status !== 'completed')
                            fail(new Error('Realtime response incomplete'));
                        else resolve();
                    }
                });
            });
            expect(text).toBe('realtime-ok');
        } finally {
            socket.close();
        }
    }, 30_000);

    it.each([undefined, 'gpt-realtime-mini'])(
        'streams a text reply through the SDK and records usage (model %s)',
        async (model) => {
            const meter = vi.spyOn(
                env.server.services.metering,
                'batchIncrementUsages',
            );
            const startedAt = performance.now();
            const session = await puter.ai.convo({
                ...(model ? { model } : {}),
                output: ['text'],
                instructions: 'Reply with exactly realtime-ok',
            });
            sessions.add(session);
            let text = '';
            let firstDeltaAt: number | undefined;
            session.on('response.output_text.delta', (event) => {
                text += String(event.delta ?? '');
                firstDeltaAt ??= performance.now();
            });
            try {
                await session.connect();
                const readyAt = performance.now();
                const done = waitFor(session, 'response.done');
                session.sendText('Say realtime-ok');
                const event = await done;
                expect(event.response).toMatchObject({
                    status: 'completed',
                    usage: { total_tokens: expect.any(Number) },
                });
                expect(text.toLowerCase()).toContain('realtime-ok');
                await vi.waitFor(
                    () =>
                        expect(
                            meter.mock.calls.some(([, rows]) =>
                                rows.some(
                                    (row) =>
                                        row.usageType.includes(':realtime:') &&
                                        row.costOverride! > 0,
                                ),
                            ),
                        ).toBe(true),
                    { timeout: 10_000 },
                );
                await Promise.all(
                    meter.mock.results
                        .filter((result) => result.type === 'return')
                        .map((result) => result.value),
                );
                process.stdout.write(
                    `[live convo] model=${model ?? 'default'} ready=${Math.round(readyAt - startedAt)}ms firstText=${Math.round(firstDeltaAt! - readyAt)}ms reply=${JSON.stringify(text)} metering=recorded\n`,
                );
            } finally {
                session.close();
                sessions.delete(session);
                meter.mockRestore();
            }
        },
        45_000,
    );
    it('restores tool and text context on a new provider session after a restart notice', async () => {
        const session = await puter.ai.convo({
            output: ['text'],
            instructions: 'Answer in one short sentence.',
        });
        sessions.add(session);
        const errors: string[] = [];
        session.on('error', (event) =>
            errors.push(
                String(event.code ?? (event.error as { code?: string })?.code),
            ),
        );
        try {
            await session.connect();
            let updated = waitFor(session, 'session.updated');
            session.send({
                type: 'session.update',
                session: {
                    type: 'realtime',
                    tools: [
                        {
                            type: 'function',
                            name: 'get_secret_word',
                            description: 'Returns the secret word.',
                            parameters: { type: 'object', properties: {} },
                        },
                    ],
                    tool_choice: 'required',
                },
            });
            await updated;
            let done = waitFor(session, 'response.done');
            session.sendText('What is the secret word?');
            const call = (
                (await done).response as {
                    output: { type: string; call_id: string }[];
                }
            ).output.find((item) => item.type === 'function_call');
            expect(call).toBeDefined();
            updated = waitFor(session, 'session.updated');
            session.send({
                type: 'session.update',
                session: { type: 'realtime', tool_choice: 'none' },
            });
            await updated;
            session.send({
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: call!.call_id,
                    output: JSON.stringify({ word: 'pineapple' }),
                },
            });
            done = waitFor(session, 'response.done');
            session.send({ type: 'response.create' });
            await done;

            const ready = waitFor(session, 'ready');
            env.server.clients.event.emit('serverRestartAnnounced', {}, {});
            expect(await ready).toMatchObject({ reconnected: true });

            let text = '';
            const off = session.on('text', (event) => {
                text += event.delta;
            });
            done = waitFor(session, 'response.done');
            session.sendText(
                'Repeat the secret word. Reply with just the word.',
            );
            await done;
            off();
            expect(text.toLowerCase()).toContain('pineapple');
            expect(errors).toEqual([]);
            process.stdout.write(
                `[live convo] context restored after reconnect, reply=${JSON.stringify(text)}\n`,
            );
        } finally {
            session.close();
            sessions.delete(session);
        }
    }, 60_000);

    it('receives live PCM audio and interrupts the current response', async () => {
        const c = await puter.ai.convo({
            output: ['audio'],
            instructions: 'Count slowly from one to fifty.',
        });
        sessions.add(c);
        try {
            await c.connect();
            const audio = waitFor(c, 'audio');
            c.sendText('Start counting now.');
            const chunk = await audio;
            expect((chunk.pcm as Int16Array).length).toBeGreaterThan(0);
            const done = waitFor(c, 'response.done');
            await c.interrupt({
                itemId: String(chunk.itemId),
                contentIndex: Number(chunk.contentIndex),
                playedMs: 0,
            });
            const response = await done;
            expect(response.response).toMatchObject({ status: 'cancelled' });
            process.stdout.write(
                '[live convo] PCM audio received, response canceled, playback history truncated\n',
            );
        } finally {
            c.close();
            sessions.delete(c);
        }
    }, 45_000);
});
