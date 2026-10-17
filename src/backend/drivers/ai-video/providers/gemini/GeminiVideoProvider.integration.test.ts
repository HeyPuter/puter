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
 * Integration test for Gemini Omni video generation against the live API,
 * through the authenticated `/drivers/call` route. Generates two 360p clips
 * (about $0.35 each): one from text, one from a 1x1 PNG. Skipped when
 * `PUTER_TEST_AI_GEMINI_API_KEY` is unset.
 */

import axios from 'axios';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UsageInput } from '../../../../services/metering/types.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../../../testUtil.js';
import { sniffVideoMime } from '../../../../util/mediaSniff.js';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    optionalEnv,
    skipUnlessEnv,
} from '../../../integrationTestUtil.js';

const ENV_VAR = 'PUTER_TEST_AI_GEMINI_API_KEY';
const MODEL = 'gemini-omni-1.1-flash';
const USAGE_PREFIX = `gemini-video-generation:${MODEL}`;
// One unary call renders the clip, which routinely takes a few minutes.
const VIDEO_TIMEOUT_MS = 5 * 60 * 1000;
const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe.skipIf(skipUnlessEnv(ENV_VAR))(
    'Gemini Omni video generation authenticated HTTP (integration)',
    () => {
        let env: PuterTestEnv;

        const generate = async (args: Record<string, unknown>) => {
            const endpoint = new URL('/drivers/call', env.apiOrigin);
            const host = endpoint.host;
            endpoint.hostname = '127.0.0.1';
            return axios.request({
                url: endpoint.toString(),
                method: 'POST',
                validateStatus: () => true,
                maxContentLength: Infinity,
                headers: {
                    Authorization: `Bearer ${env.users.user.apiToken}`,
                    Origin: env.apiOrigin,
                    Host: host,
                },
                data: {
                    interface: 'puter-video-generation',
                    method: 'generate',
                    args: {
                        model: MODEL,
                        prompt: 'A stationary red ball on a white table.',
                        ...args,
                    },
                },
            });
        };

        /** Generates once and checks the clip and what was metered for it. */
        const expectClipAndUsage = async (args: Record<string, unknown>) => {
            const batch = vi.spyOn(
                env.server.services.metering,
                'batchIncrementUsages',
            );
            try {
                const response = await generate(args);
                expect(response.status).toBe(200);
                const result = response.data.result as string;
                expect(result.startsWith('data:video/mp4;base64,')).toBe(true);
                const bytes = Buffer.from(
                    result.slice('data:video/mp4;base64,'.length),
                    'base64',
                );
                expect(bytes.byteLength).toBeGreaterThan(10_000);
                expect(sniffVideoMime(bytes)).toBe('video/mp4');

                const usages: UsageInput[] = batch.mock.calls
                    .flatMap(([, entries]) => entries)
                    .filter((u) => u.usageType.startsWith(`${USAGE_PREFIX}:`));
                const byType = (suffix: string) =>
                    usages.find((u) => u.usageType === `${USAGE_PREFIX}:${suffix}`);
                const input = byType('input');
                const video = byType('output:video');
                expect(input?.usageAmount).toBeGreaterThan(0);
                expect(input?.costOverride).toBe(input!.usageAmount * 150);
                expect(video?.usageAmount).toBeGreaterThan(1000);
                expect(video?.costOverride).toBe(video!.usageAmount * 1750);
                const text = byType('output:text');
                if (text) {
                    expect(text.costOverride).toBe(text.usageAmount * 900);
                }
                return { input: input!.usageAmount };
            } finally {
                batch.mockRestore();
            }
        };

        beforeAll(async () => {
            env = await setupPuterTestEnv({
                providers: {
                    gemini: { apiKey: optionalEnv(ENV_VAR)! },
                    ollama: { enabled: false },
                },
                unlimitedMetering: true,
                extensions: [],
            });
        }, INTEGRATION_TEST_TIMEOUT_MS);

        afterAll(async () => {
            await env?.shutdown();
        });

        it(
            'generates a 360p clip from text, metering input and video tokens',
            { timeout: VIDEO_TIMEOUT_MS },
            async () => {
                await expectClipAndUsage({ size: '360p' });
            },
        );

        it(
            'generates a portrait 360p clip from an image',
            { timeout: VIDEO_TIMEOUT_MS },
            async () => {
                const { input } = await expectClipAndUsage({
                    size: '360x640',
                    input_reference: PNG,
                });
                // The image is counted on top of the prompt.
                expect(input).toBeGreaterThan(20);
            },
        );
    },
);
