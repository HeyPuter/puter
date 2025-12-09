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

// METADATA // {"ai-commented":{"service":"claude"}}
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

    async complete ({ messages, stream, model, tools, max_tokens, temperature }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
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

        const modelUsed = this.models().find(m => [m.id, ...(m.aliases || [])].includes(model)) || this.models().find(m => m.id === this.getDefaultModel())!;
        const sdkParams: MessageCreateParams = {
            model: modelUsed.id,
            max_tokens: Math.floor(max_tokens ||
                ((
                    model === 'claude-3-5-sonnet-20241022'
                    || model === 'claude-3-5-sonnet-20240620'
                ) ? 8192 : this.models().filter(e => (e.name === model || e.aliases?.includes(model)))[0]?.max_tokens || 4096)), //required
            temperature: temperature || 0, // required
            ...( (system_prompts && system_prompts[0]?.content) ? {
                system: system_prompts[0]?.content,
            } : {}),
            tool_choice: {
                type: 'auto',
                disable_parallel_tool_use: true,
            },
            messages,
            ...(tools ? { tools } : {}),
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

                delete task.contentPart.puter_path,
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
                        await this.anthropic.beta.files.delete(task.file_id,
                                        { betas: ['files-api-2025-04-14'] });
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
                for await ( const event of completion ) {

                    if ( event.type === 'message_delta' ) {
                        const usageObject = (event?.usage ?? {});
                        const meteredData = this.#usageFormatterUtil(usageObject as Usage | BetaUsage);

                        for ( const key in meteredData ) {
                            if ( ! usageSum[key] ) usageSum[key] = 0;
                            usageSum[key] += meteredData[key as keyof typeof meteredData];
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
                        if ( event.content_block.type === 'tool_use' ) {
                            contentBlock = message!.contentBlock({
                                type: event.content_block.type,
                                id: event.content_block.id,
                                name: event.content_block.name,
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
                        continue;
                    }

                    if ( event.type === 'content_block_delta' ) {
                        if ( event.delta.type === 'input_json_delta' ) {
                            (contentBlock as AIChatToolUseStream)!.addPartialJSON(event.delta.partial_json);
                            continue;
                        }
                        if ( event.delta.type === 'text_delta' ) {
                            (contentBlock as AIChatTextStream)!.addText(event.delta.text);
                            continue;
                        }
                    }
                }
                chatStream.end(usageSum);
                const costsOverrideFromModel = Object.fromEntries(Object.entries(usageSum).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k] || 0)];
                }));
                this.#meteringService.utilRecordUsageObject(usageSum, actor, `claude:${modelUsed.id}`, costsOverrideFromModel);
            };

            return {
                init_chat_stream,
                stream: true,
                finally_fn: cleanup_files,
            };
        }

        const msg = await anthropic.messages.create(sdkParams);
        await cleanup_files();

        const usage = this.#usageFormatterUtil((msg as Message).usage as Usage | BetaUsage);
        const costsOverrideFromModel = Object.fromEntries(Object.entries(usage).map(([k, v]) => {
            return [k, v * (modelUsed.costs[k] || 0)];
        }));
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
        };
    };

    models () {
        return CLAUDE_MODELS;
    }

    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('CheckModeration Not provided.');
    }
}