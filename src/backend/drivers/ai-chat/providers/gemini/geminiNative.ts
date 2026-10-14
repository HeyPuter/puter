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
 * A Chat Completions-shaped client over Gemini's native `generateContent`.
 * Results carry the native `usageMetadata` as `usage`.
 */

import type {
    Content,
    FunctionCallingConfigMode,
    GenerateContentConfig,
    GenerateContentResponse,
    GoogleGenAI,
    Part,
    ThinkingLevel,
} from '@google/genai';
import { HttpError } from '../../../../core/http/HttpError.js';
import {
    parseDataUri,
    unsupportedMediaTextPart,
} from '../../utils/mediaParts.js';
import { promoteStopForToolCalls } from '../../utils/stopReason.js';
import type { ChatCompletionsClient } from '../OpenAICompatProvider.js';

type ChatContentPart =
    string | { type?: string; text?: string; image_url?: { url?: string } };

type ChatContent = string | ChatContentPart[] | null | undefined;

interface ChatToolCall {
    id?: string;
    function: { name: string; arguments: string };
    extra_content?: { google?: { thought_signature?: string } };
}

/** A message as `process_input_messages` leaves it. */
interface ChatMessage {
    role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
    content?: ChatContent;
    tool_calls?: ChatToolCall[];
    tool_call_id?: string;
}

/** Wire `tool_choice`, as `toolChoiceToWire` emits it for the chat dialect. */
type ChatToolChoice =
    | 'auto'
    | 'none'
    | 'required'
    | { type: 'function'; function: { name: string } };

/** The request fields `OpenAICompatProvider` and the Gemini hooks send. */
interface ChatParams {
    model: string;
    messages: ChatMessage[];
    tools?: Array<{
        type: string;
        function?: { name: string; description?: string; parameters?: unknown };
    }>;
    tool_choice?: ChatToolChoice;
    max_completion_tokens?: number;
    reasoning_effort?: 'low' | 'medium' | 'high';
    stream?: boolean;
}

/** Ids made up for calls Gemini returned without one; never sent back. */
const SYNTHETIC_CALL_ID_PREFIX = 'gemini_call_';

const nativeCallId = (id: string | undefined): { id?: string } =>
    id && !id.startsWith(SYNTHETIC_CALL_ID_PREFIX) ? { id } : {};

/**
 * Tool-call arguments as an object. Replayed calls arrive JSON-encoded twice,
 * so a string result is parsed once more.
 */
const parseArguments = (value: string): Record<string, unknown> => {
    try {
        let parsed: unknown = JSON.parse(value);
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        return parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
};

const textOf = (content: ChatContent): string => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) =>
            typeof part === 'string'
                ? part
                : typeof part.text === 'string'
                  ? part.text
                  : '',
        )
        .join('');
};

const contentParts = (content: ChatContent): Part[] => {
    if (typeof content === 'string') return content ? [{ text: content }] : [];
    if (!Array.isArray(content)) return [];
    const parts: Part[] = [];
    for (const part of content) {
        if (typeof part === 'string') {
            if (part) parts.push({ text: part });
        } else if (part.type === 'text' && typeof part.text === 'string') {
            if (part.text) parts.push({ text: part.text });
        } else if (part.type === 'image_url') {
            // http(s) images were already inlined as data URLs.
            const uri = parseDataUri(part.image_url?.url ?? '');
            parts.push(
                uri?.base64
                    ? { inlineData: { mimeType: uri.mimeType, data: uri.data } }
                    : unsupportedMediaTextPart('image could not be loaded'),
            );
        }
    }
    return parts;
};

const toGeminiContents = (
    messages: ChatMessage[],
): { contents: Content[]; systemInstruction?: Content } => {
    const system: Part[] = [];
    const contents: Content[] = [];
    const toolNames = new Map<string, string>();
    const push = (role: 'user' | 'model', parts: Part[]) => {
        if (!parts.length) return;
        const last = contents.at(-1);
        if (last?.role === role) last.parts!.push(...parts);
        else contents.push({ role, parts });
    };

    for (const message of messages) {
        if (message.role === 'system' || message.role === 'developer') {
            system.push(...contentParts(message.content));
        } else if (message.role === 'assistant') {
            const parts = contentParts(message.content);
            for (const call of message.tool_calls ?? []) {
                if (call.id) toolNames.set(call.id, call.function.name);
                const signature = call.extra_content?.google?.thought_signature;
                parts.push({
                    functionCall: {
                        ...nativeCallId(call.id),
                        name: call.function.name,
                        args: parseArguments(call.function.arguments),
                    },
                    ...(signature ? { thoughtSignature: signature } : {}),
                });
            }
            push('model', parts);
        } else if (message.role === 'tool') {
            const name = toolNames.get(message.tool_call_id ?? '');
            if (!name) {
                throw new HttpError(
                    400,
                    'A tool result does not follow a matching tool call',
                    { legacyCode: 'bad_request' },
                );
            }
            push('user', [
                {
                    functionResponse: {
                        ...nativeCallId(message.tool_call_id),
                        name,
                        response: { result: textOf(message.content) },
                    },
                },
            ]);
        } else {
            push('user', contentParts(message.content));
        }
    }

    return {
        contents,
        ...(system.length ? { systemInstruction: { parts: system } } : {}),
    };
};

const toolConfigOf = (
    toolChoice: ChatToolChoice | undefined,
): GenerateContentConfig['toolConfig'] => {
    if (toolChoice === undefined) return undefined;
    const mode = (
        toolChoice === 'auto' ? 'AUTO' : toolChoice === 'none' ? 'NONE' : 'ANY'
    ) as FunctionCallingConfigMode;
    return {
        functionCallingConfig: {
            mode,
            ...(typeof toolChoice === 'object'
                ? { allowedFunctionNames: [toolChoice.function.name] }
                : {}),
        },
    };
};

const toGenerateContentRequest = (
    params: ChatParams,
    signal: AbortSignal | undefined,
) => {
    const { contents, systemInstruction } = toGeminiContents(params.messages);
    // Only caller-defined functions; Google's built-in tools aren't offered.
    const functions = (params.tools ?? []).flatMap((tool) =>
        tool.type === 'function' && tool.function ? [tool.function] : [],
    );
    const toolConfig = functions.length
        ? toolConfigOf(params.tool_choice)
        : undefined;
    // Sampling fields are not forwarded: Google ignores them on this model.
    const config: GenerateContentConfig = {
        ...(signal ? { abortSignal: signal } : {}),
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(params.max_completion_tokens !== undefined
            ? { maxOutputTokens: params.max_completion_tokens }
            : {}),
        ...(functions.length
            ? {
                  tools: [
                      {
                          functionDeclarations: functions.map((fn) => ({
                              name: fn.name,
                              ...(fn.description
                                  ? { description: fn.description }
                                  : {}),
                              ...(fn.parameters
                                  ? { parametersJsonSchema: fn.parameters }
                                  : {}),
                          })),
                      },
                  ],
              }
            : {}),
        ...(toolConfig ? { toolConfig } : {}),
        ...(params.reasoning_effort
            ? {
                  thinkingConfig: {
                      thinkingLevel:
                          params.reasoning_effort.toUpperCase() as ThinkingLevel,
                  },
              }
            : {}),
    };
    return { model: params.model, contents, config };
};

const FILTERED_FINISH_REASONS = new Set([
    'SAFETY',
    'RECITATION',
    'BLOCKLIST',
    'PROHIBITED_CONTENT',
    'SPII',
    'IMAGE_SAFETY',
    'IMAGE_PROHIBITED_CONTENT',
    'IMAGE_RECITATION',
]);

/** Native finish reason → `finish_reason`; one with no analog passes through. */
const finishReasonOf = (
    reason: string | undefined,
    sawToolCall: boolean,
): string | undefined => {
    if (!reason) return undefined;
    if (reason === 'MAX_TOKENS') return 'length';
    if (FILTERED_FINISH_REASONS.has(reason)) return 'content_filter';
    return promoteStopForToolCalls(
        reason === 'STOP' ? 'stop' : reason,
        sawToolCall,
        'tool_calls',
    );
};

// The SDK and the API docs spell the "no reason given" value differently.
const UNSPECIFIED_BLOCK_REASONS = new Set([
    'BLOCKED_REASON_UNSPECIFIED',
    'BLOCK_REASON_UNSPECIFIED',
]);

/** Google refused the prompt itself, so there is no candidate to read. */
const isPromptBlocked = (response: GenerateContentResponse): boolean => {
    const reason = response.promptFeedback?.blockReason;
    return (
        !response.candidates?.length &&
        !!reason &&
        !UNSPECIFIED_BLOCK_REASONS.has(reason)
    );
};

/** Answer text and tool calls; thought parts are not output and are skipped. */
const readParts = (parts: Part[] | undefined, nextCallIndex: () => number) => {
    let text = '';
    const toolCalls: Array<
        ChatToolCall & { id: string; index: number; type: 'function' }
    > = [];
    for (const part of parts ?? []) {
        if (part.thought) continue;
        if (typeof part.text === 'string') text += part.text;
        if (part.functionCall) {
            toolCalls.push({
                index: nextCallIndex(),
                id:
                    part.functionCall.id ||
                    `${SYNTHETIC_CALL_ID_PREFIX}${crypto.randomUUID()}`,
                type: 'function',
                function: {
                    name: part.functionCall.name ?? '',
                    arguments: JSON.stringify(part.functionCall.args ?? {}),
                },
                ...(part.thoughtSignature
                    ? {
                          extra_content: {
                              google: {
                                  thought_signature: part.thoughtSignature,
                              },
                          },
                      }
                    : {}),
            });
        }
    }
    return { text, toolCalls };
};

const toChatCompletion = (response: GenerateContentResponse) => {
    if (isPromptBlocked(response)) {
        return {
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: '',
                        refusal: null as string | null,
                    },
                    finish_reason: 'content_filter',
                },
            ],
            usage: response.usageMetadata,
        };
    }
    const candidate = response.candidates?.[0];
    let index = 0;
    const { text, toolCalls } = readParts(
        candidate?.content?.parts,
        () => index++,
    );
    return {
        choices: candidate
            ? [
                  {
                      index: 0,
                      message: {
                          role: 'assistant',
                          content: text || (toolCalls.length ? null : ''),
                          refusal: null as string | null,
                          ...(toolCalls.length
                              ? {
                                    tool_calls: toolCalls.map(
                                        ({ index: _index, ...call }) => call,
                                    ),
                                }
                              : {}),
                      },
                      finish_reason:
                          finishReasonOf(
                              candidate.finishReason,
                              toolCalls.length > 0,
                          ) ?? 'stop',
                  },
              ]
            : [],
        usage: response.usageMetadata,
    };
};

/**
 * Native stream responses → Chat Completions chunks. Text and tool calls go out
 * as separate chunks, since the stream handler reads one or the other.
 */
async function* toChatChunks(stream: AsyncIterable<GenerateContentResponse>) {
    let index = 0;
    let sawToolCall = false;
    for await (const response of stream) {
        if (isPromptBlocked(response)) {
            yield {
                choices: [
                    { index: 0, delta: {}, finish_reason: 'content_filter' },
                ],
                usage: response.usageMetadata,
            };
            continue;
        }
        const candidate = response.candidates?.[0];
        const { text, toolCalls } = readParts(
            candidate?.content?.parts,
            () => index++,
        );
        if (toolCalls.length) sawToolCall = true;
        const deltas: Record<string, unknown>[] = [
            ...(text ? [{ content: text }] : []),
            ...(toolCalls.length ? [{ tool_calls: toolCalls }] : []),
        ];
        if (!deltas.length) deltas.push({});
        const finishReason = finishReasonOf(
            candidate?.finishReason,
            sawToolCall,
        );
        for (const [i, delta] of deltas.entries()) {
            const last = i === deltas.length - 1;
            yield {
                choices: candidate
                    ? [
                          {
                              index: 0,
                              delta,
                              finish_reason: last ? finishReason : undefined,
                          },
                      ]
                    : [],
                usage: response.usageMetadata,
            };
        }
    }
}

export const geminiNativeClient = (
    client: GoogleGenAI,
): ChatCompletionsClient => ({
    chat: {
        completions: {
            create: async (params: never, { signal }) => {
                // The SDK only listens for a later abort event.
                signal?.throwIfAborted();
                const chatParams = params as ChatParams;
                const request = toGenerateContentRequest(chatParams, signal);
                return chatParams.stream
                    ? toChatChunks(
                          await client.models.generateContentStream(request),
                      )
                    : toChatCompletion(
                          await client.models.generateContent(request),
                      );
            },
        },
    },
});
