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

import type { Interactions } from '@google/genai';
import type { OpenAIChatMessage } from './types.js';

/**
 * OpenAI chat-completions request -> Gemini Interactions request.
 *
 * The inverse of `response.ts`. Together they make the Interactions API
 * addressable through the same provider contract as every other chat upstream,
 * so a model that moves onto Interactions is a catalog entry rather than a
 * rewrite.
 */

/** `data:<mime>;base64,<payload>` — anything else is treated as a fetchable URI. */
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

const mediaContent = (
    url: string,
    type: 'image' | 'video' | 'audio',
): Interactions.Content => {
    const match = DATA_URL.exec(url);
    if (match) {
        return {
            type,
            data: match[2],
            mime_type: match[1],
        } as Interactions.Content;
    }
    return { type, uri: url } as Interactions.Content;
};

const asText = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) => (typeof part === 'string' ? part : (part?.text ?? '')))
        .join('');
};

/**
 * Arguments survive a round trip through our own stream as a JSON string. A
 * string the model truncated mid-call parses to nothing useful; send an empty
 * object rather than failing the whole turn on history we already served.
 */
const parseArguments = (raw: unknown): Record<string, unknown> => {
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
    if (typeof raw !== 'string' || raw.trim() === '') return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const contentBlocks = (message: OpenAIChatMessage): Interactions.Content[] => {
    const blocks: Interactions.Content[] = [];
    const content = message.content;

    if (typeof content === 'string') {
        if (content !== '') blocks.push({ type: 'text', text: content });
    } else if (Array.isArray(content)) {
        for (const part of content) {
            if (typeof part === 'string') {
                if (part !== '') blocks.push({ type: 'text', text: part });
                continue;
            }
            if (!part || typeof part !== 'object') continue;

            switch (part.type) {
                case 'text':
                case 'input_text':
                case 'output_text':
                    if (part.text)
                        blocks.push({ type: 'text', text: part.text });
                    break;
                case 'image_url': {
                    const url = part.image_url?.url ?? part.image_url;
                    if (url) blocks.push(mediaContent(url, 'image'));
                    break;
                }
                case 'video_url': {
                    const url = part.video_url?.url ?? part.video_url;
                    if (url) blocks.push(mediaContent(url, 'video'));
                    break;
                }
                case 'input_audio': {
                    const { data, format } = part.input_audio ?? {};
                    if (data) {
                        blocks.push({
                            type: 'audio',
                            data,
                            mime_type: `audio/${format ?? 'wav'}`,
                        } as Interactions.Content);
                    }
                    break;
                }
                default:
                    // An unknown part with text on it is still worth sending;
                    // dropping it silently loses prompt the caller paid to send.
                    if (part.text)
                        blocks.push({ type: 'text', text: part.text });
            }
        }
    }

    for (const call of message.tool_calls ?? []) {
        blocks.push({
            type: 'function_call',
            id: call.id,
            name: call.function?.name ?? call.name,
            arguments: parseArguments(
                call.function?.arguments ?? call.arguments,
            ),
            ...(call.extra_content?.signature
                ? { signature: call.extra_content.signature as string }
                : {}),
        });
    }

    return blocks;
};

export interface IInteractionsInput {
    input: Interactions.Turn[];
    /** Hoisted from `system` messages; Interactions has no system turn. */
    system_instruction?: string;
}

/**
 * Convert Puter's normalised (OpenAI chat-completions) `messages` into
 * Interactions turns.
 *
 * Adjacent turns of the same role are merged: a multi-tool turn arrives from
 * `process_input_messages` as one `tool` message per result, and Gemini expects
 * those results together in the turn that answers the model.
 */
export const messagesToInteractionsInput = (
    messages: OpenAIChatMessage[],
): IInteractionsInput => {
    const systemParts: string[] = [];
    const turns: Interactions.Turn[] = [];

    const push = (role: 'user' | 'model', content: Interactions.Content[]) => {
        if (content.length === 0) return;
        const last = turns[turns.length - 1];
        if (last && last.role === role && Array.isArray(last.content)) {
            last.content.push(...content);
            return;
        }
        turns.push({ role, content });
    };

    for (const message of messages ?? []) {
        if (!message) continue;

        if (message.role === 'system' || message.role === 'developer') {
            const text = asText(message.content);
            if (text) systemParts.push(text);
            continue;
        }

        if (message.role === 'tool') {
            push('user', [
                {
                    type: 'function_result',
                    call_id: message.tool_call_id ?? message.tool_use_id,
                    result: message.content ?? '',
                } as Interactions.Content,
            ]);
            continue;
        }

        push(
            message.role === 'assistant' ? 'model' : 'user',
            contentBlocks(message),
        );
    }

    return {
        input: turns,
        ...(systemParts.length
            ? { system_instruction: systemParts.join('\n\n') }
            : {}),
    };
};

/**
 * Convert OpenAI tool declarations to Interactions tools.
 *
 * A declaration that is already Interactions-native (`{ type: 'google_search'
 * }` and friends) passes through untouched, which is how a caller reaches the
 * server-side tools chat-completions has no vocabulary for.
 */
export const toolsToInteractionsTools = (
    tools?: unknown[],
): Interactions.Tool[] | undefined => {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;

    return tools.map((tool) => {
        const t = tool as {
            type?: string;
            function?: {
                name?: string;
                description?: string;
                parameters?: unknown;
            };
        };
        if (t.type !== 'function' || !t.function) {
            return tool as Interactions.Tool;
        }
        return {
            type: 'function',
            name: t.function.name,
            ...(t.function.description
                ? { description: t.function.description }
                : {}),
            ...(t.function.parameters
                ? { parameters: t.function.parameters }
                : {}),
        };
    });
};

const toolChoiceToInteractions = (
    toolChoice: unknown,
): Interactions.GenerationConfig['tool_choice'] | undefined => {
    if (toolChoice === undefined || toolChoice === null) return undefined;
    if (toolChoice === 'auto') return 'auto';
    if (toolChoice === 'none') return 'none';
    // OpenAI's 'required' means "call something"; Interactions spells it 'any'.
    if (toolChoice === 'required') return 'any';

    const named = toolChoice as { function?: { name?: string } };
    if (named?.function?.name) {
        return { allowed_tools: { mode: 'any', tools: [named.function.name] } };
    }
    return undefined;
};

export interface IGenerationConfigArgs {
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    tool_choice?: unknown;
    reasoning_effort?: 'low' | 'medium' | 'high';
    reasoning?: { effort: 'low' | 'medium' | 'high' };
}

/**
 * Map the sampling knobs the driver accepts onto `generation_config`.
 *
 * Returns undefined when the caller set nothing, so the request body stays
 * minimal and the model's own defaults apply.
 */
export const toGenerationConfig = ({
    max_tokens,
    temperature,
    top_p,
    tool_choice,
    reasoning_effort,
    reasoning,
}: IGenerationConfigArgs): Interactions.GenerationConfig | undefined => {
    const effort = reasoning_effort ?? reasoning?.effort;
    const choice = toolChoiceToInteractions(tool_choice);

    const config: Interactions.GenerationConfig = {
        ...(max_tokens !== undefined ? { max_output_tokens: max_tokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(top_p !== undefined ? { top_p } : {}),
        ...(choice !== undefined ? { tool_choice: choice } : {}),
        // Asking for an effort level without asking for summaries yields
        // reasoning the caller is billed for and never sees.
        ...(effort
            ? { thinking_level: effort, thinking_summaries: 'auto' }
            : {}),
    };

    return Object.keys(config).length > 0 ? config : undefined;
};
