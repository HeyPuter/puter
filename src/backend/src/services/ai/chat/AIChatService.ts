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

import { createId as cuid2 } from '@paralleldrive/cuid2';
import { PassThrough } from 'stream';
import { APIError } from '../../../api/APIError.js';
import { ErrorService } from '../../../modules/core/ErrorService.js';
import { Context } from '../../../util/context.js';
import { kv } from '../../../util/kvSingleton.js';
import BaseService from '../../BaseService.js';
import { BaseDatabaseAccessService } from '../../database/BaseDatabaseAccessService.js';
import { DriverService } from '../../drivers/DriverService.js';
import { TypedValue } from '../../drivers/meta/Runtime.js';
import { EventService } from '../../EventService.js';
import { MeteringService } from '../../MeteringService/MeteringService.js';
import { AsModeration } from '../moderation/AsModeration.js';
import { normalize_tools_object } from '../utils/FunctionCalling.js';
import { extract_text, normalize_messages, normalize_single_message } from '../utils/Messages.js';
import Streaming from '../utils/Streaming.js';
import { ClaudeProvider } from './providers/ClaudeProvider/ClaudeProvider.js';
import { DeepSeekProvider } from './providers/DeepSeekProvider/DeepSeekProvider.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import { GeminiChatProvider } from './providers/GeminiProvider/GeminiChatProvider.js';
import { GroqAIProvider } from './providers/GroqAiProvider/GroqAIProvider.js';
import { MistralAIProvider } from './providers/MistralAiProvider/MistralAiProvider.js';
import { OllamaChatProvider } from './providers/OllamaProvider.js';
import { OpenAiChatProvider } from './providers/OpenAiProvider/OpenAiChatCompletionsProvider.js';
import { OpenAiResponsesChatProvider } from './providers/OpenAiProvider/OpenAiChatResponsesProvider.js';
import { OpenRouterProvider } from './providers/OpenRouterProvider/OpenRouterProvider.js';
import { TogetherAIProvider } from './providers/TogetherAiProvider/TogetherAIProvider.js';
import { IChatModel, IChatProvider, ICompleteArguments } from './providers/types.js';
import { UsageLimitedChatProvider } from './providers/UsageLimitedChatProvider.js';
import { XAIProvider } from './providers/XAIProvider/XAIProvider.js';

// Maximum number of fallback attempts when a model fails, including the first attempt
const MAX_FALLBACKS = 3 + 1; // includes first attempt

export class AIChatService extends BaseService {

    static SERVICE_NAME = 'ai-chat';

    static DEFAULT_PROVIDER = 'openai-completion';

    get meteringService (): MeteringService {
        return this.services.get('meteringService').meteringService;
    }

    get db (): BaseDatabaseAccessService {
        return this.services.get('database').get();
    }

    get errorService (): ErrorService {
        return this.services.get('error-service');
    }

    get eventService (): EventService {
        return this.services.get('event');
    }

    get driverService (): DriverService {
        return this.services.get('driver');
    }

    getProvider (name: string): IChatProvider | undefined {
        return this.#providers[name];
    }

    #providers: Record<string, IChatProvider> = {};
    #modelIdMap: Record<string, IChatModel[]> = {};

    /** Driver interfaces */
    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface: string, method_name: string) {
                return iface === 'puter-chat-completion' &&
                    method_name === 'complete';
            },
        },
        ['puter-chat-completion']: {

            async models () {
                return await (this as unknown as AIChatService).models();
            },

            async list () {
                return await (this as unknown as AIChatService).list();
            },

            async complete (...parameters: Parameters<AIChatService['complete']>) {
                return await (this as unknown as AIChatService).complete(...parameters);
            },
        },
    };

    getModel ({ modelId, provider}: { modelId: string, provider?: string }) {
        const models = this.#modelIdMap[modelId];

        if ( ! models ) {
            throw new Error(`Model not found, please try one of the following models: ${ Object.keys(this.#modelIdMap).join(', ')}`);
        }
        if ( ! provider ) {
            return models[0];
        }
        const model = models.find(m => m.provider === provider);
        return model ?? models[0];
    }

    private async registerProviders () {
        const claudeConfig =  this.config.providers?.['claude'] || this.global_config?.services?.['claude'];
        if ( claudeConfig && claudeConfig.apiKey ) {
            this.#providers['claude'] = new ClaudeProvider(this.meteringService, claudeConfig, this.errorService);
        }
        const openAiConfig = this.config.providers?.['openai-completion'] || this.global_config?.services?.['openai-completion'] || this.global_config?.openai;
        if ( openAiConfig && (openAiConfig.apiKey || openAiConfig.secret_key) ) {
            this.#providers['openai-completion'] = new OpenAiChatProvider(this.meteringService, openAiConfig);
            this.#providers['openai-responses'] = new OpenAiResponsesChatProvider(this.meteringService, openAiConfig);
        }
        const geminiConfig = this.config.providers?.['gemini'] || this.global_config?.services?.['gemini'];
        if ( geminiConfig && geminiConfig.apiKey ) {
            this.#providers['gemini'] = new GeminiChatProvider(this.meteringService, geminiConfig);
        }
        const groqConfig = this.config.providers?.['groq'] || this.global_config?.services?.['groq'];
        if ( groqConfig && groqConfig.apiKey ) {
            this.#providers['groq'] = new GroqAIProvider(groqConfig, this.meteringService);
        }
        const deepSeekConfig = this.config.providers?.['deepseek'] || this.global_config?.services?.['deepseek'];
        if ( deepSeekConfig && deepSeekConfig.apiKey ) {
            this.#providers['deepseek'] = new DeepSeekProvider(deepSeekConfig, this.meteringService);
        }
        const mistralConfig = this.config.providers?.['mistral'] || this.global_config?.services?.['mistral'];
        if ( mistralConfig && mistralConfig.apiKey ) {
            this.#providers['mistral'] = new MistralAIProvider(mistralConfig, this.meteringService);
        }
        const xaiConfig = this.config.providers?.['xai'] || this.global_config?.services?.['xai'];
        if ( xaiConfig && xaiConfig.apiKey ) {
            this.#providers['xai'] = new XAIProvider(xaiConfig, this.meteringService);
        }
        const togetherConfig = this.config.providers?.['together-ai'] || this.global_config?.services?.['together-ai'];
        if ( togetherConfig && togetherConfig.apiKey ) {
            this.#providers['together-ai'] = new TogetherAIProvider(togetherConfig, this.meteringService);
        }
        const openrouterConfig = this.config.providers?.['openrouter'] || this.global_config?.services?.['openrouter'];
        if ( openrouterConfig && openrouterConfig.apiKey ) {
            this.#providers['openrouter'] = new OpenRouterProvider(openrouterConfig, this.meteringService);
        }

        // ollama if local instance detected

        // Autodiscover Ollama service and then check if its disabled in the config
        // if config.services.ollama.enabled is undefined, it means the user hasn't set it, so we should default to true
        const ollamaConfig = this.config.providers?.['ollama'] || this.global_config?.services?.ollama;
        const ollama_available = await fetch('http://localhost:11434/api/tags').then(resp => resp.json()).then(_data => {
            if ( ollamaConfig?.enabled === undefined ) {
                return true;
            }
            return ollamaConfig?.enabled;
        }).catch(_err => {
            return false;
        });
        // User can disable ollama in the config, but by default it should be enabled if discovery is successful
        if ( ollama_available || ollamaConfig?.enabled ) {
            console.log('🦙 Ollama support detected! Enabling local AI support');
            this.#providers['ollama'] = new OllamaChatProvider(ollamaConfig, this.meteringService);
        }

        // fake and usage-limited providers last
        this.#providers['fake-chat'] = new FakeChatProvider();
        this.#providers['usage-limited-chat'] = new UsageLimitedChatProvider();

        // emit event for extensions to add providers
        const extensionProviders = {} as Record<string, IChatProvider>;
        await this.eventService.emit('ai.chat.registerProviders', extensionProviders);
        for ( const providerName in extensionProviders ) {
            if ( this.#providers[providerName] ) {
                console.warn('AIChatService: provider name conflict for ', providerName, ' registering with -extension suffix');
                this.#providers[`${providerName}-extension`] = extensionProviders[providerName];
                continue;
            }
            this.#providers[providerName] = extensionProviders[providerName];
        }
    }

    protected async '__on_boot.consolidation' () {
        // register chat providers here
        await this.registerProviders();

        // build model id map
        for ( const providerName in this.#providers ) {
            const provider = this.#providers[providerName];

            // alias all driver requests to go here to support legacy routing
            this.driverService.register_service_alias(AIChatService.SERVICE_NAME,
                            providerName,
                            { iface: 'puter-chat-completion' });

            // build model id map
            for ( const model of await provider.models() ) {
                model.id = model.id.trim().toLowerCase();
                if ( ! this.#modelIdMap[model.id] ) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({ ...model, provider: providerName });
                if ( model.puterId ) {
                    if ( model.aliases ) {
                        model.aliases.push(model.puterId);
                    } else {
                        model.aliases = [model.puterId];
                    }
                }
                if ( model.aliases ) {
                    for ( let alias of model.aliases ) {
                        alias = alias.trim().toLowerCase();
                        // join arrays which are aliased the same
                        if ( ! this.#modelIdMap[alias] ) {
                            this.#modelIdMap[alias] = this.#modelIdMap[model.id];
                            continue;
                        }
                        if ( this.#modelIdMap[alias] !== this.#modelIdMap[model.id] ) {
                            this.#modelIdMap[alias].push({ ...model, provider: providerName });
                            this.#modelIdMap[model.id] = this.#modelIdMap[alias];
                            continue;
                        }
                    }
                }
                this.#modelIdMap[model.id].sort((a, b) => {
                    // Sort togetherai provider models last
                    if ( a.provider === 'together-ai' && b.provider !== 'together-ai' ) {
                        return 1;
                    }
                    if ( b.provider === 'together-ai' && a.provider !== 'together-ai' ) {
                        return -1;
                    }

                    if ( a.costs[a.input_cost_key || 'input_tokens'] === b.costs[b.input_cost_key || 'input_tokens'] ) {
                        return a.id.length - b.id.length; // use shorter id since its likely the official one
                    }
                    return a.costs[a.input_cost_key || 'input_tokens'] - b.costs[b.input_cost_key || 'input_tokens'];
                });
            }
        }
    }

    models () {
        const seen = new Set<string>();
        return Object.entries(this.#modelIdMap)
            .map(([_, models]) => models)
            .flat()
            .filter(model => {
                if ( seen.has(model.id) ) {
                    return false;
                }
                seen.add(model.id);
                return true;
            })
            .sort((a, b) => {
                if ( a.provider === b.provider ) {
                    return a.id.localeCompare(b.id);
                }
                return a.provider!.localeCompare(b.provider!);
            });
    }

    list () {
        return this.models().map(m => (m.puterId || m.id)).sort();
    }

    async complete (parameters: ICompleteArguments) {
        const clientDriverCall = Context.get('client_driver_call');
        let { test_mode: testMode, response_metadata: resMetadata, intended_service: legacyProviderName } = clientDriverCall as { test_mode?: boolean; response_metadata: Record<string, unknown>; intended_service?: string };
        const actor = Context.get('actor');

        let intendedProvider = parameters.provider || (legacyProviderName === AIChatService.SERVICE_NAME ? '' : legacyProviderName); // should now all go through here

        if ( !parameters.model && !intendedProvider ) {
            intendedProvider = AIChatService.DEFAULT_PROVIDER;
        }
        if ( !parameters.model && intendedProvider ) {
            parameters.model = this.#providers[intendedProvider].getDefaultModel();
        }
        let model = this.getModel({ modelId: parameters.model, provider: intendedProvider }) || this.getFallbackModel(parameters.model, [], []);
        const abuseModel = this.getModel({ modelId: 'abuse' });
        const usageLimitedModel = this.getModel({ modelId: 'usage-limited' });

        const completionId = cuid2();
        const event = {
            actor,
            completionId,
            allow: true,
            intended_service: intendedProvider || '',
            parameters,
        } as Record<string, unknown>;
        await this.eventService.emit('ai.prompt.validate', event);
        if ( ! event.allow ) {
            testMode = true;
            if ( event.custom ) parameters.custom = event.custom;
        }

        if ( parameters.messages ) {
            parameters.messages =
                normalize_messages(parameters.messages);
        }

        // Skip moderation for Ollama (local service) and other local services
        const should_moderate = !testMode &&
            parameters.provider !== 'ollama';

        if ( should_moderate && !await this.moderate(parameters) ) {
            testMode = true;
            throw APIError.create('moderation_failed');
        }

        // Only set moderated flag if we actually ran moderation
        if ( !testMode && should_moderate ) {
            Context.set('moderated', true);
        }

        if ( testMode ) {
            if ( event.abuse ) {
                model = abuseModel;
            }
        }

        if ( parameters.tools ) {
            normalize_tools_object(parameters.tools);
        }

        if ( ! model ) {
            // TODO DS: route them to new endpoints once ready
            const availableModelsUrl = `${this.global_config.origin }/puterai/chat/models`;

            throw APIError.create('field_invalid', undefined, {
                key: 'model',
                expected: `a valid model name from ${availableModelsUrl}`,
                got: model,
            });
        }

        const inputTokenCost = model.costs[model.input_cost_key || 'input_tokens'] as number;
        const outputTokenCost =  model.costs[model.output_cost_key || 'output_tokens'] as number;
        const maxTokens = model.max_tokens;
        const text = extract_text(parameters.messages);
        const approximateTokenCount = Math.floor(((text.length / 4) + (text.split(/\s+/).length * (4 / 3))) / 2); // see https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
        const approximateInputCost = approximateTokenCount * inputTokenCost;
        const usageAllowed = await this.meteringService.hasEnoughCredits(actor, approximateInputCost);

        // Handle usage limits reached case
        if ( ! usageAllowed ) {
            model = usageLimitedModel;
        }

        const availableCredits = await this.meteringService.getRemainingUsage(actor);
        const maxAllowedOutput =
            availableCredits - approximateInputCost;

        const maxAllowedOutputTokens =
            maxAllowedOutput / outputTokenCost;

        if ( maxAllowedOutputTokens ) {
            parameters.max_tokens = Math.floor(Math.min(parameters.max_tokens ?? Number.POSITIVE_INFINITY,
                            maxAllowedOutputTokens,
                            maxTokens - approximateTokenCount));
            if ( parameters.max_tokens < 1 ) {
                parameters.max_tokens = undefined;
            }
        }

        // call model provider;
        let res: Awaited<ReturnType<IChatProvider['complete']>>;
        const provider = this.#providers[model.provider!];
        if ( ! provider ) {
            throw new Error(`no provider found for model ${model.id}`);
        }
        try {
            res = await provider.complete({
                ...parameters,
                model: model.id,
                provider: model.provider,
            });
        } catch (e) {
            const tried: string[] = [];
            const triedProviders: string[] = [];

            tried.push(model.id);
            triedProviders.push(model.provider!);

            let error = e as Error;

            while ( error ) {

                // TODO: simplify our error handling
                // Distinguishing between user errors and service errors
                // is very messy because of different conventions between
                // services. This is a best-effort attempt to catch user
                // errors and throw them as 400s.
                const isRequestError = (() => {
                    if ( error instanceof APIError ) {
                        return true;
                    }
                    if ( (error as unknown as { type: string }).type === 'invalid_request_error' ) {
                        return true;
                    }
                })();

                if ( isRequestError ) {
                    console.error((error as Error));
                    throw APIError.create('error_400_from_delegate', error as Error, {
                        delegate: model.provider,
                        message: (error as Error).message,
                    });
                }

                if ( this.config.disable_fallback_mechanisms ) {
                    console.error((error as Error));
                    throw error;
                }

                console.error('error calling ai chat provider for model: ', model, '\n trying fallbacks...');

                // No fallbacks for pseudo-models
                if ( model.provider === 'fake-chat' ) {
                    break;
                }

                const fallback = this.getFallbackModel(model.id, tried, triedProviders);

                tried.push(model.id);
                triedProviders.push(model.provider!);

                if ( tried.length >= MAX_FALLBACKS ) {
                    console.error('max fallbacks reached', { tried, triedProviders });
                    break;
                }

                if ( ! fallback ) {
                    throw new Error('no fallback model available');
                }

                const {
                    fallbackModelId,
                    fallbackProvider,
                } = fallback;

                console.warn('model fallback', {
                    fallbackModelId,
                    fallbackProvider,
                });

                let fallBackModel = this.getModel({ modelId: fallbackModelId, provider: fallbackProvider });

                const fallbackUsageAllowed = await this.meteringService.hasEnoughCredits(actor, 1); // we checked earlier, assume same costs

                if ( ! fallbackUsageAllowed ) {
                    fallBackModel = usageLimitedModel;
                }

                const provider = this.#providers[fallBackModel.provider!];
                if ( ! provider ) {
                    throw new Error(`no provider found for model ${fallBackModel.id}`);
                }
                try {
                    res = await provider.complete({
                        ...parameters,
                        model: fallBackModel.id,
                        provider: fallBackModel.provider,
                    });
                    model = fallBackModel;
                    break; // success
                } catch (e) {
                    console.error('error during fallback selection: ', e);
                    error = e as Error;
                }
            }
        }

        resMetadata.service_used = model.provider; // legacy field
        resMetadata.providerUsed = model.id;

        // Add flag if we're using the usage-limited service
        if ( model.provider === 'usage-limited-chat' ) {
            resMetadata.usage_limited = true;
        }

        const username = actor.type?.user?.username;

        if ( ! res! ) {
            throw new Error('No response from AI chat provider');
        }

        res.via_ai_chat_service = true; // legacy field always true now
        if ( res.stream ) {
            if ( res.init_chat_stream ) {
                const stream = new PassThrough();
                // TODO DS: simplify how we handle streaming responses and remove custom runtime types
                const retval = new TypedValue({
                    $: 'stream',
                    content_type: 'application/x-ndjson',
                    chunked: true,
                }, stream);

                const chatStream = new Streaming.AIChatStream({
                    stream,
                });

                (async () => {
                    try {
                        await res.init_chat_stream({ chatStream });
                    } catch (e) {
                        this.errors.report('error during stream response', {
                            source: e,
                        });
                        stream.write(`${JSON.stringify({
                            type: 'error',
                            message: (e as Error).message,
                        }) }\n`);
                        stream.end();
                    } finally {
                        if ( res.finally_fn ) {
                            await res.finally_fn();
                        }
                    }
                })();

                return retval;
            }

            return res;
        }
        await this.eventService.emit('ai.prompt.complete', {
            username,
            intended_service: intendedProvider,
            parameters,
            result: res,
            model_used: model.id,
            service_used: model.provider,
        });

        if ( parameters.response?.normalize ) {
            res = {
                ...res,
                message: normalize_single_message(res.message),
                normalized: true,
            };
        }
        return res;

    }

    async moderate ({ messages }: { messages: Array<unknown>; }) {
        if ( process.env.TEST_MODERATION_FAILURE ) return false;
        const fulltext = extract_text(messages);
        let mod_last_error;
        let mod_result: Awaited<ReturnType<IChatProvider['checkModeration']>>;
        try {
            const openaiProvider = this.#providers['openai-completion'];
            mod_result = await openaiProvider.checkModeration(fulltext);
            if ( mod_result.flagged ) return false;
            return true;
        } catch (e) {
            console.error(e);
            mod_last_error = e;
        }
        try {
            const claudeChatProvider = this.#providers['claude'];
            const mod = new AsModeration({
                chatProvider: claudeChatProvider,
                model: 'claude-3-haiku-20240307',
            });
            if ( ! await mod.moderate(fulltext) ) {
                return false;
            }
            mod_last_error = null;
            return true;
        } catch (e) {
            console.error(e);
            mod_last_error = e;
        }

        if ( mod_last_error ) {
            this.log.error('moderation error', {
                fulltext,
                mod_last_error,
            });
            throw new Error('no working moderation service');
        }
        return true;
    }

    /**
     * Find an appropriate fallback model by sorting the list of models
     * by the euclidean distance of the input/output prices and selecting
     * the first one that is not in the tried list.
     *
     * @param {*} param0
     * @returns
     */
    getFallbackModel (modelId: string, triedIds: string[], triedProviders: string[]) {
        const models = this.#modelIdMap[modelId];

        if ( ! models ) {
            this.log.error('could not find model', { modelId });
            throw new Error('could not find model');
        }

        const targetModel = models[0];

        // First see if any models with the same id but different provider exist
        for ( const model of models ) {
            if ( triedProviders.includes(model.provider!) ) continue;
            if ( model.provider === 'fake-chat' ) continue;
            return {
                fallbackProvider: model.provider,
                fallbackModelId: model.id,
            };
        }

        // First check KV for the sorted list
        let potentialFallbacks = kv.get(`aichat:fallbacks:${targetModel.id}`);

        if ( ! potentialFallbacks ) {
            // Calculate the sorted list
            const models =  this.models();

            let aiProvider, modelToSearch;
            if ( targetModel.id.startsWith('openrouter:') || targetModel.id.startsWith('togetherai:') ) {
                [aiProvider, modelToSearch] = targetModel.id.replace('openrouter:', '').replace('togetherai:', '').toLowerCase().split('/');
            } else {
                [aiProvider, modelToSearch] = targetModel.provider!.toLowerCase().replace('gemini', 'google').replace('openai-completion', 'openai'), targetModel.id.toLowerCase();
            }

            const potentialMatches = models.filter(model => {
                const possibleModelNames = [`openrouter:${aiProvider}/${modelToSearch}`,
                    `togetherai:${aiProvider}/${modelToSearch}`, ...(targetModel.aliases?.map((alias) => [`openrouter:${aiProvider}/${alias}`,
                        `togetherai:${aiProvider}/${alias}`])?.flat() ?? [])];

                return !!possibleModelNames.find(possibleName => model.id.toLowerCase() === possibleName);
            }).slice(0, MAX_FALLBACKS);

            kv.set(`aichat:fallbacks:${modelId}`, potentialMatches);
            potentialFallbacks = potentialMatches;
        }

        for ( const model of potentialFallbacks ) {
            if ( triedIds.includes(model.id) ) continue;
            if ( model.provider === 'fake-chat' ) continue;

            return {
                fallbackProvider: model.provider,
                fallbackModelId: model.id,
            };
        }

        // No fallbacks available
        console.error('no fallbacks', {
            potentialFallbacks,
            triedIds,
            triedProviders,
        });
    }
}
