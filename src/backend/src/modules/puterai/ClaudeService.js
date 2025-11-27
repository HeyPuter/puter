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
const { default: Anthropic, toFile } = require('@anthropic-ai/sdk');
const BaseService = require('../../services/BaseService');
const FunctionCalling = require('./lib/FunctionCalling');
const Messages = require('./lib/Messages');
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { LLRead } = require('../../filesystem/ll_operations/ll_read');
const { Context } = require('../../util/context');
const mime = require('mime-types');

/**
* ClaudeService class extends BaseService to provide integration with Anthropic's Claude AI models.
* Implements the puter-chat-completion interface for handling AI chat interactions.
* Manages message streaming, token limits, model selection, and API communication with Claude.
* Supports system prompts, message adaptation, and usage tracking.
* @extends BaseService
*/
class ClaudeService extends BaseService {
    /**
     * @type {import('@anthropic-ai/sdk').Anthropic}
     */
    anthropic;

    /**
    * Initializes the Claude service by creating an Anthropic client instance
    * and registering this service as a provider with the AI chat service.
    * @private
    * @returns {Promise<void>}
    */

    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    #meteringService;

    async _init () {
        this.anthropic = new Anthropic({
            apiKey: this.config.apiKey,
            // 10 minutes is the default; we need to override the timeout to
            // disable an "aggressive" preemptive error that's thrown
            // erroneously by the SDK.
            // (https://github.com/anthropics/anthropic-sdk-typescript/issues/822)
            timeout: 10 * 60 * 1001,
        });

        const svc_aiChat = this.services.get('ai-chat');
        svc_aiChat.register_provider({
            service_name: this.service_name,
            alias: true,
        });
        this.#meteringService = this.services.get('meteringService').meteringService; // TODO DS: move to proper extensions
    }

    /**
    * Returns the default model identifier for Claude API interactions
    * @returns {string} The default model ID 'claude-3-5-sonnet-latest'
    */
    get_default_model () {
        return 'claude-3-5-sonnet-latest';
    }

    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            /**
             * Returns a list of available models and their details.
             * See AIChatService for more information.
             *
             * @returns Promise<Array<Object>> Array of model details
             */
            async models () {
                return this.models_();
            },

            /**
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
            async list () {
                const models = this.models_();
                const model_names = [];
                for ( const model of models ) {
                    model_names.push(model.id);
                    if ( model.aliases ) {
                        model_names.push(...model.aliases);
                    }
                }
                return model_names;
            },

            /**
            * Completes a chat interaction with the Claude AI model
            * @param {Object} options - The completion options
            * @param {Array} options.messages - Array of chat messages to process
            * @param {boolean} options.stream - Whether to stream the response
            * @param {string} [options.model] - The Claude model to use, defaults to service default
            * @returns {Object} Returns either a TypedValue with streaming response or a completion object
            * @this {ClaudeService}
            */
            async complete ({ messages, stream, model, tools, max_tokens, temperature }) {
                tools = FunctionCalling.make_claude_tools(tools);
                // console.log("here are the messages: ", messages)

                let system_prompts;
                // unsure why system_prompts is an array but it always seems to only have exactly one element,
                // and the real array of system_prompts seems to be the [0].content -- NS
                [system_prompts, messages] = Messages.extract_and_remove_system_messages(messages);

                // Apply the cache control tag to all content blocks
                if (
                    system_prompts.length > 0 &&
                    system_prompts[0].cache_control &&
                    system_prompts[0]?.content
                ) {
                    system_prompts[0].content = system_prompts[0].content.map(prompt => {
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

                const sdk_params = {
                    model: model ?? this.get_default_model(),
                    max_tokens: Math.floor(max_tokens) ||
                        ((
                            model === 'claude-3-5-sonnet-20241022'
                            || model === 'claude-3-5-sonnet-20240620'
                        ) ? 8192 : this.models_().filter(e => (e.name === model || e.aliases?.includes(model)))[0]?.max_tokens || 4096), //required
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
                };
                console.log(sdk_params.max_tokens);

                // console.log('\x1B[26;1m ===== SDK PARAMETERS', require('util').inspect(sdk_params, undefined, Infinity));

                let beta_mode = false;

                // Perform file uploads
                const file_delete_tasks = [];
                const actor = Context.get('actor');
                const { user } = actor.type;

                const file_input_tasks = [];
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

                const promises = [];
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
                            file: await toFile(stream, undefined, { type: mimeType }),
                        }, {
                            betas: ['files-api-2025-04-14'],
                        });

                        file_delete_tasks.push({ file_id: fileUpload.id });
                        // We have to copy a table from the documentation here:
                        // https://docs.anthropic.com/en/docs/build-with-claude/files
                        const contentBlockTypeForFileBasedOnMime = (() => {
                            if ( mimeType.startsWith('image/') ) {
                                return 'image';
                            }
                            if ( mimeType.startsWith('text/') ) {
                                return 'document';
                            }
                            if ( mimeType === 'application/pdf' || mimeType === 'application/x-pdf' ) {
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
                    const promises = [];
                    for ( const task of file_delete_tasks ) {
                        promises.push((async () => {
                            try {
                                await this.anthropic.beta.files.delete(task.file_id,
                                                { betas: ['files-api-2025-04-14'] });
                            } catch (e) {
                                this.errors.report('claude:file-delete-task', {
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
                    Object.assign(sdk_params, { betas: ['files-api-2025-04-14'] });
                }
                const anthropic = (c => beta_mode ? c.beta : c)(this.anthropic);

                if ( stream ) {
                    const init_chat_stream = async ({ chatStream }) => {
                        const completion = await anthropic.messages.stream(sdk_params);
                        const usageSum = {};

                        let message, contentBlock;
                        for await ( const event of completion ) {

                            const usageObject = (event?.usage ?? event?.message?.usage ?? {});
                            const meteredData = this.usageFormatterUtil(usageObject);
                            Object.keys(meteredData).forEach((key) => {
                                if ( ! usageSum[key] ) usageSum[key] = 0;
                                usageSum[key] += meteredData[key];
                            });

                            if ( event.type === 'message_start' ) {
                                message = chatStream.message();
                                continue;
                            }
                            if ( event.type === 'message_stop' ) {
                                message.end();
                                message = null;
                                continue;
                            }

                            if ( event.type === 'content_block_start' ) {
                                if ( event.content_block.type === 'tool_use' ) {
                                    contentBlock = message.contentBlock({
                                        type: event.content_block.type,
                                        id: event.content_block.id,
                                        name: event.content_block.name,
                                    });
                                    continue;
                                }
                                contentBlock = message.contentBlock({
                                    type: event.content_block.type,
                                });
                                continue;
                            }

                            if ( event.type === 'content_block_stop' ) {
                                contentBlock.end();
                                contentBlock = null;
                                continue;
                            }

                            if ( event.type === 'content_block_delta' ) {
                                if ( event.delta.type === 'input_json_delta' ) {
                                    contentBlock.addPartialJSON(event.delta.partial_json);
                                    continue;
                                }
                                if ( event.delta.type === 'text_delta' ) {
                                    contentBlock.addText(event.delta.text);
                                    continue;
                                }
                            }
                        }
                        chatStream.end();

                        this.#meteringService.utilRecordUsageObject(usageSum, actor, `claude:${this.models_().find(m => [m.id, ...(m.aliases || [])].includes(model || this.get_default_model())).id}`);
                    };

                    return {
                        init_chat_stream,
                        stream: true,
                        finally_fn: cleanup_files,
                    };
                }

                const msg = await anthropic.messages.create(sdk_params);
                await cleanup_files();

                const usage = this.usageFormatterUtil(msg.usage);
                this.#meteringService.utilRecordUsageObject(usage, actor, `claude:${this.models_().find(m => [m.id, ...(m.aliases || [])].includes(model || this.get_default_model())).id}`);

                // TODO DS: cleanup old usage tracking
                return {
                    message: msg,
                    usage: msg.usage,
                    finish_reason: 'stop',
                };
            },
        },
    };

    // TODO DS: get this inside the class as a private method once the methods aren't exported directly
    /** @type {(usage: import("@anthropic-ai/sdk/resources/messages.js").Usage | import("@anthropic-ai/sdk/resources/beta/messages/messages.js").BetaUsage) => {}}) */
    usageFormatterUtil (usage) {
        return {
            input_tokens: usage?.input_tokens || 0,
            ephemeral_5m_input_tokens: usage?.cache_creation?.ephemeral_5m_input_tokens || usage.cache_creation_input_tokens || 0, // this is because they're api is a bit inconsistent
            ephemeral_1h_input_tokens: usage?.cache_creation?.ephemeral_1h_input_tokens || 0,
            cache_read_input_tokens: usage?.cache_read_input_tokens || 0,
            output_tokens: usage?.output_tokens || 0,
        };
    };

    /**
    * Retrieves available Claude AI models and their specifications
    * @returns Array of model objects containing:
    *   - id: Model identifier
    *   - name: Display name
    *   - aliases: Alternative names for the model
    *   - context: Maximum context window size
    *   - cost: Pricing details (currency, token counts, input/output costs)
    *   - qualitative_speed: Relative speed rating
    *   - max_output: Maximum output tokens
    *   - training_cutoff: Training data cutoff date
    */
    models_ () {
        return [
            {
                id: 'claude-opus-4-5-20251101',
                aliases: ['claude-opus-4-5-latest', 'claude-opus-4-5', 'claude-opus-4.5'],
                name: 'Claude Opus 4.5',
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 500,
                    output: 2500,
                },
                context: 200000,
                max_tokens: 64000,
            },
            {
                id: 'claude-haiku-4-5-20251001',
                aliases: ['claude-haiku-4.5', 'claude-haiku-4-5'],
                name: 'Claude Haiku 4.5',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 100,
                    output: 500,
                },
                max_tokens: 64000,
            },
            {
                id: 'claude-sonnet-4-5-20250929',
                aliases: ['claude-sonnet-4.5', 'claude-sonnet-4-5'],
                name: 'Claude Sonnet 4.5',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                max_tokens: 64000,
            },
            {
                id: 'claude-opus-4-1-20250805',
                aliases: ['claude-opus-4-1'],
                name: 'Claude Opus 4.1',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 1500,
                    output: 7500,
                },
                max_tokens: 32000,
            },
            {
                id: 'claude-opus-4-20250514',
                aliases: ['claude-opus-4', 'claude-opus-4-latest'],
                name: 'Claude Opus 4',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 1500,
                    output: 7500,
                },
                max_tokens: 32000,
            },
            {
                id: 'claude-sonnet-4-20250514',
                aliases: ['claude-sonnet-4', 'claude-sonnet-4-latest'],
                name: 'Claude Sonnet 4',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                max_tokens: 64000,
            },
            {
                id: 'claude-3-7-sonnet-20250219',
                aliases: ['claude-3-7-sonnet-latest'],
                succeeded_by: 'claude-sonnet-4-20250514',
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                max_tokens: 8192,
            },
            {
                id: 'claude-3-5-sonnet-20241022',
                name: 'Claude 3.5 Sonnet',
                aliases: ['claude-3-5-sonnet-latest'],
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                qualitative_speed: 'fast',
                training_cutoff: '2024-04',
                max_tokens: 8192,
            },
            {
                id: 'claude-3-5-sonnet-20240620',
                succeeded_by: 'claude-3-5-sonnet-20241022',
                context: 200000, // might be wrong
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 300,
                    output: 1500,
                },
                max_tokens: 8192,
            },
            {
                id: 'claude-3-haiku-20240307',
                // aliases: ['claude-3-haiku-latest'],
                context: 200000,
                cost: {
                    currency: 'usd-cents',
                    tokens: 1_000_000,
                    input: 25,
                    output: 125,
                },
                qualitative_speed: 'fastest',
                max_tokens: 4096,
            },
        ];
    }
}

module.exports = {
    ClaudeService,
};
