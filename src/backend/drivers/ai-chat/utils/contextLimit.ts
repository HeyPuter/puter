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
 * Recovery from an upstream rejection for overflowing a model's context window.
 *
 * Providers reject rather than truncate when the prompt plus the requested
 * output doesn't fit, so the request is retried under the room the window
 * actually leaves — never above the cap the credit gate set, when it set one,
 * which is what keeps the attempt bounded by the caller's balance. Output
 * priced at zero leaves no cap, and the retry then carries `window - input`
 * alone. Fitting the window is best effort; staying under that cap is not.
 */

import { estimatePromptTokens } from './usageEstimate.js';

/**
 * How far to over-count an estimated prompt. The shared estimator runs about
 * half low on JSON and code and lower still on denser text, and a retry sized
 * above the window earns the same rejection a second time — so assume the
 * common worst case rather than the central one.
 */
const ESTIMATED_PROMPT_MARGIN = 2;

/** Vendor phrasings for the context window, tried in order. */
const CONTEXT_WINDOW_PATTERNS = [
    /maximum context length \((\d+)\)/i,
    /maximum context length is (\d+)/i,
];

/** Vendor phrasings for the prompt's measured token count. */
const INPUT_TOKEN_PATTERNS = [
    /input token count \((\d+)\)/i,
    /(\d+) of text input/i,
    /resulted in (\d+) tokens/i,
];

/**
 * The upstream message, wherever the SDK put it. Together's `error` is the
 * whole response body, so its message sits one level deeper than OpenAI's.
 */
const errorMessage = (e: unknown): string | undefined => {
    const err = e as {
        error?: { message?: string; error?: { message?: string } };
        message?: string;
    };
    const message =
        err?.error?.error?.message ?? err?.error?.message ?? err?.message;
    return typeof message === 'string' ? message : undefined;
};

/** Whether the upstream rejected the request for exceeding its context window. */
export const isContextLengthError = (e: unknown): boolean =>
    (errorMessage(e) ?? '').toLowerCase().includes('maximum context length');

const firstMatch = (
    message: string,
    patterns: RegExp[],
): number | undefined => {
    for (const pattern of patterns) {
        const value = Number(message.match(pattern)?.[1]);
        if (Number.isFinite(value)) return value;
    }
    return undefined;
};

/**
 * The largest output cap that fits the window without exceeding `cap`.
 *
 * `undefined` when neither the rejection nor a request to measure supplies the
 * numbers to size one; below 1 when the prompt alone fills the window and no
 * retry can fit.
 */
export const contextLengthRetryCap = ({
    error,
    cap,
    contextWindow,
    request,
}: {
    error: unknown;
    /**
     * The credit gate's ceiling for this attempt, if it set one; the retry
     * never exceeds it.
     */
    cap: number | undefined;
    /** The model's declared window, used when the message omits it. */
    contextWindow: number | undefined;
    /** The request, measured when the rejection doesn't report its size. */
    request?: { messages?: unknown };
}): number | undefined => {
    const message = errorMessage(error) ?? '';

    const window =
        firstMatch(message, CONTEXT_WINDOW_PATTERNS) ?? contextWindow;
    const input =
        firstMatch(message, INPUT_TOKEN_PATTERNS) ??
        (request === undefined
            ? undefined
            : estimatePromptTokens(request.messages ?? []) *
              ESTIMATED_PROMPT_MARGIN);
    if (window === undefined || input === undefined) return undefined;

    const room = Math.min(cap ?? Number.POSITIVE_INFINITY, window - input);
    return Number.isFinite(room) ? Math.floor(room) : undefined;
};

/**
 * The same request sized to fit, or `undefined` when it can't be — no room
 * left, no window to size against, or no cap smaller than the one just rejected
 * — and the original rejection stands. Returns a shallow copy; the rejected
 * params are still the first attempt's record.
 */
export const contextLengthRetryParams = <
    T extends { max_tokens?: number | null; messages?: unknown },
>(
    params: T,
    options: { error: unknown; contextWindow: number | undefined },
): T | undefined => {
    const original = params.max_tokens ?? undefined;
    const cap = contextLengthRetryCap({
        error: options.error,
        cap: original,
        contextWindow: options.contextWindow,
        request: params,
    });
    if (cap === undefined || cap < 1) return undefined;
    // The upstream said `original` didn't fit; resending it unchanged only
    // earns the same rejection a second time.
    if (original !== undefined && cap >= original) return undefined;
    return { ...params, max_tokens: cap };
};
