import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    closeNodePuter,
    loadNodePuter,
} from '../../../puter-js/tests/api/harness/nodeSdkLoader';
import type {
    EnvManifest,
    PuterSDK,
} from '../../../puter-js/tests/api/harness/types';
import type { Conversation } from '../../../puter-js/types/modules/ai/convo';
import type { RealtimeSession } from '../../../puter-js/types/modules/ai/assistant';
import type { RealtimeServerEvent } from '../../../puter-js/types/modules/ai/types';
import { optionalEnv } from '../../drivers/integrationTestUtil';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil';
import type { IConfig } from '../../types';

const apiKey = optionalEnv('PUTER_TEST_AI_OPENAI_API_KEY');

describe.skipIf(!apiKey)('OpenAI realtime live relay', () => {
    let env: PuterTestEnv;
    let puter: PuterSDK;
    const sessions = new Set<RealtimeSession | Conversation>();

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
        session: RealtimeSession | Conversation,
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
