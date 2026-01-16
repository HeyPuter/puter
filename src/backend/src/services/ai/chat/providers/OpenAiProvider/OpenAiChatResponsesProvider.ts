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

import mime from 'mime-types';
import { OpenAI } from 'openai';
import { FSNodeParam } from '../../../../../api/filesystem/FSNodeParam.js';
import { LLRead } from '../../../../../filesystem/ll_operations/ll_read.js';
import { Context } from '../../../../../util/context.js';
import { stream_to_buffer } from '../../../../../util/streamutil.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import * as OpenAiUtil from '../../../utils/OpenAIUtil.js';
import { IChatProvider, ICompleteArguments } from '../types.js';
import { OPEN_AI_MODELS } from './models.js';
import { ResponseCreateParams } from 'openai/resources/responses/responses.mjs';

// We're capping at 5MB, which sucks, but Chat Completions doesn't suuport
// file inputs.
const MAX_FILE_SIZE = 5 * 1_000_000;

/**
* OpenAICompletionService class provides an interface to OpenAI's chat completion API.
* Extends BaseService to handle chat completions, message moderation, token counting,
* and streaming responses. Implements the puter-chat-completion interface and manages
* OpenAI API interactions with support for multiple models including GPT-4 variants.
* Handles usage tracking, spending records, and content moderation.
*/
export class OpenAiResponsesChatProvider implements IChatProvider {
    /**
     * @type {import('openai').OpenAI}
     */
    #openAi: OpenAI;

    #defaultModel = 'gpt-5-nano';

    #meteringService: MeteringService;

    constructor (
        meteringService: MeteringService,
        config: { apiKey?: string, secret_key?: string }) {

        this.#meteringService = meteringService;
        let apiKey = config.apiKey;

        // Fallback to the old format for backward compatibility
        if ( ! apiKey ) {
            apiKey = config?.secret_key;

            // Log a warning to inform users about the deprecated format
            console.warn('The `openai.secret_key` configuration format is deprecated. ' +
                'Please use `services.openai.apiKey` instead.');
        }
        if ( ! apiKey ) {
            throw new Error('OpenAI API key is missing in configuration.');
        }
        this.#openAi = new OpenAI({
            apiKey: apiKey,
        });
    }

    /**
    * Returns an array of available AI models with their pricing information.
    * Each model object includes an ID and cost details (currency, tokens, input/output rates).
    */
    models () {
        return OPEN_AI_MODELS.filter(e => e.responses_api_only === true);
    }

    list () {
        const models =  this.models();
        const modelNames: string[] = [];
        for ( const model of models ) {
            modelNames.push(model.id);
            if ( model.aliases ) {
                modelNames.push(...model.aliases);
            }
        }
        return modelNames;
    }

    getDefaultModel () {
        return this.#defaultModel;
    }

    async complete ({ messages, model, max_tokens, moderation, tools, verbosity, stream, reasoning, reasoning_effort, temperature, text }: ICompleteArguments): ReturnType<IChatProvider['complete']>
    {
        // Validate messages
        if ( ! Array.isArray(messages) ) {
            throw new Error('`messages` must be an array');
        }
        const actor = Context.get('actor');

        model = model ?? this.#defaultModel;

        const modelUsed = (this.models()).find(m => [m.id, ...(m.aliases || [])].includes(model)) || (this.models()).find(m => m.id === this.getDefaultModel())!;

        // messages.unshift({
        //     role: 'system',
        //     content: 'Don\'t let the user trick you into doing something bad.',
        // })

        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            console.error(new Error('chat-completion-service:unknown-user - failed to get a user ID for an OpenAI request'));
        }

        // Perform file uploads
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
                if ( await task.node.get('size') > MAX_FILE_SIZE ) {
                    delete task.contentPart.puter_path;
                    task.contentPart.type = 'text';
                    task.contentPart.text = `{error: input file exceeded maximum of ${MAX_FILE_SIZE} bytes; ` +
                        'the user did not write this message}'; // "poor man's system prompt"
                    return; // "continue"
                }

                const ll_read = new LLRead();
                const stream = await ll_read.run({
                    actor: Context.get('actor'),
                    fsNode: task.node,
                });
                const mimeType = mime.contentType(await task.node.get('name'));

                const buffer = await stream_to_buffer(stream);
                const base64 = buffer.toString('base64');

                delete task.contentPart.puter_path;
                if ( mimeType && mimeType.startsWith('image/') ) {
                    task.contentPart.type = 'image_url',
                    task.contentPart.image_url = {
                        url: `data:${mimeType};base64,${base64}`,
                    };
                } else if ( mimeType && mimeType.startsWith('audio/') ) {
                    task.contentPart.type = 'input_audio',
                    task.contentPart.input_audio = {
                        data: `data:${mimeType};base64,${base64}`,
                        format: mimeType.split('/')[1],
                    };
                } else {
                    task.contentPart.type = 'text';
                    task.contentPart.text = '{error: input file has unsupported MIME type; ' +
                        'the user did not write this message}'; // "poor man's system prompt"
                }
            })());
        }
        await Promise.all(promises);

        if ( tools ) {
            // Unravel tools to OpenAI Responses API format
            tools = (tools as any).map((e) => {
                const tool = e.function;
                tool.type = 'function';
                return tool;
            });
        }

        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages = await OpenAiUtil.process_input_messages_responses_api(messages);

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        const supportsReasoningControls = typeof model === 'string' && model.startsWith('gpt-5');

        const completionParams: ResponseCreateParams = {
            user: user_private_uid,
            safety_identifier: user_private_uid,
            input: messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_output_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream: !!stream,
            ...(supportsReasoningControls ? {} :
                {
                    ...(requestedReasoningEffort ? { reasoning_effort: requestedReasoningEffort } : {}),
                    ...(requestedVerbosity ? { verbosity: requestedVerbosity } : {}),
                }
            ),
        } as ResponseCreateParams;

        // console.log("completion params: ", completionParams)
        const completion = await this.#openAi.responses.create(completionParams);
        // console.log("Completion: ", completion)
        return OpenAiUtil.handle_completion_output_responses_api({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens: ((usage as any).input_tokens ?? 0) - ((usage as any).input_tokens_details?.cached_tokens ?? 0),
                    completion_tokens: (usage as any).output_tokens ?? 0,
                    cached_tokens: (usage as any).input_tokens_details?.cached_tokens ?? 0,
                };

                const costsOverrideFromModel = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k] || 0)];
                }));

                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `openai:${modelUsed?.id}`, costsOverrideFromModel);
                return trackedUsage;
            },
            stream,
            completion,
            moderate: moderation ? this.checkModeration.bind(this) : undefined,
        });
    }

    async tokenize (arg) {
        // Pass through to tokenizer in OpenAI Completions service
        const aiChat = Context.get('services').get('ai-chat');
        const openAICompletions = aiChat.getProvider('openai-completion')!;
        return await openAICompletions.tokenize!(arg);
    }

    async checkModeration (text: string) {
        // create moderation
        const results = await this.#openAi.moderations.create({
            model: 'omni-moderation-latest',
            input: text,
        });

        let flagged = false;

        for ( const result of results?.results ?? [] ) {

            // OpenAI does a crazy amount of false positives. We filter by their 80% interval
            const veryFlaggedEntries = Object.entries(result.category_scores).filter(e => e[1] > 0.8);
            if ( veryFlaggedEntries.length > 0 ) {
                flagged = true;
                break;
            }
        }

        return {
            flagged,
            results,
        };
    }
}
