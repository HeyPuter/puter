/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Integration test for the OpenAI TTS provider.
 *
 * Uses `tts-1` (the cheapest OpenAI TTS model) with a 2-character
 * input to keep cost negligible. Skipped when
 * `PUTER_TEST_AI_OPENAI_API_KEY` is unset.
 */

import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { UsageInput } from '../../../../../services/metering/types.js';
import type { AiMeteringService } from '../../../../../util/aiCostFactor.js';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    readStreamResult,
    withTestActor,
} from '../../../shared/integrationTestUtil.js';
import { optionalEnv, skipUnlessEnv } from '../../../../../testEnv.js';
import { OpenAITTSProvider } from './OpenAITTSProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_OPENAI_API_KEY';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'OpenAITTSProvider (integration)',
    () => {
        it('returns an audio stream from tts-1', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const provider = new OpenAITTSProvider(makeMeteringStub(), {
                apiKey: optionalEnv(ENV_VAR)!,
            });

            const result = (await withTestActor(() =>
                provider.synthesize({
                    text: 'hi',
                    model: 'tts-1',
                    voice: 'alloy',
                    response_format: 'mp3',
                }),
            )) as { stream: Readable; content_type: string };

            expect(result).toMatchObject({
                content_type: expect.stringContaining('audio'),
            });
            expect(result.stream).toBeInstanceOf(Readable);

            // Drain the stream so we know real bytes came back, not an
            // empty placeholder.
            const chunks: Buffer[] = [];
            for await (const chunk of result.stream) {
                chunks.push(chunk as Buffer);
            }
            const total = chunks.reduce((n, c) => n + c.length, 0);
            expect(total).toBeGreaterThan(0);
        });

        it('streams gpt-4o-mini-tts audio and bills the tokens OpenAI reports', { timeout: INTEGRATION_TEST_TIMEOUT_MS }, async () => {
            const billed: UsageInput[][] = [];
            const metering = {
                ...makeMeteringStub(),
                batchIncrementUsages: async (_actor: unknown, usages: UsageInput[]) => {
                    billed.push(usages);
                    return [];
                },
            } as unknown as AiMeteringService;
            const provider = new OpenAITTSProvider(metering, {
                apiKey: optionalEnv(ENV_VAR)!,
            });

            const audio = await readStreamResult(
                await withTestActor(() =>
                    provider.synthesize({
                        text: 'Hello from Puter.',
                        model: 'gpt-4o-mini-tts',
                        voice: 'alloy',
                        instructions: 'Speak calmly.',
                    }),
                ),
            );

            // MP3: an ID3 tag or a frame sync.
            expect(
                audio.subarray(0, 3).toString('latin1') === 'ID3' ||
                    (audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0),
            ).toBe(true);
            await vi.waitFor(() => expect(billed).toHaveLength(1));
            const [input, output] = billed[0]!;
            expect(input).toMatchObject({
                usageType: 'openai:gpt-4o-mini-tts:input',
                usageAmount: expect.any(Number),
            });
            expect(output).toMatchObject({
                usageType: 'openai:gpt-4o-mini-tts:output:audio',
                usageAmount: expect.any(Number),
            });
            expect(output!.usageAmount).toBeGreaterThan(0);
        });
    },
);
