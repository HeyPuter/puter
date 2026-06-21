/**
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

import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources';
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta.js';
import type {
    MessageCreateParams,
    Usage,
} from '@anthropic-ai/sdk/resources/messages.js';
import { Context } from '../../../../core/context.js';
import type { FSService } from '../../../../services/fs/FSService.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { FSEntryStore } from '../../../../stores/fs/FSEntryStore.js';
import type { S3ObjectStore } from '../../../../stores/fs/S3ObjectStore.js';
import type {
    IChatProvider,
    ICompleteArguments,
    IChatCompleteResult,
} from '../../types.js';
import {
    messagesHaveCompaction,
    toAnthropicContextManagement,
} from '../../utils/compaction.js';
import { make_claude_tools } from '../../utils/FunctionCalling.js';
import { extract_and_remove_system_messages } from '../../utils/Messages.js';
import type {
    AIChatStream,
    AIChatTextStream,
    AIChatToolUseStream,
} from '../../utils/Streaming.js';
import { FILES_API_BETA, processPuterPathUploads } from './fileUpload.js';
import { CLAUDE_MODELS } from './models.js';

// Anthropic inline-compaction beta. The vendored SDK (0.68.0) doesn't type the
// `compact_20260112` edit or the `compaction` content block, so the request
// params and streamed/returned blocks are handled with `as any` casts.
const COMPACTION_BETA = 'compact-2026-01-12';

export class ClaudeProvider implements IChatProvider {
    anthropic: Anthropic;

    #meteringService: MeteringService;

    #stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore };

    #fsService: FSService;

    constructor(
        meteringService: MeteringService,
        stores: { fsEntry: FSEntryStore; s3Object: S3ObjectStore },
        fsService: FSService,
        config: { apiKey: string },
    ) {
        this.#meteringService = meteringService;
        this.#stores = stores;
        this.#fsService = fsService;
        this.anthropic = new Anthropic({
            apiKey: config.apiKey,
            timeout: 10 * 60 * 1001,
        });
    }

    getDefaultModel() {
        return 'claude-haiku-4-5-20251001';
    }

    models() {
        return CLAUDE_MODELS;
    }

    async list() {
        const models = this.models();
        const model_names: string[] = [];
        for (const model of models) {
            model_names.push(model.id);
            if (model.aliases) {
                model_names.push(...model.aliases);
            }
        }
        return model_names;
    }

    async complete({
        messages,
        stream,
        model,
        tools,
        max_tokens,
        temperature,
        reasoning,
        reasoning_effort,
        compaction,
        context_management,
    }: ICompleteArguments): Promise<IChatCompleteResult> {
        tools = make_claude_tools(tools);

        // Translate the neutral compaction opt-in (or pass a raw
        // `context_management` payload through) to Anthropic's beta shape.
        const contextManagement = toAnthropicContextManagement({
            compaction,
            context_management,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let system_prompts: string | any[];
        [system_prompts, messages] =
            extract_and_remove_system_messages(messages);

        // Apply cache_control to system prompt content blocks
        if (
            system_prompts.length > 0 &&
            system_prompts[0].cache_control &&
            system_prompts[0]?.content
        ) {
            system_prompts[0].content = system_prompts[0].content.map(
                (prompt: any) => {
                    prompt.cache_control = system_prompts[0].cache_control;
                    return prompt;
                },
            );
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages = messages.map((message: any) => {
            if (message.cache_control) {
                message.content[0].cache_control = message.cache_control;
            }
            delete message.cache_control;
            return message;
        });

        // Convert OpenAI-style tool calls/results to Claude format
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages = messages.map((message: any) => {
            if (message.tool_calls && Array.isArray(message.tool_calls)) {
                if (!Array.isArray(message.content)) {
                    message.content = message.content ? [message.content] : [];
                }
                for (const toolCall of message.tool_calls) {
                    message.content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function?.name,
                        input: toolCall.function?.arguments ?? {},
                    });
                }
                delete message.tool_calls;
            }

            if (message.role !== 'tool') return message;

            const toolUseId = message.tool_call_id || message.tool_use_id;

            const contentValue = (() => {
                if (Array.isArray(message.content)) {
                    const toolResultBlock = message.content.find(
                        (part: any) => part?.type === 'tool_result',
                    );
                    if (toolResultBlock) {
                        return (
                            toolResultBlock.content ??
                            toolResultBlock.text ??
                            ''
                        );
                    }

                    return message.content
                        .map((part: any) => {
                            if (typeof part === 'string') return part;
                            if (part && typeof part.text === 'string')
                                return part.text;
                            if (part && typeof part.content === 'string')
                                return part.content;
                            return '';
                        })
                        .join('');
                }
                if (typeof message.content === 'string') return message.content;
                if (message.content && typeof message.content.text === 'string')
                    return message.content.text;
                if (
                    message.content &&
                    typeof message.content.content === 'string'
                )
                    return message.content.content;
                return '';
            })();

            return {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: toolUseId,
                        content: contentValue,
                    },
                ],
            };
        });

        // Claude requires tool_use.input to be a dictionary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages = messages.map((message: any) => {
            if (!Array.isArray(message.content)) return message;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message.content = message.content.map((part: any) => {
                if (part?.type !== 'tool_use') return part;
                if (typeof part.input === 'string') {
                    try {
                        part.input = JSON.parse(part.input);
                    } catch {
                        part.input = {};
                    }
                } else if (part.input === undefined || part.input === null) {
                    part.input = {};
                }
                return part;
            });
            return message;
        });

        // Map round-tripped compaction blocks back to Anthropic's native shape.
        // The internal/unified carrier field is `encrypted_content`; Anthropic's
        // compaction block uses `content` (a plaintext summary).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages = messages.map((message: any) => {
            if (!Array.isArray(message.content)) return message;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message.content = message.content.map((part: any) => {
                if (part?.type !== 'compaction') return part;
                return {
                    type: 'compaction',
                    content: part.content ?? part.encrypted_content ?? '',
                };
            });
            return message;
        });

        const modelUsed =
            this.models().find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || this.models().find((m) => m.id === this.getDefaultModel())!;

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const thinkingConfig = this.#buildThinkingConfig({
            modelId: modelUsed.id,
            reasoningEffort: requestedReasoningEffort,
            maxTokens: max_tokens,
        });
        // Fable 5 and Opus 4.7/4.8 error on non-default sampling params; omit temperature entirely.
        // Other models require temperature=1 when thinking is enabled.
        const omitsTemperature = [
            'claude-fable-5',
            'claude-opus-4-7',
            'claude-opus-4-8',
        ].includes(modelUsed.id);
        const resolvedTemperature = omitsTemperature
            ? undefined
            : thinkingConfig
              ? 1
              : (temperature ?? 0);
        const supportsEffort = [
            'claude-fable-5',
            'claude-opus-4-8',
            'claude-opus-4-7',
            'claude-opus-4-6',
            'claude-sonnet-4-6',
        ].includes(modelUsed.id);

        const actor = Context.get('actor');

        // Upload any `puter_path` parts to Anthropic's Files API and rewrite
        // them in-place to reference the returned `file_id`. Must happen
        // before sdkParams snapshots `messages`.
        const { fileIds: uploadedFileIds } = await processPuterPathUploads(
            this.anthropic,
            messages,
            this.#stores,
            this.#fsService,
            actor,
        );
        const usesBetaFiles = uploadedFileIds.length > 0;
        // The compaction beta is needed both to *request* compaction
        // (contextManagement) and to *accept a round-tripped* compaction block
        // back as input (messagesHaveCompaction).
        const usesCompaction =
            !!contextManagement || messagesHaveCompaction(messages);
        // Compaction and Files API both require the beta endpoint; combine their
        // beta headers and route through `beta.messages.*` if either is active.
        const betas = [
            ...(usesBetaFiles ? [FILES_API_BETA] : []),
            ...(usesCompaction ? [COMPACTION_BETA] : []),
        ];
        const usesBeta = betas.length > 0;

        const sdkParams: MessageCreateParams & {
            betas?: string[];
        } = {
            model: modelUsed.id,
            max_tokens: Math.floor(
                max_tokens ||
                    (model === 'claude-3-5-sonnet-20241022' ||
                    model === 'claude-3-5-sonnet-20240620'
                        ? 8192
                        : this.models().filter(
                              (e) =>
                                  (e as any).name === model ||
                                  e.aliases?.includes(model),
                          )[0]?.max_tokens || 4096),
            ),
            ...(resolvedTemperature !== undefined
                ? { temperature: resolvedTemperature }
                : {}),
            ...(system_prompts && system_prompts[0]?.content
                ? { system: system_prompts[0]?.content }
                : {}),
            tool_choice: { type: 'auto', disable_parallel_tool_use: true },
            messages,
            ...(tools ? { tools } : {}),
            ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
            ...(supportsEffort && requestedReasoningEffort
                ? { output_config: { effort: requestedReasoningEffort } }
                : {}),
            // Cast: `context_management` compaction edits aren't typed in SDK 0.68.0.
            ...(contextManagement
                ? { context_management: contextManagement as any }
                : {}),
            ...(usesBeta ? { betas } : {}),
        } as MessageCreateParams & { betas?: string[] };

        const cleanupUploads = async () => {
            if (uploadedFileIds.length === 0) return;
            await Promise.all(
                uploadedFileIds.map(async (id) => {
                    try {
                        await this.anthropic.beta.files.delete(id, {
                            betas: [FILES_API_BETA],
                        });
                    } catch {
                        /* best-effort */
                    }
                }),
            );
        };

        if (stream) {
            const init_chat_stream = async ({
                chatStream,
            }: {
                chatStream: AIChatStream;
            }) => {
                const completion = usesBeta
                    ? this.anthropic.beta.messages.stream(sdkParams)
                    : this.anthropic.messages.stream(sdkParams);
                const usageSum: Record<string, number> = {};

                let message, contentBlock;
                let currentContentBlockType: string | null = null;
                // Inline-compaction block is an untyped beta block; capture its
                // artifact across start/delta and emit on stop. Anthropic carries
                // the summary in `content` (plaintext) — unlike OpenAI's
                // `encrypted_content` — so read `content` first.
                let compactionData: {
                    id?: string;
                    payload: string;
                    buffer: string;
                } | null = null;
                let emittedCompaction = false;
                for await (const event of completion) {
                    if (event.type === 'message_delta') {
                        const meteredData = this.#usageFormatterUtil(
                            (event?.usage ?? {}) as Usage | BetaUsage,
                        );
                        for (const key in meteredData) {
                            usageSum[key] = Math.max(
                                usageSum[key] ?? 0,
                                meteredData[key as keyof typeof meteredData],
                            );
                        }
                    }
                    if (event.type === 'message_start') {
                        message = chatStream.message();
                        continue;
                    }
                    if (event.type === 'message_stop') {
                        message!.end();
                        message = null;
                        continue;
                    }
                    if (event.type === 'content_block_start') {
                        currentContentBlockType = event.content_block.type;
                        if (
                            (event.content_block.type as string) ===
                            'compaction'
                        ) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const block = event.content_block as any;
                            compactionData = {
                                id: block.id,
                                // Anthropic uses `content`; fall back to
                                // `encrypted_content` in case the field varies.
                                payload:
                                    block.content ??
                                    block.encrypted_content ??
                                    '',
                                buffer: '',
                            };
                            continue;
                        }
                        if (event.content_block.type === 'tool_use') {
                            contentBlock = message!.contentBlock({
                                type: event.content_block.type,
                                id: event.content_block.id,
                                name: event.content_block.name,
                            });
                        } else if (event.content_block.type === 'thinking') {
                            contentBlock = message!.contentBlock({
                                type: 'text',
                            });
                        } else {
                            contentBlock = message!.contentBlock({
                                type: event.content_block.type,
                            });
                        }
                        continue;
                    }
                    if (event.type === 'content_block_stop') {
                        if (currentContentBlockType === 'compaction') {
                            const encrypted_content =
                                compactionData?.payload ||
                                compactionData?.buffer ||
                                '';
                            // Only emit (and mark done) if we actually captured
                            // the summary; otherwise let the finalMessage
                            // fallback recover it from the complete block.
                            if (encrypted_content) {
                                chatStream.compaction({
                                    id: compactionData?.id,
                                    encrypted_content,
                                });
                                emittedCompaction = true;
                            }
                            compactionData = null;
                            currentContentBlockType = null;
                            continue;
                        }
                        contentBlock!.end();
                        contentBlock = null;
                        currentContentBlockType = null;
                        continue;
                    }
                    if (event.type === 'content_block_delta') {
                        if (currentContentBlockType === 'compaction') {
                            // Capture any streamed payload for the artifact.
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const d = event.delta as any;
                            const chunk =
                                d.partial_json ?? d.text ?? d.data ?? '';
                            if (typeof chunk === 'string' && compactionData) {
                                compactionData.buffer += chunk;
                            }
                            continue;
                        }
                        if (event.delta.type === 'input_json_delta') {
                            (contentBlock as AIChatToolUseStream)!.addPartialJSON(
                                event.delta.partial_json,
                            );
                        } else if (event.delta.type === 'text_delta') {
                            if (currentContentBlockType === 'thinking') {
                                (contentBlock as AIChatTextStream)!.addReasoning(
                                    event.delta.text,
                                );
                            } else {
                                (contentBlock as AIChatTextStream)!.addText(
                                    event.delta.text,
                                );
                            }
                        } else if (event.delta.type === 'thinking_delta') {
                            (contentBlock as AIChatTextStream)!.addReasoning(
                                (event.delta as { thinking: string }).thinking,
                            );
                        }
                        // signature_delta — ignored
                    }
                }
                const finalMessage = await completion
                    .finalMessage()
                    .catch(() => null);
                if (finalMessage) {
                    const finalUsage = this.#usageFormatterUtil(
                        finalMessage.usage as Usage | BetaUsage,
                    );
                    for (const [key, value] of Object.entries(finalUsage)) {
                        usageSum[key] = value;
                    }
                    // Fallback: some SDK versions surface the compaction block
                    // only in the final message, not as a streamed block.
                    if (!emittedCompaction) {
                        const block = (
                            (finalMessage.content as unknown[]) ?? []
                        ).find(
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (c: any) => c?.type === 'compaction',
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ) as any;
                        if (block) {
                            chatStream.compaction({
                                id: block.id,
                                encrypted_content:
                                    block.content ??
                                    block.encrypted_content ??
                                    '',
                            });
                            emittedCompaction = true;
                        }
                    }
                }
                chatStream.end(usageSum);
                const costsOverrideFromModel =
                    this.#buildCostsOverrideFromModel(usageSum, modelUsed);
                this.#meteringService.utilRecordUsageObject(
                    usageSum,
                    actor,
                    `claude:${modelUsed.id}`,
                    costsOverrideFromModel,
                );
            };

            return {
                init_chat_stream,
                stream: true,
                finally_fn: cleanupUploads,
            };
        }

        try {
            const msg = await (usesBeta
                ? this.anthropic.beta.messages.create(sdkParams)
                : this.anthropic.messages.create(sdkParams));
            const usage = this.#usageFormatterUtil(
                (msg as Message).usage as Usage | BetaUsage,
            );
            const costsOverrideFromModel = this.#buildCostsOverrideFromModel(
                usage,
                modelUsed,
            );
            this.#meteringService.utilRecordUsageObject(
                usage,
                actor,
                `claude:${modelUsed.id}`,
                costsOverrideFromModel,
            );

            // Surface any inline-compaction artifact for stateless round-trip.
            const compactionBlock = (
                ((msg as Message).content as unknown[]) ?? []
            ).find(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (c: any) => c?.type === 'compaction',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ) as any;

            return {
                message: msg,
                usage,
                finish_reason: 'stop',
                ...(compactionBlock
                    ? {
                          compaction: {
                              // `type` makes the artifact a drop-in `messages`
                              // item for the round-trip (symmetric with the
                              // streaming compaction chunk).
                              type: 'compaction' as const,
                              ...(compactionBlock.id !== undefined
                                  ? { id: compactionBlock.id }
                                  : {}),
                              encrypted_content:
                                  compactionBlock.content ??
                                  compactionBlock.encrypted_content ??
                                  '',
                          },
                      }
                    : {}),
            };
        } finally {
            await cleanupUploads();
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    #usageFormatterUtil(usage: any) {
        // Compaction responses report per-pass usage in `usage.iterations` (the
        // compaction pass + the message pass). Per Anthropic's docs the
        // top-level `input_tokens`/`output_tokens` reflect ONLY the
        // non-compaction passes, so to bill the (often large) compaction pass we
        // must sum across all iterations. Compaction is billed at normal token
        // rates, and iterations don't break out cache fields — those stay
        // top-level (the message pass's), which bills the compaction input at
        // the full input rate.
        const iterations = Array.isArray(usage?.iterations)
            ? usage.iterations
            : null;
        const inputTokens = iterations
            ? iterations.reduce(
                  (sum: number, it: any) => sum + (it?.input_tokens || 0),
                  0,
              )
            : usage?.input_tokens || 0;
        const outputTokens = iterations
            ? iterations.reduce(
                  (sum: number, it: any) => sum + (it?.output_tokens || 0),
                  0,
              )
            : usage?.output_tokens || 0;
        return {
            input_tokens: inputTokens,
            ephemeral_5m_input_tokens:
                usage?.cache_creation?.ephemeral_5m_input_tokens ||
                usage?.cache_creation_input_tokens ||
                0,
            ephemeral_1h_input_tokens:
                usage?.cache_creation?.ephemeral_1h_input_tokens || 0,
            cache_read_input_tokens: usage?.cache_read_input_tokens || 0,
            output_tokens: outputTokens,
            thinking_tokens:
                usage?.thinking_tokens ||
                usage?.output_tokens_details?.thinking_tokens ||
                0,
        };
    }

    #buildCostsOverrideFromModel(
        usage: Record<string, number>,
        modelUsed: { costs: Record<string, number> },
    ) {
        return Object.fromEntries(
            Object.entries(usage).map(([k, v]) => {
                const modelCost =
                    modelUsed.costs[k] ??
                    (k === 'thinking_tokens'
                        ? modelUsed.costs.output_tokens
                        : 0);
                return [k, v * modelCost];
            }),
        );
    }

    #buildThinkingConfig({
        modelId,
        reasoningEffort,
        maxTokens,
    }: {
        modelId?: string;
        reasoningEffort?: 'low' | 'medium' | 'high';
        maxTokens?: number;
    }) {
        if (!reasoningEffort) return undefined;

        // Fable 5, Opus 4.7/4.8, 4.6, and Sonnet 4.6 use adaptive thinking
        // (`budget_tokens` is deprecated on 4.6/Sonnet 4.6, removed on
        // Fable 5 and 4.7+). Fable 5 and Opus 4.7/4.8 omit thinking content
        // by default; `display: 'summarized'` restores visible reasoning in
        // the stream.
        if (
            modelId === 'claude-fable-5' ||
            modelId === 'claude-opus-4-8' ||
            modelId === 'claude-opus-4-7'
        ) {
            return {
                type: 'adaptive' as const,
                display: 'summarized' as const,
            };
        }
        if (modelId === 'claude-opus-4-6' || modelId === 'claude-sonnet-4-6') {
            return { type: 'adaptive' as const };
        }

        const requestedBudget = { low: 1024, medium: 4096, high: 8192 }[
            reasoningEffort
        ];

        if (typeof maxTokens === 'number' && Number.isFinite(maxTokens)) {
            if (Math.floor(maxTokens - 1) < 1024) return undefined;
        }

        const budget_tokens = Math.floor(
            Math.max(
                1024,
                Math.min(
                    requestedBudget,
                    maxTokens ? maxTokens - 1 : requestedBudget,
                ),
            ),
        );

        return { type: 'enabled' as const, budget_tokens };
    }

    checkModeration(_text: string): never {
        throw new Error('CheckModeration not provided by Claude provider.');
    }
}
