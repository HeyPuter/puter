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
 * Integration test for the Meta Model API provider.
 *
 * Muse Spark always reasons, and reasoning tokens count against the output
 * budget, so the max_tokens here is roomy enough to leave space for visible
 * text after the reasoning pass. Skipped when `PUTER_TEST_AI_META_API_KEY` is
 * unset.
 */

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
    INTEGRATION_TEST_TIMEOUT_MS,
    makeMeteringStub,
    optionalEnv,
    skipUnlessEnv,
    withTestActor,
} from '../../../integrationTestUtil.js';
import { AIChatStream } from '../../utils/Streaming.js';
import { MetaProvider } from './MetaProvider.js';

const ENV_VAR = 'PUTER_TEST_AI_META_API_KEY';

const makeProvider = () =>
    new MetaProvider(
        { apiKey: optionalEnv(ENV_VAR)! },
        makeMeteringStub(),
        // File resolution is not exercised here: these prompts are plain text,
        // so `puter_path` never reaches the stores.
        {} as never,
        {} as never,
    );

/** Run a streamed result to completion and return the NDJSON events it wrote. */
const drainChatStream = async (result: unknown) => {
    const chunks: string[] = [];
    const sink = new Writable({
        write(chunk, _enc, cb) {
            chunks.push(chunk.toString('utf8'));
            cb();
        },
    });
    const streamed = result as {
        init_chat_stream: (p: { chatStream: unknown }) => Promise<void>;
        finally_fn?: () => Promise<void>;
    };
    await streamed.init_chat_stream({
        chatStream: new AIChatStream({ stream: sink }),
    });
    await streamed.finally_fn?.();
    return chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map(
            (line) =>
                JSON.parse(line) as { type: string; [k: string]: unknown },
        );
};

describe.skipIf(skipUnlessEnv(ENV_VAR))('MetaProvider (integration)', () => {
    it(
        'returns a non-empty completion from muse-spark-1.2',
        { timeout: INTEGRATION_TEST_TIMEOUT_MS },
        async () => {
            const result = await withTestActor(() =>
                makeProvider().complete({
                    model: 'muse-spark-1.2',
                    messages: [
                        { role: 'user', content: 'Say hi in one word.' },
                    ],
                    max_tokens: 2048,
                    reasoning_effort: 'low',
                }),
            );

            const text = (result as { message?: { content?: unknown } }).message
                ?.content;
            expect(typeof text === 'string' && text.length > 0).toBe(true);
            const usage = (result as { usage?: Record<string, number> }).usage;
            expect(usage?.completion_tokens).toBeGreaterThan(0);
        },
    );

    it(
        'streams deltas and reports usage on the final chunk',
        { timeout: INTEGRATION_TEST_TIMEOUT_MS },
        async () => {
            const result = await withTestActor(() =>
                makeProvider().complete({
                    model: 'muse-spark-1.2',
                    messages: [{ role: 'user', content: 'Count to three.' }],
                    max_tokens: 2048,
                    reasoning_effort: 'low',
                    stream: true,
                }),
            );

            expect((result as { stream?: boolean }).stream).toBe(true);

            // Draining the stream is the point: `stream_options.include_usage`
            // is undocumented for this API, so the usage event arriving is what
            // proves a streamed completion gets metered at all.
            const events = await drainChatStream(result);
            const text = events
                .filter((e) => e.type === 'text')
                .map((e) => e.text)
                .join('');
            expect(text.length).toBeGreaterThan(0);

            const usage = events.find((e) => e.type === 'usage')?.usage as
                Record<string, number> | undefined;
            expect(usage?.completion_tokens).toBeGreaterThan(0);
        },
    );

    it(
        'serves muse-spark-1.1 as well',
        { timeout: INTEGRATION_TEST_TIMEOUT_MS },
        async () => {
            const result = await withTestActor(() =>
                makeProvider().complete({
                    model: 'meta/muse-spark-1.1',
                    messages: [
                        { role: 'user', content: 'Say hi in one word.' },
                    ],
                    max_tokens: 2048,
                    reasoning_effort: 'low',
                }),
            );

            const text = (result as { message?: { content?: unknown } }).message
                ?.content;
            expect(typeof text === 'string' && text.length > 0).toBe(true);
        },
    );
});
