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
 * The OpenAI chat-completions shapes the Gemini Interactions adapter emits.
 *
 * Puter normalises every chat upstream to chat-completions before it reaches
 * `handle_completion_output`, so an adapter that produces these shapes drops
 * into the existing pipeline — streaming handler, usage calculator, metering
 * and moderation included — without any of them learning what Interactions is.
 * Only the fields that pipeline actually reads are modelled here; this is a
 * translation target, not a re-declaration of the OpenAI SDK.
 */

/** A message part as it arrives from Puter's normalised `messages` array. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenAIChatMessage = any;

export interface IOpenAIToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
    /** Non-OpenAI passthrough (thought signatures, grounding). */
    extra_content?: Record<string, unknown>;
}

/**
 * Usage in the OpenAI convention: `completion_tokens` is inclusive of reasoning
 * tokens, and `prompt_tokens` is inclusive of cached tokens. Callers subtract
 * the details back out — see `INTERACTIONS_OUTPUT_EXCLUDES_THOUGHTS` in
 * `response.ts` for why the conversion is not a straight copy.
 */
export interface IOpenAIUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details: { cached_tokens: number };
    completion_tokens_details: { reasoning_tokens: number };
    /** Interactions-only: tokens spent inside server-side tools. */
    tool_use_tokens: number;
    /** Interactions-only: billable grounding invocations, as a real count. */
    grounding_requests: number;
}

export interface IOpenAIMessage {
    role: 'assistant';
    content: string | null;
    reasoning: string | null;
    refusal: null;
    tool_calls?: IOpenAIToolCall[];
    /**
     * Non-text outputs and provider metadata. Gemini already uses this channel
     * for grounding, and the streaming handler forwards it verbatim, so
     * generated images/video/audio ride along without widening `content`.
     */
    extra_content?: Record<string, unknown>;
}

export interface IOpenAIChoice {
    index: number;
    message: IOpenAIMessage;
    finish_reason: string;
}

export interface IOpenAICompletion {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: IOpenAIChoice[];
    usage: IOpenAIUsage;
}

export interface IOpenAIChunkDelta {
    role?: 'assistant';
    content?: string;
    reasoning?: string;
    tool_calls?: Array<IOpenAIToolCall & { index: number }>;
    extra_content?: Record<string, unknown>;
}

export interface IOpenAIChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: IOpenAIChunkDelta;
        finish_reason: string | null;
    }>;
    usage?: IOpenAIUsage;
}
