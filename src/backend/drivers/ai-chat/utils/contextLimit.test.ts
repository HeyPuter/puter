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

import { describe, expect, it } from 'vitest';
import {
    contextLengthRetryCap,
    contextLengthRetryParams,
    isContextLengthError,
} from './contextLimit.js';

// Together's APIError carries the whole response body on `.error`, so the
// provider message sits one level deeper than the OpenAI SDK puts it.
const togetherError = (message: string) => ({
    status: 400,
    message: `400 {"error":{"message":${JSON.stringify(message)}}}`,
    error: { error: { message, type: 'invalid_request_error' } },
});

const openRouterError = (message: string) => ({ error: { message } });

const TOGETHER_MESSAGE =
    "Failed to start generation: The input token count (11) plus the requested output count (1048573) exceeds the model's maximum context length (1048576)";

const OPENROUTER_MESSAGE =
    "This endpoint's maximum context length is 4096 tokens. However, you requested 5000 tokens (900 of text input, 4100 in the output).";

describe('isContextLengthError', () => {
    it('recognises both vendors regardless of where the SDK nests the message', () => {
        expect(isContextLengthError(togetherError(TOGETHER_MESSAGE))).toBe(
            true,
        );
        expect(isContextLengthError(openRouterError(OPENROUTER_MESSAGE))).toBe(
            true,
        );
    });

    it('accepts the phrase wherever a vendor puts it, in any case', () => {
        expect(
            isContextLengthError(
                new Error("This model's maximum context length is 4096 tokens"),
            ),
        ).toBe(true);
        expect(
            isContextLengthError(
                openRouterError('MAXIMUM CONTEXT LENGTH exceeded for this request'),
            ),
        ).toBe(true);
    });

    it('ignores unrelated failures and non-object throws', () => {
        expect(isContextLengthError(openRouterError('Some other failure'))).toBe(
            false,
        );
        expect(isContextLengthError(new Error('socket hang up'))).toBe(false);
        expect(isContextLengthError(undefined)).toBe(false);
        expect(isContextLengthError('boom')).toBe(false);
    });
});

describe('contextLengthRetryCap', () => {
    it('sizes the retry to the room the window leaves', () => {
        expect(
            contextLengthRetryCap({
                error: togetherError(TOGETHER_MESSAGE),
                cap: 1048573,
                contextWindow: undefined,
            }),
        ).toBe(1048565);

        expect(
            contextLengthRetryCap({
                error: openRouterError(OPENROUTER_MESSAGE),
                cap: 4100,
                contextWindow: undefined,
            }),
        ).toBe(3196);
    });

    it('sizes to the room alone when the gate set no cap', () => {
        expect(
            contextLengthRetryCap({
                error: togetherError(TOGETHER_MESSAGE),
                cap: undefined,
                contextWindow: undefined,
            }),
        ).toBe(1048565);
    });

    it('never returns more than the cap the credit gate set', () => {
        expect(
            contextLengthRetryCap({
                error: togetherError(TOGETHER_MESSAGE),
                cap: 64,
                contextWindow: undefined,
            }),
        ).toBe(64);
    });

    it('falls back to the declared window when the message omits it', () => {
        expect(
            contextLengthRetryCap({
                error: openRouterError(
                    "This endpoint's maximum context length is exceeded. However, you requested 5000 tokens (900 of text input, 4100 in the output).",
                ),
                cap: 4100,
                contextWindow: 4096,
            }),
        ).toBe(3196);
    });

    it('reports no room when the prompt alone fills the window', () => {
        const cap = contextLengthRetryCap({
            error: openRouterError(
                "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.",
            ),
            cap: 500,
            contextWindow: undefined,
        });
        expect(cap).toBeLessThan(1);
    });

    it('measures the prompt when the rejection omits the input count', () => {
        expect(
            contextLengthRetryCap({
                error: openRouterError(
                    "This endpoint's maximum context length is 4096 tokens.",
                ),
                cap: 9999999,
                contextWindow: undefined,
                request: { messages: [{ role: 'user', content: 'x'.repeat(8000) }] },
            }),
        ).toBe(2096);
    });

    it('returns undefined when neither the message nor a request is available', () => {
        expect(
            contextLengthRetryCap({
                error: openRouterError(
                    "This endpoint's maximum context length is 4096 tokens.",
                ),
                cap: 9999999,
                contextWindow: 4096,
            }),
        ).toBeUndefined();
    });
});

describe('contextLengthRetryParams', () => {
    it('clamps max_tokens instead of dropping it, leaving the original intact', () => {
        const params = { model: 'm', max_tokens: 1048573 };
        const retry = contextLengthRetryParams(params, {
            error: togetherError(TOGETHER_MESSAGE),
            contextWindow: undefined,
        });

        expect(retry).toEqual({ model: 'm', max_tokens: 1048565 });
        expect(params.max_tokens).toBe(1048573);
    });

    it('keeps a cap whenever a window is known, even with no reported counts', () => {
        const retry = contextLengthRetryParams(
            {
                model: 'm',
                max_tokens: 9999999,
                messages: [{ role: 'user', content: 'x'.repeat(4000) }],
            },
            {
                error: openRouterError(
                    "This endpoint's maximum context length is 4096 tokens.",
                ),
                contextWindow: 4096,
            },
        );

        // 4096 of window less the 1000 the prompt is assumed to occupy.
        expect(retry!.max_tokens).toBe(3096);
    });

    it('gives up rather than retrying uncapped when no window can be determined', () => {
        expect(
            contextLengthRetryParams(
                { model: 'm', max_tokens: 9999999 },
                {
                    // Carries the phrase but no window figure, and the model
                    // declares none either.
                    error: openRouterError(
                        'Request exceeds the maximum context length for this model.',
                    ),
                    contextWindow: undefined,
                },
            ),
        ).toBeUndefined();
    });

    it('gives up when the estimate leaves no smaller cap to retry with', () => {
        // No counts in the rejection, a prompt the estimator sizes at ~100
        // tokens, and a cap already under the room that leaves: the retry
        // would be the request just rejected.
        expect(
            contextLengthRetryParams(
                {
                    model: 'm',
                    max_tokens: 3990,
                    messages: [{ role: 'user', content: 'x'.repeat(400) }],
                },
                {
                    error: openRouterError(
                        "This endpoint's maximum context length is 4096 tokens.",
                    ),
                    contextWindow: undefined,
                },
            ),
        ).toBeUndefined();
    });

    it('gives up rather than retrying when no output can fit', () => {
        expect(
            contextLengthRetryParams(
                { model: 'm', max_tokens: 500 },
                {
                    error: openRouterError(
                        "This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.",
                    ),
                    contextWindow: undefined,
                },
            ),
        ).toBeUndefined();
    });
});
