import { HttpError } from '@heyputer/backend/src/core/http';
import { Context } from '../../../core/context.js';
import { mediaUrlOf, unsupportedMediaTextPart } from './mediaParts.js';
import { fromFinishReason } from './stopReason.js';

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

// Anthropic-only content block types an OpenAI-family provider can never
// carry — dropped rather than forwarded unrecognized. A reasoning/server-tool
// turn survives a fallback with no such content left if nothing else was on
// the message (the caller's next turn simply isn't told the dropped part
// happened, same as any other lossy-dialect fallback).
const ANTHROPIC_ONLY_BLOCK_TYPES = new Set([
    'thinking',
    'redacted_thinking',
    'server_tool_use',
]);

const isServerResultBlockType = (type) =>
    typeof type === 'string' && type.endsWith('_tool_result');

const flattenToolResultContentItem = (item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    switch (item.type) {
        case 'text':
            return typeof item.text === 'string' ? item.text : '';
        case 'tool_reference':
            return `[tool reference: ${item.name ?? ''}]`;
        case 'image':
        case 'document':
        case 'search_result':
            return unsupportedMediaTextPart(
                `${item.type} content is not supported by this model`,
            ).text;
        default:
            return '';
    }
};

/** A `tool_result.content` array (or string) flattened to plain text. */
const flattenToolResultContent = (content) => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(flattenToolResultContentItem).join('');
};

const transformBlockForOpenAI = (block, { keepCacheControl }) => {
    if (!block || typeof block !== 'object') return block;
    const type = block.type;
    if (ANTHROPIC_ONLY_BLOCK_TYPES.has(type) || isServerResultBlockType(type)) {
        return undefined;
    }
    if (type === 'tool_result') {
        const flattened = flattenToolResultContent(block.content);
        const {
            citations: _citations,
            cache_control,
            is_error,
            ...rest
        } = block;
        return {
            ...rest,
            content: is_error ? `Error: ${flattened}` : flattened,
            ...(keepCacheControl && cache_control ? { cache_control } : {}),
        };
    }
    const { citations: _citations, cache_control, ...rest } = block;
    return {
        ...rest,
        ...(keepCacheControl && cache_control ? { cache_control } : {}),
    };
};

const BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:';

/**
 * Copy-on-write pre-pass that strips the Anthropic-only shape an OpenAI-family
 * provider can receive on fallback — a prior turn's native Claude content
 * (`thinking`/`redacted_thinking`/`server_tool_use`/`*_tool_result` blocks,
 * `cache_control`, `citations`, `clear_at`) replayed into a request this
 * dialect can't carry. Runs before `process_input_messages(_responses_api)`,
 * which still mutates in place — operating on this pass's copy keeps the
 * caller's own message objects untouched across a fallback retry.
 *
 * @param {Message[]} messages
 * @param {{ keepCacheControl?: boolean }} [opts] `keepCacheControl`: OpenRouter
 *   passes Anthropic prompt caching through, so it keeps the field.
 * @returns {Message[]}
 */
export const toOpenAIChatMessages = (
    messages,
    { keepCacheControl = false } = {},
) => {
    const out = [];
    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') {
            out.push(msg);
            continue;
        }
        const { clear_at: _clearAt, cache_control, ...rest } = msg;
        if (keepCacheControl && cache_control !== undefined) {
            rest.cache_control = cache_control;
        }
        if (!Array.isArray(msg.content)) {
            out.push(rest);
            continue;
        }
        const content = [];
        for (const block of msg.content) {
            if (
                block &&
                typeof block === 'object' &&
                block.type === 'text' &&
                typeof block.text === 'string' &&
                block.text.startsWith(BILLING_HEADER_PREFIX)
            ) {
                continue;
            }
            const transformed = transformBlockForOpenAI(block, {
                keepCacheControl,
            });
            if (transformed !== undefined) content.push(transformed);
        }
        // Nothing left to send from this message (its only block(s) were
        // Anthropic-only content) — drop it rather than send empty content.
        if (content.length === 0) continue;
        out.push({ ...rest, content });
    }
    return out;
};

/**
 * Process input messages from Puter's normalized format to OpenAI's format May
 * make changes in-place.
 *
 * @param {Message[]} messages - Array of normalized messages
 * @returns {Message[]} - Array of messages in OpenAI format
 */
export const process_input_messages = async (messages) => {
    for (const msg of messages) {
        if (!msg.content) continue;
        if (typeof msg.content !== 'object') continue;

        const content = msg.content;

        for (const o of content) {
            if (o['image_url'] && !o.type) {
                o.type = 'image_url';
            }
            if (o['video_url'] && !o.type) {
                o.type = 'video_url';
            }
        }

        // coerce tool calls
        let is_tool_call = false;
        for (let i = content.length - 1; i >= 0; i--) {
            const content_block = content[i];

            if (content_block.type === 'tool_use') {
                if (!msg.tool_calls) {
                    msg.tool_calls = [];
                    is_tool_call = true;
                }
                msg.tool_calls.push({
                    id: content_block.id,
                    type: 'function',
                    function: {
                        name: content_block.name,
                        arguments: JSON.stringify(content_block.input),
                    },
                    ...(content_block.extra_content
                        ? { extra_content: content_block.extra_content }
                        : {}),
                });
                content.splice(i, 1);
            }
        }

        if (is_tool_call) msg.content = null;

        // coerce tool results
        // (we assume multiple tool results were already split into separate messages)
        for (let i = content.length - 1; i >= 0; i--) {
            const content_block = content[i];
            if (content_block.type !== 'tool_result') continue;
            msg.role = 'tool';
            msg.tool_call_id = content_block.tool_use_id;
            msg.content = content_block.content;
        }
    }

    return messages;
};

export const process_input_messages_responses_api = async (messages) => {
    // Pre-split round-tripped compaction blocks into standalone Responses
    // compaction input items, preserving any sibling content (e.g. the
    // assistant's reply text) as its own message. A compaction item represents
    // prior history, so it precedes the message it was attached to. This avoids
    // collapsing the whole message into a single compaction item and dropping
    // the rest of its content.
    const expanded = [];
    for (let msg of messages) {
        // Round-tripped reasoning artifacts become standalone `reasoning`
        // input items — the shape the Responses API expects them back in —
        // and precede the message they were attached to, same as compaction.
        // `reasoning`/`refusal`/`normalized` are output-only fields the input
        // schema rejects, and a caller replaying a normalized message carries
        // them along with the details.
        if (msg && typeof msg === 'object') {
            const details = msg.reasoning_details;
            if (
                details !== undefined ||
                msg.reasoning !== undefined ||
                msg.refusal !== undefined ||
                msg.normalized !== undefined
            ) {
                // Rebind to a stripped copy rather than deleting: the driver
                // reuses this same array across fallback attempts, and these
                // objects belong to the caller.
                const {
                    reasoning_details: _details,
                    reasoning: _reasoning,
                    refusal: _refusal,
                    normalized: _normalized,
                    ...rest
                } = msg;
                msg = rest;
            }
            if (Array.isArray(details)) {
                for (const block of details) {
                    if (!block || block.type !== 'reasoning') continue;
                    expanded.push({
                        type: 'reasoning',
                        ...(block.id !== undefined ? { id: block.id } : {}),
                        ...(block.encrypted_content !== undefined
                            ? { encrypted_content: block.encrypted_content }
                            : {}),
                        summary: Array.isArray(block.summary)
                            ? block.summary
                            : [],
                    });
                }
            }
        }

        if (msg && Array.isArray(msg.content)) {
            const compactionBlocks = msg.content.filter(
                (c) => c && c.type === 'compaction',
            );
            if (compactionBlocks.length > 0) {
                for (const block of compactionBlocks) {
                    expanded.push({
                        type: 'compaction',
                        ...(block.id !== undefined ? { id: block.id } : {}),
                        encrypted_content: block.encrypted_content,
                    });
                }
                const rest = msg.content.filter(
                    (c) => !(c && c.type === 'compaction'),
                );
                if (rest.length > 0) {
                    expanded.push({ ...msg, content: rest });
                }
                continue;
            }
        }
        expanded.push(msg);
    }
    // Copy-on-write from here on: the rewrites below are Responses-specific and
    // the driver reuses these message objects on fallback to Chat Completions
    // routes.
    messages = expanded.map((msg) => {
        if (!msg || typeof msg !== 'object') return msg;
        if (!Array.isArray(msg.content)) return { ...msg };
        return {
            ...msg,
            content: msg.content.map((part) =>
                part && typeof part === 'object' && !Array.isArray(part)
                    ? { ...part }
                    : part,
            ),
        };
    });

    const flattened = [];
    for (const msg of messages) {
        const content_as_string = (content) => {
            if (content === undefined || content === null) return '';
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                return content
                    .map((part) => {
                        if (typeof part === 'string') return part;
                        if (part && typeof part.text === 'string')
                            return part.text;
                        if (part && typeof part.content === 'string')
                            return part.content;
                        return '';
                    })
                    .join('');
            }
            if (content && typeof content.text === 'string')
                return content.text;
            if (content && typeof content.content === 'string')
                return content.content;
            return '';
        };

        if (msg.role === 'tool') {
            msg.type = 'function_call_output';
            msg.call_id = msg.tool_call_id || msg.tool_use_id;
            msg.output = content_as_string(msg.content);
            delete msg.role;
            delete msg.content;
            delete msg.tool_call_id;
            delete msg.tool_use_id;
            delete msg.tool_calls;
            flattened.push(msg);
            continue;
        }

        if (!msg.content || typeof msg.content !== 'object') {
            flattened.push(msg);
            continue;
        }

        const content = msg.content;

        for (let i = 0; i < content.length; i++) {
            const o = content[i];
            if (!o || typeof o !== 'object') continue;
            // Responses wants `input_image` with a bare string URL and `detail`
            // beside it; it rejects the Chat Completions `image_url` part.
            if (o.type === 'image_url' || (o.image_url && !o.type)) {
                const url = mediaUrlOf(o.image_url);
                const detail =
                    (o.image_url && typeof o.image_url === 'object'
                        ? o.image_url.detail
                        : undefined) ?? o.detail;
                const {
                    type: _type,
                    image_url: _imageUrl,
                    detail: _detail,
                    ...rest
                } = o;
                content[i] = {
                    ...rest,
                    type: 'input_image',
                    detail: detail ?? 'auto',
                    ...(url !== undefined ? { image_url: url } : {}),
                };
                continue;
            }
            // The Responses API has no video input item.
            if (o.type === 'video_url' || (o.video_url && !o.type)) {
                content[i] = unsupportedMediaTextPart(
                    'video input is not supported by this model',
                );
            }
        }

        // coerce tool calls
        let is_tool_call = false;
        for (let i = content.length - 1; i >= 0; i--) {
            const content_block = content[i];
            if (
                content_block.type === 'text' &&
                (msg.role === 'user' || msg.role === 'system')
            ) {
                content_block.type = 'input_text';
            }
            if (content_block.type === 'text' && msg.role === 'assistant') {
                content_block.type = 'output_text';
            }

            if (content_block.type === 'tool_use') {
                if (!msg.tool_calls) {
                    msg.tool_calls = [];
                    is_tool_call = true;
                }
                msg.tool_calls.push({
                    id: content_block.id,
                    canonical_id: content_block.canonical_id,
                    type: 'function',
                    function: {
                        name: content_block.name,
                        arguments: JSON.stringify(content_block.input),
                    },
                    ...(content_block.extra_content
                        ? { extra_content: content_block.extra_content }
                        : {}),
                });

                content.splice(i, 1);
            }
        }

        if (is_tool_call) {
            // One Responses `function_call` item per tool_use block. A
            // parallel tool-call turn used to keep only the first, which
            // silently dropped every other call the model made — the
            // caller's next request then carries no `function_call_output`
            // for them and the Responses API 400s on the mismatch.
            // `tool_calls` was built walking `content` back to front, so
            // restore the original left-to-right order here.
            for (const toolCall of msg.tool_calls.slice().reverse()) {
                flattened.push({
                    type: 'function_call',
                    call_id: toolCall.id,
                    id: toolCall.canonical_id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                    ...(toolCall.extra_content
                        ? { extra_content: toolCall.extra_content }
                        : {}),
                });
            }
            continue;
        }

        // coerce tool results
        for (let i = content.length - 1; i >= 0; i--) {
            const content_block = content[i];
            if (content_block.type !== 'tool_result') continue;
            msg.type = 'function_call_output';
            msg.call_id = content_block.tool_use_id;
            msg.output = content_block.content;

            delete msg.role;
            delete msg.content;
        }

        flattened.push(msg);
    }

    return flattened;
};

export const create_usage_calculator = ({ model_details }) => {
    return ({ usage }) => {
        const tokens = [];

        tokens.push({
            type: 'prompt',
            model: model_details.id,
            amount: usage.prompt_tokens,
            cost: model_details.cost.input * usage.prompt_tokens,
        });

        tokens.push({
            type: 'completion',
            model: model_details.id,
            amount: usage.completion_tokens,
            cost: model_details.cost.output * usage.completion_tokens,
        });

        return tokens;
    };
};

export const extractMeteredUsage = (usage) => {
    return {
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
        cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    };
};

/**
 * The `{prompt_tokens, completion_tokens, cached_tokens, cache_write_tokens}`
 * shape every OpenAI-family `usage_calculator` already returns for billing,
 * mapped to the provider-neutral `UsageDetails` the end-of-stream/non-stream
 * result carries. `inputTokens`/`outputTokens` are the same numbers already
 * billed — this never introduces a new figure, only exposes the breakdown.
 *
 * @param {Record<string, number> | undefined | null} trackedUsage
 * @returns {import('../types.js').UsageDetails | undefined}
 */
export const usageDetailsFromTrackedUsage = (trackedUsage) => {
    if (!trackedUsage || typeof trackedUsage !== 'object') return undefined;
    // OpenRouter, Infron and Ollama track `{prompt, completion,
    // input_cache_read}` instead; any other shape is left to the driver.
    const input = trackedUsage.prompt_tokens ?? trackedUsage.prompt;
    const output = trackedUsage.completion_tokens ?? trackedUsage.completion;
    if (input === undefined && output === undefined) return undefined;
    const cacheRead =
        trackedUsage.cached_tokens ?? trackedUsage.input_cache_read;
    return {
        inputTokens: input ?? 0,
        outputTokens: output ?? 0,
        ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
        ...(trackedUsage.cache_write_tokens
            ? { cacheWrite5mTokens: trackedUsage.cache_write_tokens }
            : {}),
    };
};

// Renames one object's DeepSeek-wire `reasoning_content` to the `reasoning`
// key Puter exposes, without clobbering an existing `reasoning`.
const renameReasoningContent = (obj) => {
    if (obj.reasoning === undefined && obj.reasoning_content !== undefined) {
        obj.reasoning = obj.reasoning_content;
    }
    // Dropped even when `reasoning` already won: a provider sending both
    // means the same thing twice, and the vendor key is the one Puter does not
    // expose. Pinned by BytePlusProvider.test.ts / ZAIProvider.test.ts, whose
    // fixtures name the value 'should-be-dropped'.
    delete obj.reasoning_content;
};

/**
 * Normalize a non-streaming completion result whose provider follows the
 * DeepSeek wire convention (`reasoning_content` on the message and content
 * parts) to Puter's `reasoning` key. The streaming path already does this in
 * create_chat_stream_handler.
 */
export const normalizeReasoningContent = (result) => {
    if (!result || typeof result !== 'object') return;
    if (!('message' in result) || !result.message) return;

    const message = result.message;
    renameReasoningContent(message);

    if (!Array.isArray(message.content)) return;
    for (const part of message.content) {
        if (part && typeof part === 'object' && !Array.isArray(part)) {
            renameReasoningContent(part);
        }
    }
};

export const create_chat_stream_handler =
    ({ deviations, completion, usage_calculator }) =>
    async ({ chatStream }) => {
        deviations = Object.assign(
            {
                // affected by: Groq
                index_usage_from_stream_chunk: (chunk) => chunk.usage,
                // affected by: Mistral
                chunk_but_like_actually: (chunk) => chunk,
                index_tool_calls_from_stream_choice: (choice) =>
                    choice.delta.tool_calls,
            },
            deviations,
        );

        const message = chatStream.message();
        let textblock = message.contentBlock({ type: 'text' });
        let toolblock = null;
        let mode = 'text';
        const tool_call_blocks = [];
        // A parallel tool-call turn opens one block per call; each is ended
        // exactly once, in open order, so every call reaches the stream.
        const opened_tool_blocks = [];
        const ended_tool_blocks = new Set();
        const endToolBlock = (block) => {
            if (!block || ended_tool_blocks.has(block)) return;
            ended_tool_blocks.add(block);
            block.end();
        };

        let last_usage = null;
        let last_extra_content = null;
        let finish_reason = null;
        for await (let chunk of completion) {
            chunk = deviations.chunk_but_like_actually(chunk);
            const chunk_usage = deviations.index_usage_from_stream_chunk(chunk);
            if (chunk_usage) last_usage = chunk_usage;
            if (chunk.choices.length < 1) continue;

            const choice = chunk.choices[0];
            // Arrives on the final chunk; capture it before any `continue`
            // below skips the rest of this iteration. Mistral's SDK
            // spells it in camelCase.
            const chunk_finish_reason =
                choice.finish_reason ?? choice.finishReason;
            if (chunk_finish_reason) finish_reason = chunk_finish_reason;

            // Deepseek returns choice.delta.reasoning_content, openrouter returns choice.delta.reasoning.
            if (choice.delta.reasoning_content || choice.delta.reasoning) {
                textblock.addReasoning(
                    choice.delta.reasoning_content || choice.delta.reasoning,
                );
                // Q: Why don't "continue" to next chunk here?
                // A: For now, reasoning_content and content never appear together, but I’m not sure if they’ll always be mutually exclusive.
            }

            if (choice.delta.content) {
                if (mode === 'tool') {
                    endToolBlock(toolblock);
                    mode = 'text';
                    textblock = message.contentBlock({ type: 'text' });
                }
                textblock.addText(choice.delta.content);
                continue;
            }

            if (choice.delta.extra_content) {
                // Gemini specific thing for metadata, we will basically be appending onto the current message by abusing .addText a little
                // Apps have to choose to handle extra_content themselves, it doesn't seem like theres a way we can do it in a backwards
                // compatible fashion since most streaming apps will handle chat history by continuously updating content themselves
                // This doesn't present us a chance to add in an extra object for gemini's chat continuing features
                // Don't let a later extra_content chunk without grounding clobber an
                // earlier one that carried grounding_metadata (used for metering).
                if (
                    choice.delta.extra_content.grounding_metadata ||
                    !last_extra_content?.grounding_metadata
                ) {
                    last_extra_content = choice.delta.extra_content;
                }
                textblock.addExtraContent(choice.delta.extra_content);
            }

            const tool_calls =
                deviations.index_tool_calls_from_stream_choice(choice);
            if (tool_calls) {
                if (mode === 'text') {
                    mode = 'tool';
                    textblock.end();
                }
                for (const tool_call of tool_calls) {
                    if (!tool_call_blocks[tool_call.index]) {
                        toolblock = message.contentBlock({
                            type: 'tool_use',
                            id: tool_call.id,
                            name: tool_call.function.name,
                            ...(tool_call.extra_content
                                ? { extra_content: tool_call.extra_content }
                                : {}),
                        });
                        tool_call_blocks[tool_call.index] = toolblock;
                        opened_tool_blocks.push(toolblock);
                    } else {
                        toolblock = tool_call_blocks[tool_call.index];
                    }
                    toolblock.addPartialJSON(tool_call.function.arguments);
                }
            }
        }

        Context.get('abortSignal')?.throwIfAborted();
        if (!finish_reason && !last_usage) {
            throw new Error('Stream ended before completion');
        }

        // TODO DS: this is a bit too abstracted... this is basically just doing the metering now
        // No usage chunk means there is nothing to meter from — reaching into
        // a null usage object here used to throw, which took down a response
        // the upstream had already produced *and* skipped its billing. Leave
        // the usage undefined instead; the driver charges an estimate for a
        // stream that produced output nobody reported.
        const usage = last_usage
            ? usage_calculator({
                  usage: last_usage,
                  extra_content: last_extra_content,
              })
            : undefined;
        // The calculator just metered. Reported here, not only via `end`:
        // a throw in the block flushes below (a malformed tool-call payload,
        // say) must not leave a metered stream looking unmetered — the driver
        // would charge its estimate on top.
        chatStream.reportUsage(usage);
        if (finish_reason) {
            chatStream.setStop({ reason: fromFinishReason(finish_reason) });
        } else if (opened_tool_blocks.length > 0) {
            chatStream.setStop({ reason: 'tool_use' });
        }
        const usageDetails = usageDetailsFromTrackedUsage(usage);
        if (usageDetails) chatStream.setUsageDetails(usageDetails);

        if (mode === 'text') textblock.end();
        for (const block of opened_tool_blocks) endToolBlock(block);

        message.end();
        chatStream.end(usage);
    };

export const create_chat_stream_handler_responses_api =
    ({ deviations, completion, usage_calculator }) =>
    async ({ chatStream }) => {
        deviations = Object.assign(
            {
                // affected by: Groq
                index_usage_from_stream_chunk: (chunk) => chunk.usage,
                // affected by: Mistral
                chunk_but_like_actually: (chunk) => chunk,
                index_tool_calls_from_stream_choice: (choice) =>
                    choice.delta.tool_calls,
            },
            deviations,
        );

        const message = chatStream.message();
        const textblock = message.contentBlock({ type: 'text' });
        let toolblock = null;
        const mode = 'text';

        let last_usage = null;
        let completed = false;
        let sawFunctionCall = false;
        let incompleteReason = null;
        let webSearchCalls = 0;
        let toolUsage = null;
        for await (const chunk of completion) {
            if (chunk.type === 'response.failed' || chunk.type === 'error') {
                throw new Error(
                    chunk.response?.error?.message ??
                        chunk.message ??
                        'Upstream response failed',
                );
            }
            if (chunk.type === 'response.output_text.delta') {
                textblock.addText(chunk.delta);
                continue;
            }

            // Reasoning summaries stream as their own delta events; route
            // them to the same `reasoning` channel the chat-completions
            // handler uses for Deepseek/OpenRouter, so a streamed reasoning
            // model reads identically whichever API served it.
            if (chunk.type === 'response.reasoning_summary_text.delta') {
                textblock.addReasoning(chunk.delta);
                continue;
            }

            // Each summary part is a separate delta stream; separate them with
            // a blank line, matching the non-stream handler's join.
            if (
                chunk.type === 'response.reasoning_summary_part.added' &&
                chunk.summary_index > 0
            ) {
                textblock.addReasoning('\n\n');
                continue;
            }

            // A truncated response ends with `response.incomplete`, which
            // carries the same usage and status as `response.completed`.
            if (
                chunk.type === 'response.completed' ||
                chunk.type === 'response.incomplete'
            ) {
                completed = true;
                last_usage = chunk.response.usage;
                toolUsage = chunk.response.tool_usage ?? toolUsage;
                if (
                    chunk.response.status === 'incomplete' &&
                    chunk.response.incomplete_details?.reason ===
                        'max_output_tokens'
                ) {
                    incompleteReason = 'max_tokens';
                }
            }

            if (
                chunk.type === 'response.output_item.done' &&
                chunk.item?.type === 'reasoning'
            ) {
                const item = chunk.item;
                if (
                    item.id !== undefined ||
                    item.encrypted_content !== undefined
                ) {
                    chatStream.reasoningDetail({
                        type: 'reasoning',
                        ...(item.id !== undefined ? { id: item.id } : {}),
                        ...(item.encrypted_content !== undefined
                            ? { encrypted_content: item.encrypted_content }
                            : {}),
                        ...(Array.isArray(item.summary)
                            ? { summary: item.summary }
                            : {}),
                    });
                }
                continue;
            }

            if (
                chunk.type === 'response.output_item.done' &&
                chunk.item?.type === 'compaction'
            ) {
                // Inline compaction fired mid-response — normalize the artifact
                // into the canonical internal compaction event.
                chatStream.compaction({
                    id: chunk.item.id,
                    encrypted_content: chunk.item.encrypted_content,
                });
                continue;
            }

            if (
                chunk.type === 'response.output_item.done' &&
                chunk.item?.type === 'web_search_call'
            ) {
                // Only the search action itself is billed — a page-open or
                // find probe inside the same web_search_call is free.
                if ((chunk.item.action?.type ?? 'search') === 'search') {
                    webSearchCalls++;
                }
                continue;
            }

            if (
                chunk.type === 'response.output_item.done' &&
                chunk.item?.type === 'function_call'
            ) {
                sawFunctionCall = true;
                const tool_call = chunk.item;
                toolblock = message.contentBlock({
                    type: 'tool_use',
                    canonical_id: tool_call.id,
                    id: tool_call.call_id,
                    name: tool_call.name,
                    ...(tool_call.extra_content
                        ? { extra_content: tool_call.extra_content }
                        : {}),
                });
                toolblock.addPartialJSON(tool_call.arguments);
                toolblock.end();
            }
        }

        Context.get('abortSignal')?.throwIfAborted();
        if (!completed) throw new Error('Stream ended before completion');

        // TODO DS: this is a bit too abstracted... this is basically just doing the metering now
        // Missing usage is left undefined rather than fed to the calculator —
        // see the sibling handler above, including why usage is reported
        // before the block flushes.
        const usage = last_usage
            ? usage_calculator({
                  usage: last_usage,
                  webSearchCalls,
                  tool_usage: toolUsage,
                  setUsageCosts: (c) => chatStream.setUsageCosts(c),
              })
            : undefined;
        chatStream.reportUsage(usage);
        chatStream.setStop({
            reason:
                incompleteReason ?? (sawFunctionCall ? 'tool_use' : 'end_turn'),
        });
        const usageDetails = usageDetailsFromTrackedUsage(usage);
        if (usageDetails) chatStream.setUsageDetails(usageDetails);

        if (mode === 'text') textblock.end();
        if (mode === 'tool') toolblock.end();

        message.end();
        chatStream.end(usage);
    };

export const handle_completion_output = async (
    /**
     * @type {Record<string, unknown> & {
     *     usage_calculator: (args: {
     *         usage: import('openai/resources/completions.mjs').CompletionUsage;
     *     }) => unknown;
     * }}
     */
    { deviations, stream, completion, moderate, usage_calculator, finally_fn },
) => {
    deviations = Object.assign(
        {
            // affected by: Mistral
            coerce_completion_usage: (completion) => completion.usage,
        },
        deviations,
    );

    if (stream) {
        const init_chat_stream = create_chat_stream_handler({
            deviations,
            completion,
            usage_calculator,
        });

        return {
            stream: true,
            init_chat_stream,
            finally_fn,
        };
    }

    if (finally_fn) await finally_fn();

    // Metered before moderation: the completion exists and the upstream has
    // billed us for it whether or not we go on to withhold it, and running
    // the moderation gate first meant a flagged completion was served to
    // nobody and charged to nobody.
    const ret = completion.choices[0];
    const completion_usage = deviations.coerce_completion_usage(completion);
    ret.usage = usage_calculator
        ? usage_calculator({
              ...completion,
              usage: completion_usage,
          })
        : {
              input_tokens: completion_usage.prompt_tokens,
              output_tokens: completion_usage.completion_tokens,
          };
    if (usage_calculator) {
        const usageDetails = usageDetailsFromTrackedUsage(ret.usage);
        if (usageDetails) ret.usageDetails = usageDetails;
    }

    // Providers following the DeepSeek wire convention return
    // `reasoning_content`; expose it as Puter's `reasoning` key here so every
    // provider's message carries the same attribute (the streaming path does
    // the equivalent rename on deltas).
    normalizeReasoningContent(ret);

    const mod_text = completion.choices[0].message.content;
    if (moderate && mod_text !== null) {
        const moderation_result = await moderate(mod_text);
        if (moderation_result.flagged) {
            // `code` tells the driver this is a refusal of a completion that
            // was produced and charged, not a route failure — retrying it on
            // a fallback provider would bill the account again for another
            // completion the user will never see.
            throw new HttpError(400, 'message is not allowed', {
                legacyCode: 'bad_request',
                code: 'moderation_flagged',
            });
        }
    }

    return ret;
};

/**
 * @param {object} params
 * @param {Record<string, unknown>} [params.deviations]
 * @param {boolean} [params.stream]
 * @param {any} params.completion
 * @param {((text: string) => Promise<{ flagged: boolean }>) | undefined} [params.moderate]
 * @param {(args: {
 *     usage: import('openai/resources/responses/responses.mjs').ResponseUsage;
 *     webSearchCalls?: number;
 *     tool_usage?: Record<string, unknown>;
 *     setUsageCosts?: (costs: Record<string, number>) => void;
 * }) => unknown} params.usage_calculator
 * @param {() => Promise<void>} [params.finally_fn]
 * @returns {ReturnType<import('../types').IChatProvider['complete']>}
 */
export const handle_completion_output_responses_api = async ({
    deviations,
    stream,
    completion,
    moderate,
    usage_calculator,
    finally_fn,
}) => {
    deviations = Object.assign(
        {
            // affected by: Mistral
            coerce_completion_usage: (completion) => completion.usage,
        },
        deviations,
    );

    if (stream) {
        const init_chat_stream = create_chat_stream_handler_responses_api({
            deviations,
            completion,
            usage_calculator,
        });

        return {
            stream: true,
            init_chat_stream,
            finally_fn,
        };
    }

    if (finally_fn) await finally_fn();

    const output = Array.isArray(completion.output) ? completion.output : [];
    const responseToolCalls = output
        .filter((item) => item?.type === 'function_call')
        .map((item) => ({
            id: item.call_id,
            type: 'function',
            function: {
                name: item.name,
                arguments: item.arguments,
            },
            ...(item.id ? { canonical_id: item.id } : {}),
        }));

    // Inline-compaction artifact, if the upstream compacted this turn.
    const compactionItem = output.find((item) => item?.type === 'compaction');

    const is_empty = completion.output_text.trim() === '';
    if (is_empty && responseToolCalls.length < 1 && !compactionItem) {
        // GPT refuses to generate an empty response if you ask it to,
        // so this will probably only happen on an error condition.
        // A compaction-only output is legitimate, so don't reject it.
        throw new HttpError(400, 'an empty response was generated', {
            legacyCode: 'bad_response',
        });
    }

    // Reasoning models return `reasoning` output items; their human-readable
    // text only exists when the caller requested summaries via
    // `reasoning: { summary: ... }` (raw chain-of-thought is never returned).
    const reasoningItems = output.filter((item) => item?.type === 'reasoning');
    const reasoningText = reasoningItems
        .flatMap((item) => (Array.isArray(item.summary) ? item.summary : []))
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n\n');

    // The item `id` and `encrypted_content` are what let a caller replay a
    // reasoning turn into the next request; they are opaque to us and would
    // otherwise be lost, so they ride `reasoning_details` verbatim — the same
    // round-trip contract as the `compaction` artifact below and as the
    // Anthropic thinking blocks the coercer preserves.
    const reasoningDetails = reasoningItems
        .filter(
            (item) =>
                item.id !== undefined || item.encrypted_content !== undefined,
        )
        .map((item) => ({
            type: 'reasoning',
            ...(item.id !== undefined ? { id: item.id } : {}),
            ...(item.encrypted_content !== undefined
                ? { encrypted_content: item.encrypted_content }
                : {}),
            ...(Array.isArray(item.summary) ? { summary: item.summary } : {}),
        }));

    const isIncompleteForLength =
        completion.status === 'incomplete' &&
        completion.incomplete_details?.reason === 'max_output_tokens';

    const ret = {
        finish_reason: isIncompleteForLength
            ? 'length'
            : responseToolCalls.length
              ? 'tool_calls'
              : 'stop',
        index: 0,
        message: {
            content: completion.output_text,
            // String-or-absent, matching every other provider's `reasoning`.
            ...(reasoningText ? { reasoning: reasoningText } : {}),
            ...(reasoningDetails.length
                ? { reasoning_details: reasoningDetails }
                : {}),
            refusal: null,
            role: 'assistant',
            ...(responseToolCalls.length
                ? { tool_calls: responseToolCalls }
                : {}),
        },
    };
    ret.role = output.find((item) => item?.role)?.role ?? 'assistant';

    if (compactionItem) {
        // Include `type` so the artifact is a drop-in `messages` item for the
        // stateless round-trip — symmetric with the streaming compaction chunk.
        ret.compaction = {
            type: 'compaction',
            ...(compactionItem.id !== undefined
                ? { id: compactionItem.id }
                : {}),
            encrypted_content: compactionItem.encrypted_content,
        };
    }

    delete ret.type;

    // Only the search action itself is billed — a page-open or find probe
    // inside the same web_search_call is free.
    const webSearchCalls = output.filter(
        (item) =>
            item?.type === 'web_search_call' &&
            (item.action?.type ?? 'search') === 'search',
    ).length;

    // Metered before moderation, same as the sibling handler above: the
    // completion exists and the upstream has billed us for it whether or not
    // we go on to withhold it.
    ret.usage = usage_calculator
        ? usage_calculator({
              ...completion,
              usage: completion.usage,
              webSearchCalls,
              setUsageCosts: (c) => {
                  ret.usageCosts = c;
              },
          })
        : {
              input_tokens: completion.usage.input_tokens,
              output_tokens: completion.usage.output_tokens,
          };
    if (usage_calculator) {
        const usageDetails = usageDetailsFromTrackedUsage(ret.usage);
        if (usageDetails) ret.usageDetails = usageDetails;
    }

    const mod_text = completion.output_text;
    if (moderate && mod_text !== null) {
        const moderation_result = await moderate(mod_text);
        if (moderation_result.flagged) {
            throw new HttpError(400, 'message is not allowed', {
                legacyCode: 'bad_request',
                code: 'moderation_flagged',
            });
        }
    }

    return ret;
};
