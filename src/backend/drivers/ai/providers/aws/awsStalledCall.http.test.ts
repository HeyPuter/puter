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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    scriptedHttp2Upstream,
    scriptedHttpUpstream,
    type ScriptedUpstream,
} from '../../../../testFixtures/scriptedUpstream.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../../../testUtil.js';
import { settleWithin } from '../../../../util/concurrency.js';
import textractPriceList from './ocr/fixtures/textract-us-west-2.json';
import pollyPriceList from './textToSpeech/fixtures/us-west-2.json';

const { TIMEOUT_MS } = vi.hoisted(() => ({ TIMEOUT_MS: 1000 }));

vi.mock('../../interfaces/textToSpeech/common.js', async (original) => ({
    ...(await original<
        typeof import('../../interfaces/textToSpeech/common.js')
    >()),
    TTS_UPSTREAM_TIMEOUT_MS: TIMEOUT_MS,
}));
vi.mock('../../interfaces/ocr/common.js', async (original) => ({
    ...(await original<typeof import('../../interfaces/ocr/common.js')>()),
    TEXTRACT_UPSTREAM_TIMEOUT_MS: TIMEOUT_MS,
}));

// More calls at once than a free account may run, and too few to reach its
// rate limit.
const BURST = 6;
const AWS = {
    access_key: 'AKIA-TEST',
    secret_key: 'secret',
    region: 'us-west-2',
};
const PRICE_LISTS: Record<string, unknown> = {
    AmazonPolly: pollyPriceList,
    AmazonTextract: textractPriceList,
};

interface Outcome {
    status: number;
    body: { code?: string; message?: string };
}

/**
 * A request AWS takes and never answers ends at its timeout, so it stops
 * counting against the caller's concurrency cap.
 */
describe('stalled AWS calls over /drivers/call', () => {
    const realFetch = globalThis.fetch;
    const savedEnv = {
        polly: process.env.AWS_ENDPOINT_URL_POLLY,
        textract: process.env.AWS_ENDPOINT_URL_TEXTRACT,
    };
    let polly: ScriptedUpstream<unknown>;
    let textract: ScriptedUpstream<unknown>;
    let env: PuterTestEnv;

    beforeAll(async () => {
        polly = await scriptedHttp2Upstream();
        textract = await scriptedHttpUpstream();
        process.env.AWS_ENDPOINT_URL_POLLY = polly.url;
        process.env.AWS_ENDPOINT_URL_TEXTRACT = textract.url;
        // Both providers price from AWS's public price list; serve recordings.
        vi.stubGlobal(
            'fetch',
            (input: string | URL | Request, init?: RequestInit) => {
                const url = String(
                    input instanceof Request ? input.url : input,
                );
                const service =
                    /\/aws\/(\w+)\/current\/us-west-2\/index\.json$/.exec(
                        url,
                    )?.[1];
                return service && PRICE_LISTS[service]
                    ? Promise.resolve(Response.json(PRICE_LISTS[service]))
                    : realFetch(input, init);
            },
        );
        env = await setupPuterTestEnv({
            providers: {
                'aws-polly': { aws: AWS },
                'aws-textract': { aws: AWS },
            },
        } as never);
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
        await polly?.close();
        await textract?.close();
        vi.unstubAllGlobals();
        for (const [key, value] of [
            ['AWS_ENDPOINT_URL_POLLY', savedEnv.polly],
            ['AWS_ENDPOINT_URL_TEXTRACT', savedEnv.textract],
        ] as const) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    const call = async (
        body: object,
        signal?: AbortSignal,
    ): Promise<Outcome> => {
        const response = await realFetch(
            new URL('/drivers/call', env.apiOrigin),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${env.users.user.apiToken}`,
                    Origin: env.apiOrigin,
                },
                body: JSON.stringify(body),
                signal,
            },
        );
        return {
            status: response.status,
            body: (await response.json()) as Outcome['body'],
        };
    };

    it.each([
        {
            name: 'text-to-speech',
            body: {
                interface: 'puter-tts',
                method: 'synthesize',
                args: { text: 'hello', voice: 'Joanna' },
            },
        },
        {
            name: 'OCR',
            body: {
                interface: 'puter-ocr',
                method: 'recognize',
                args: {
                    source: `data:image/png;base64,${Buffer.from('a scanned page').toString('base64')}`,
                },
            },
        },
    ])(
        'a burst of stalled $name calls ends as 504 upstream_timeout and gives its slots back',
        async ({ body }) => {
            const hangUp = new AbortController();
            try {
                const burst = Promise.all(
                    Array.from({ length: BURST }, () =>
                        call(body, hangUp.signal),
                    ),
                );
                // Never settling fails here, not at the test's own timeout.
                expect(
                    await settleWithin(burst, 10_000),
                    'every call in the burst settled',
                ).toBe(true);
                const outcomes = await burst;
                const refused = outcomes.filter((o) => o.status === 429);
                const admitted = outcomes.filter((o) => o.status !== 429);
                // The stalled calls held every slot while they were pending.
                expect(refused.length).toBeGreaterThan(0);
                for (const { body: refusal } of refused) {
                    expect(refusal.message).toContain(
                        'Too many concurrent requests',
                    );
                }
                expect(admitted.length).toBeGreaterThan(0);
                for (const outcome of admitted) {
                    expect(outcome).toMatchObject({
                        status: 504,
                        body: { code: 'upstream_timeout' },
                    });
                }

                // With the burst over, the next call is admitted again.
                expect((await call(body, hangUp.signal)).status).toBe(504);
            } finally {
                hangUp.abort();
            }
        },
        30_000,
    );
});
