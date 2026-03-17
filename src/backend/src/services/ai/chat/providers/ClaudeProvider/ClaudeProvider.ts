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

import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { Message } from '@anthropic-ai/sdk/resources';
import { BetaUsage } from '@anthropic-ai/sdk/resources/beta.js';
import { MessageCreateParams as BetaMessageCreateParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { MessageCreateParams, Usage } from '@anthropic-ai/sdk/resources/messages.js';
import mime from 'mime-types';
import FSNodeParam from '../../../../../api/filesystem/FSNodeParam.js';
import { LLRead } from '../../../../../filesystem/ll_operations/ll_read.js';
import { ErrorService } from '../../../../../modules/core/ErrorService.js';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { make_claude_tools } from '../../../utils/FunctionCalling.js';
import { extract_and_remove_system_messages } from '../../../utils/Messages.js';
import { AIChatStream, AIChatTextStream, AIChatToolUseStream } from '../../../utils/Streaming.js';
import { IChatProvider, ICompleteArguments } from '../types.js';
import { CLAUDE_MODELS } from './models.js';
export class ClaudeProvider implements IChatProvider {
    anthropic: Anthropic;

    #meteringService: MeteringService;

    errorService: ErrorService;

    constructor (meteringService: MeteringService, config: { apiKey: string }, errorService: ErrorService) {

        this.#meteringService = meteringService;
        this.errorService = errorService;
        this.anthropic = new Anthropic({
            apiKey: config.apiKey,
            // 10 minutes is the default; we need to override the timeout to
            // disable an "aggressive" preemptive error that's thrown
            // erroneously by the SDK.
            // (https://github.com/anthropics/anthropic-sdk-typescript/issues/822)
            timeout: 10 * 60 * 1001,
        });
    }
    getDefaultModel () {
        return 'claude-haiku-4-5-20251001';
    }

    async list () {
        const models = this.models();
        const model_names: string[] = [];
        for ( const model of models ) {
            model_names.push(model.id);
            if ( model.aliases ) {
                model_names.push(...model.aliases);
            }
        }
        return model_names;
    }

    async complete ({ messages, stream, model, tools, max_tokens, temperature, reasoning, reasoning_effort }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        tools = make_claude_tools(tools);

        let system_prompts: string | any[];
        // unsure why system_prompts is an array but it always seems to only have exactly one element,
        // and the real array of system_prompts seems to be the [0].content -- NS
        [system_prompts, messages] = extract_and_remove_system_messages(messages);

        // Apply the cache control tag to all content blocks
        if (
            system_prompts.length > 0 &&
            system_prompts[0].cache_control &&
            system_prompts[0]?.content
        ) {
            system_prompts[0].content = system_prompts[0].content.map((prompt: { cache_control: unknown }) => {
                prompt.cache_control = system_prompts[0].cache_control;
                return prompt;
            });
        }

        messages = messages.map(message => {
            if ( message.cache_control ) {
                message.content[0].cache_control = message.cache_control;
            }
            delete message.cache_control;
            return message;
        });

        // Convert OpenAI-style tool calls/results to Claude format.
        messages = messages.map(message => {
            if ( message.tool_calls && Array.isArray(message.tool_calls) ) {
                if ( ! Array.isArray(message.content) ) {
                    message.content = message.content ? [message.content] : [];
                }
                for ( const toolCall of message.tool_calls ) {
                    message.content.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolCall.function?.name,
                        input: toolCall.function?.arguments ?? {},
                    });
                }
                delete message.tool_calls;
            }

            if ( message.role !== 'tool' ) return message;

            const toolUseId = message.tool_call_id || message.tool_use_id;
            const contentValue = (() => {
                if ( Array.isArray(message.content) ) {
                    const toolResultBlock = message.content.find((part: any) => part?.type === 'tool_result');
                    if ( toolResultBlock ) {
                        return toolResultBlock.content ?? toolResultBlock.text ?? '';
                    }
                    return message.content.map((part: any) => {
                        if ( typeof part === 'string' ) return part;
                        if ( part && typeof part.text === 'string' ) return part.text;
                        if ( part && typeof part.content === 'string' ) return part.content;
                        return '';
                    }).join('');
                }
                if ( typeof message.content === 'string' ) return message.content;
                if ( message.content && typeof message.content.text === 'string' ) return message.content.text;
                if ( message.content && typeof message.content.content === 'string' ) return message.content.content;
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

        // Claude requires tool_use.input to be a dictionary, not a JSON string.
        messages = messages.map(message => {
            if ( ! Array.isArray(message.content) ) return message;
            message.content = message.content.map((part: any) => {
                if ( part?.type !== 'tool_use' ) return part;
                if ( typeof part.input === 'string' ) {
                    try {
                        part.input = JSON.parse(part.input);
                    } catch {
                        part.input = {};
                    }
                } else if ( part.input === undefined || part.input === null ) {
                    part.input = {};
                }
                return part;
            });
            return message;
        });

        const modelUsed = this.models().find(m => [m.id, ...(m.aliases || [])].includes(model)) || this.models().find(m => m.id === this.getDefaultModel())!;
        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const thinkingConfig = this.#buildThinkingConfig({
            modelId: modelUsed.id,
            reasoningEffort: requestedReasoningEffort,
            maxTokens: max_tokens,
        });
        // Anthropic requires temperature=1 whenever thinking is enabled.
        const resolvedTemperature = thinkingConfig ? 1 : (temperature ?? 0);
        const sdkParams: MessageCreateParams = {
            model: modelUsed.id,
            max_tokens: Math.floor(max_tokens ||
                ((
                    model === 'claude-3-5-sonnet-20241022'
                    || model === 'claude-3-5-sonnet-20240620'
                ) ? 8192 : this.models().filter(e => (e.name === model || e.aliases?.includes(model)))[0]?.max_tokens || 4096)), //required
            temperature: resolvedTemperature, // required
            ...( (system_prompts && system_prompts[0]?.content) ? {
                system: system_prompts[0]?.content,
            } : {}),
            tool_choice: {
                type: 'auto',
                disable_parallel_tool_use: true,
            },
            messages,
            ...(tools ? { tools } : {}),
            ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
        } as MessageCreateParams;

        let beta_mode = false;

        // Perform file uploads
        const file_delete_tasks: { file_id: string }[] = [];
        const actor = Context.get('actor');
        const { user } = actor.type;

        const file_input_tasks: any[] = [];
        for ( const message of messages ) {
            // We can assume `message.content` is not undefined because
            // Messages.normalize_single_message ensures this.
            for ( const contentPart of message.content ) {
                if ( ! contentPart.puter_path ) continue;
                file_input_tasks.push({
                    node: await (new FSNodeParam(contentPart.puter_path)).consolidate({
                        req: { user },
                        getParam: () => contentPart.puter_path,
                    }),
                    contentPart,
                });
            }
        }

        const promises: Promise<unknown>[] = [];
        for ( const task of file_input_tasks ) {
            promises.push((async () => {
                const ll_read = new LLRead();
                const stream = await ll_read.run({
                    actor: Context.get('actor'),
                    fsNode: task.node,
                });

                const mimeType = mime.contentType(await task.node.get('name'));

                beta_mode = true;
                const fileUpload = await this.anthropic.beta.files.upload({
                    file: await toFile(stream, undefined, { type: mimeType as string }),
                }, {
                    betas: ['files-api-2025-04-14'],
                } as Parameters<typeof this.anthropic.beta.files.upload>[1]);

                file_delete_tasks.push({ file_id: fileUpload.id });
                // We have to copy a table from the documentation here:
                // https://docs.anthropic.com/en/docs/build-with-claude/files
                const contentBlockTypeForFileBasedOnMime = (() => {
                    if ( mimeType && mimeType.startsWith('image/') ) {
                        return 'image';
                    }
                    if ( mimeType && mimeType.startsWith('text/') ) {
                        return 'document';
                    }
                    if ( mimeType && mimeType === 'application/pdf' || mimeType === 'application/x-pdf' ) {
                        return 'document';
                    }
                    return 'container_upload';
                })();

                delete task.contentPart.puter_path;
                task.contentPart.type = contentBlockTypeForFileBasedOnMime;
                task.contentPart.source = {
                    type: 'file',
                    file_id: fileUpload.id,
                };
            })());
        }
        await Promise.all(promises);

        const cleanup_files = async () => {
            const promises: Promise<unknown>[] = [];
            for ( const task of file_delete_tasks ) {
                promises.push((async () => {
                    try {
                        await this.anthropic.beta.files.delete(
                            task.file_id,
                            { betas: ['files-api-2025-04-14'] },
                        );
                    } catch (e) {
                        this.errorService.report('claude:file-delete-task', {
                            source: e,
                            trace: true,
                            alarm: true,
                            extra: { file_id: task.file_id },
                        });
                    }
                })());
            }
            await Promise.all(promises);
        };

        if ( beta_mode ) {
            (sdkParams as BetaMessageCreateParams).betas = ['files-api-2025-04-14'];
        }
        const anthropic = (beta_mode ? this.anthropic.beta : this.anthropic) as Anthropic;

        if ( stream ) {
            const init_chat_stream = async ({ chatStream }: { chatStream: AIChatStream }) => {
                const completion = await anthropic.messages.stream(sdkParams as MessageCreateParams);
                const usageSum: Record<string, number> = {};

                let message, contentBlock;
                let currentContentBlockType: string | null = null;
                for await ( const event of completion ) {

                    if ( event.type === 'message_delta' ) {
                        const usageObject = (event?.usage ?? {});
                        const meteredData = this.#usageFormatterUtil(usageObject as Usage | BetaUsage);

                        for ( const key in meteredData ) {
                            // Anthropic message_delta usage counters are cumulative.
                            // Keep the latest value instead of summing every delta.
                            usageSum[key] = Math.max(
                                usageSum[key] ?? 0,
                                meteredData[key as keyof typeof meteredData],
                            );
                        }
                    }

                    if ( event.type === 'message_start' ) {
                        message = chatStream.message();
                        continue;
                    }
                    if ( event.type === 'message_stop' ) {
                        message!.end();
                        message = null;
                        continue;
                    }

                    if ( event.type === 'content_block_start' ) {
                        currentContentBlockType = event.content_block.type;
                        if ( event.content_block.type === 'tool_use' ) {
                            contentBlock = message!.contentBlock({
                                type: event.content_block.type,
                                id: event.content_block.id,
                                name: event.content_block.name,
                            });
                            continue;
                        }
                        if ( event.content_block.type === 'thinking' ) {
                            // We map Anthropic "thinking" blocks to our text stream type,
                            // then forward deltas through addReasoning().
                            contentBlock = message!.contentBlock({
                                type: 'text',
                            });
                            continue;
                        }
                        contentBlock = message!.contentBlock({
                            type: event.content_block.type,
                        });
                        continue;
                    }

                    if ( event.type === 'content_block_stop' ) {
                        contentBlock!.end();
                        contentBlock = null;
                        currentContentBlockType = null;
                        continue;
                    }

                    if ( event.type === 'content_block_delta' ) {
                        if ( event.delta.type === 'input_json_delta' ) {
                            (contentBlock as AIChatToolUseStream)!.addPartialJSON(event.delta.partial_json);
                            continue;
                        }
                        if ( event.delta.type === 'text_delta' ) {
                            if ( currentContentBlockType === 'thinking' ) {
                                (contentBlock as AIChatTextStream)!.addReasoning(event.delta.text);
                            } else {
                                (contentBlock as AIChatTextStream)!.addText(event.delta.text);
                            }
                            continue;
                        }
                        if ( event.delta.type === 'thinking_delta' ) {
                            (contentBlock as AIChatTextStream)!.addReasoning(event.delta.thinking);
                            continue;
                        }
                        if ( event.delta.type === 'signature_delta' ) {
                            continue;
                        }
                    }
                }
                // Some usage fields (e.g. thinking_tokens) may only be available
                // on the final message usage object.
                const finalUsage = await completion.finalMessage()
                    .then(message => this.#usageFormatterUtil(message.usage as Usage | BetaUsage))
                    .catch(() => null);
                if ( finalUsage ) {
                    for ( const [key, value] of Object.entries(finalUsage) ) {
                        usageSum[key] = value;
                    }
                }

                chatStream.end(usageSum);
                const costsOverrideFromModel = this.#buildCostsOverrideFromModel(usageSum, modelUsed);
                this.#meteringService.utilRecordUsageObject(usageSum, actor, `claude:${modelUsed.id}`, costsOverrideFromModel);
            };

            return {
                init_chat_stream,
                stream: true,
                finally_fn: cleanup_files,
            };
        }

        let msg;
        try {
            msg = await anthropic.messages.create(sdkParams);
        } catch (e) {
            console.error('anthropic error:', e);
            throw e;
        }
        await cleanup_files();

        const usage = this.#usageFormatterUtil((msg as Message).usage as Usage | BetaUsage);
        const costsOverrideFromModel = this.#buildCostsOverrideFromModel(usage, modelUsed);
        this.#meteringService.utilRecordUsageObject(usage, actor, `claude:${modelUsed.id}`, costsOverrideFromModel);

        // TODO DS: cleanup old usage tracking
        return {
            message: msg,
            usage: usage,
            finish_reason: 'stop',
        };
    }

    #usageFormatterUtil (usage: Usage | BetaUsage) {
        return {
            input_tokens: usage?.input_tokens || 0,
            ephemeral_5m_input_tokens: usage?.cache_creation?.ephemeral_5m_input_tokens || usage.cache_creation_input_tokens || 0, // this is because they're api is a bit inconsistent
            ephemeral_1h_input_tokens: usage?.cache_creation?.ephemeral_1h_input_tokens || 0,
            cache_read_input_tokens: usage?.cache_read_input_tokens || 0,
            output_tokens: usage?.output_tokens || 0,
            thinking_tokens: (usage as any)?.thinking_tokens || (usage as any)?.output_tokens_details?.thinking_tokens || 0,
        };
    };

    #buildThinkingConfig ({
        modelId,
        reasoningEffort,
        maxTokens,
    }: {
        modelId: string;
        reasoningEffort?: 'low' | 'medium' | 'high';
        maxTokens?: number;
    }) {
        if ( ! reasoningEffort ) return undefined;

        const requestedBudget = {
            low: 1024,
            medium: 4096,
            high: 8192,
        }[reasoningEffort];

        // Keep budget <= max_tokens when it's set. If max_tokens is too low
        // to satisfy Anthropic's minimum thinking budget, disable thinking.
        if ( typeof maxTokens === 'number' && Number.isFinite(maxTokens) ) {
            const maxBudget = Math.floor(maxTokens - 1);
            if ( maxBudget < 1024 ) {
                return undefined;
            }
        }

        const budget_tokens = Math.floor(Math.max(
            1024,
            Math.min(requestedBudget, (maxTokens ? (maxTokens - 1) : requestedBudget)),
        ));

        return {
            type: 'enabled' as const,
            budget_tokens,
        };
    }

    #buildCostsOverrideFromModel (usage: Record<string, number>, modelUsed: { costs: Record<string, number> }) {
        return Object.fromEntries(Object.entries(usage).map(([k, v]) => {
            const modelCost = modelUsed.costs[k] ?? (k === 'thinking_tokens' ? modelUsed.costs.output_tokens : 0);
            return [k, v * modelCost];
        }));
    }

    models () {
        return CLAUDE_MODELS;
    }

    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('CheckModeration Not provided.');
    }
}
