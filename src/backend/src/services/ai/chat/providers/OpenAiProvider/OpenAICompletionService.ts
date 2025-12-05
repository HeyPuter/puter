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

import { OpenAI } from 'openai';;
import { OPEN_AI_MODELS } from './models';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { IChatModel, IChatProvider } from '../types';
import { RecursiveRecord } from '../../../../MeteringService/types.js';
import * as OpenAiUtil from '../../../utils/OpenAIUtil';
import { Context } from '../../../../../util/context';
// METADATA // {"ai-commented":{"service":"claude"}}

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
export class OpenAICompletionService implements IChatProvider {
    /**
     * @type {import('openai').OpenAI}
     */
    #openAi: OpenAI;

    #defaultModel: IChatModel['id'];

    #models: IChatModel[];

    #meteringService: MeteringService;

    constructor ({
        config,
        meteringService,
        models = OPEN_AI_MODELS,
        defaultModel = 'gpt-5-nano' }: { config: { openai: { apiKey: string, secret_key: string } }, meteringService: MeteringService, models: IChatModel[], defaultModel: IChatModel['id'] }) {

        this.#models = models;
        this.#defaultModel = defaultModel;
        this.#meteringService = meteringService;
        let apiKey = config.openai.apiKey;

        // Fallback to the old format for backward compatibility
        if ( ! apiKey ) {
            apiKey = config?.openai?.secret_key;

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
        return this.#models;
    }

    list () {
        const models =  this.models();
        const model_names = [];
        for ( const model of models ) {
            model_names.push(model.id);
            if ( model.aliases ) {
                model_names.push(...model.aliases);
            }
        }
        return model_names;
    }

    get_default_model () {
        return this.#defaultModel;
    }

    async complete ({ model, messages, stream}: { messages: { content: unknown }[]; stream?: boolean | undefined; model: string; tools?: unknown[] | undefined; max_tokens?: number | undefined; temperature?: number | undefined; }) {
        // Validate messages
        if ( ! Array.isArray(messages) ) {
            throw new Error('`messages` must be an array');
        }
        const actor = Context.get('actor');

        model = model ?? this.#defaultModel;

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
                if ( mimeType.startsWith('image/') ) {
                    task.contentPart.type = 'image_url',
                    task.contentPart.image_url = {
                        url: `data:${mimeType};base64,${base64}`,
                    };
                } else if ( mimeType.startsWith('audio/') ) {
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

        // Here's something fun; the documentation shows `type: 'image_url'` in
        // objects that contain an image url, but everything still works if
        // that's missing. We normalise it here so the token count code works.
        messages = await OpenAiUtil.process_input_messages(messages);

        const requestedReasoningEffort = reasoning_effort ?? reasoning?.effort;
        const requestedVerbosity = verbosity ?? text?.verbosity;
        const supportsReasoningControls = typeof model === 'string' && model.startsWith('gpt-5');

        const completionParams = {
            user: user_private_uid,
            messages: messages,
            model: model,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        };

        if ( supportsReasoningControls ) {
            if ( requestedReasoningEffort ) {
                completionParams.reasoning_effort = requestedReasoningEffort;
            }
            if ( requestedVerbosity ) {
                completionParams.verbosity = requestedVerbosity;
            }
        }

        const completion = await this.#openAi.chat.completions.create(completionParams);
        // TODO DS: simplify this logic for all the ai services, each service should handle its cost calculation in the service
        // for now I'm overloading this usage calculator to handle the future promise resolution...
        return OpenAiUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const modelDetails = this.models().find(m => m.id === model || m.aliases?.includes(model));
                const trackedUsage = {
                    prompt_tokens: (usage.prompt_tokens ?? 0) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion_tokens: usage.completion_tokens ?? 0,
                    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
                };

                this.#meteringService.utilRecordUsageObject(trackedUsage, actor, `openai:${modelDetails.id}`);
                const legacyCostCalculator = OpenAiUtil.create_usage_calculator({
                    model_details: modelDetails,
                });

                return legacyCostCalculator({ usage });
            },
            stream,
            completion,
            moderate: moderation && this.checkModeration.bind(this),
        });
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
