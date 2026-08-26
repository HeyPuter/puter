/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

/**
 * Coercion of provider-native (Anthropic-style) completion results into the
 * OpenAI `choices[0]` shape the other providers already return through
 * `OpenAIUtil.handle_completion_output`: a string `message.content`,
 * OpenAI-style `message.tool_calls`, and a real `finish_reason`.
 *
 * The coercer is idempotent — a result that is already OpenAI-shaped passes
 * through by reference — so the driver can apply it uniformly regardless of
 * which provider (or fallback route) served the request.
 */

import type { IChatMessageResult } from '../types.js';

/**
 * Models released on or after this date return OpenAI-shaped responses by
 * default; callers opt out per call with `normalize: false`.
 */
export const OPENAI_SHAPE_CUTOFF = '2026-09-01';

const CUTOFF_MS = Date.parse(OPENAI_SHAPE_CUTOFF);

/**
 * Whether a model's release date puts it under the normalize-by-default policy.
 * Catalogs are inconsistent about precision (`'2026-09'` and `'2026-09-13'`
 * both occur), so dates are compared as timestamps rather than strings; a
 * missing or unparseable date counts as pre-cutoff.
 */
export const isPostCutoffRelease = (release_date?: string): boolean => {
    if (!release_date) return false;
    const ms = Date.parse(release_date);
    return Number.isFinite(ms) && ms >= CUTOFF_MS;
};

/**
 * Whether a result message is provider-native and needs coercing, as opposed to
 * already carrying the OpenAI shape (string-or-null `content`, optional
 * `tool_calls`), which must pass through untouched — including extra fields
 * like Gemini's `images` or the Responses API's `reasoning`.
 */
export const needsOpenAICoercion = (message: unknown): boolean => {
    if (typeof message === 'string') return true;
    if (!message || typeof message !== 'object') return false;
    const m = message as Record<string, unknown>;
    // The Anthropic SDK's message envelope self-identifies.
    if (m.type === 'message') return true;
    // A content-block array is the provider-native shape even without the
    // envelope marker (e.g. the fake provider's fixture messages).
    return Array.isArray(m.content);
};

const STOP_REASON_TO_FINISH_REASON: Record<string, string> = {
    end_turn: 'stop',
    stop_sequence: 'stop',
    max_tokens: 'length',
    tool_use: 'tool_calls',
    refusal: 'content_filter',
};

const mapStopReason = (
    stop_reason: unknown,
    fallback: string | undefined,
): string => {
    if (typeof stop_reason === 'string') {
        const mapped = STOP_REASON_TO_FINISH_REASON[stop_reason];
        if (mapped) return mapped;
    }
    return fallback ?? 'stop';
};

type OpenAIToolCall = {
    id: unknown;
    type: 'function';
    function: { name: unknown; arguments: string };
};

/**
 * Coerce a completion result to the OpenAI `choices[0]` shape.
 *
 * Returns `res` by reference when the message is already OpenAI-shaped.
 * Otherwise rebuilds `message` (text blocks joined into a string `content`,
 * `tool_use` blocks into `tool_calls`, `thinking` blocks into `reasoning`) and
 * remaps `finish_reason` from the Anthropic `stop_reason`. Everything else on
 * the result — `usage`, the top-level `compaction` artifact — passes through
 * unchanged. The caller owns the `normalized` marker.
 */
export const normalizeResultToOpenAI = (
    res: IChatMessageResult,
): IChatMessageResult => {
    if (!needsOpenAICoercion(res.message)) return res;

    if (typeof res.message === 'string') {
        return {
            ...res,
            message: {
                role: 'assistant',
                content: res.message,
                refusal: null,
            },
            finish_reason: res.finish_reason ?? 'stop',
        };
    }

    const native = res.message as Record<string, unknown>;
    const blocks = Array.isArray(native.content)
        ? (native.content as unknown[])
        : [];

    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];

    for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        switch (b.type) {
            case 'text':
                if (typeof b.text === 'string') textParts.push(b.text);
                break;
            case 'thinking':
                if (typeof b.thinking === 'string') {
                    reasoningParts.push(b.thinking);
                }
                break;
            case 'tool_use':
                toolCalls.push({
                    id: b.id,
                    type: 'function',
                    function: {
                        name: b.name,
                        arguments:
                            typeof b.input === 'string'
                                ? b.input
                                : JSON.stringify(b.input ?? {}),
                    },
                });
                break;
            // `redacted_thinking` is encrypted, and `compaction` already
            // rides the result's top-level `compaction` field; both — and
            // any block type introduced later — are dropped rather than
            // leaked into a shape that has nowhere to put them.
            default:
                break;
        }
    }

    // Null content alongside tool_calls mirrors OpenAI's own convention for
    // tool-only turns.
    const content = textParts.length > 0 ? textParts.join('') : null;
    const reasoning =
        reasoningParts.length > 0 ? reasoningParts.join('') : undefined;

    return {
        ...res,
        message: {
            role: 'assistant',
            content,
            refusal: null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            ...(reasoning !== undefined ? { reasoning } : {}),
        },
        finish_reason: mapStopReason(native.stop_reason, res.finish_reason),
    };
};
