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
import { APIError } from '../../../api/APIError.js';
import { ErrorService } from '../../../modules/core/ErrorService.js';
import { Context } from '../../../util/context.js';
import BaseService from '../../BaseService.js';
import { DriverService } from '../../drivers/DriverService.js';
import { TypedValue } from '../../drivers/meta/Runtime.js';
import { EventService } from '../../EventService.js';
import { MeteringService } from '../../MeteringService/MeteringService.js';
import { OpenAiVideoGenerationProvider } from './providers/OpenAiVideoGenerationProvider/OpenAiVideoGenerationProvider.js';
import { TogetherVideoGenerationProvider } from './providers/TogetherVideoGenerationProvider/TogetherVideoGenerationProvider.js';
import { IVideoGenerateParams, IVideoModel, IVideoProvider } from './providers/types.js';

export class AIVideoGenerationService extends BaseService {
    static SERVICE_NAME = 'ai-video';

    static DEFAULT_PROVIDER = 'openai-video-generation';

    get meteringService (): MeteringService {
        return this.services.get('meteringService').meteringService;
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

    getProvider (name: string): IVideoProvider | undefined {
        return this.#providers[name];
    }

    #providers: Record<string, IVideoProvider> = {};
    #modelIdMap: Record<string, IVideoModel[]> = {};

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface: string, method_name: string) {
                return iface === 'puter-video-generation' &&
                    method_name === 'generate';
            },
        },
        ['puter-video-generation']: {
            async generate (...parameters: Parameters<AIVideoGenerationService['generate']>) {
                return (this as unknown as AIVideoGenerationService).generate(...parameters);
            },
            async models () {
                return (this as unknown as AIVideoGenerationService).models();
            },
            async list () {
                return (this as unknown as AIVideoGenerationService).list();
            },
        },
    };

    getModel ({ modelId, provider }: { modelId: string; provider?: string }) {
        const models = this.#modelIdMap[modelId];
        if ( ! models ) {
            return undefined;
        }
        if ( ! provider ) {
            return models[0];
        }
        return models.find(m => m.provider === provider) ?? models[0];
    }

    private async registerProviders () {
        const openAiConfig = this.config.providers?.['openai-video-generation'] || this.global_config?.services?.openai || this.global_config?.openai;
        if ( openAiConfig && (openAiConfig.apiKey || openAiConfig.secret_key) ) {
            this.#providers['openai-video-generation'] = new OpenAiVideoGenerationProvider({ apiKey: openAiConfig.apiKey || openAiConfig.secret_key }, this.meteringService);
        }

        const togetherConfig = this.config.providers?.['together-video-generation'] || this.global_config?.services?.['together-ai'];
        if ( togetherConfig && (togetherConfig.apiKey || togetherConfig.secret_key) ) {
            this.#providers['together-video-generation'] = new TogetherVideoGenerationProvider({ apiKey: togetherConfig.apiKey || togetherConfig.secret_key }, this.meteringService, this.errorService);
        }

        const extensionProviders = {} as Record<string, IVideoProvider>;
        await this.eventService.emit('ai.video.registerProviders', extensionProviders);
        for ( const providerName in extensionProviders ) {
            if ( this.#providers[providerName] ) {
                console.warn('AIVideoGenerationService: provider name conflict for ', providerName, ' registering with -extension suffix');
                this.#providers[`${providerName}-extension`] = extensionProviders[providerName];
                continue;
            }
            this.#providers[providerName] = extensionProviders[providerName];
        }
    }

    protected async '__on_boot.consolidation' () {
        await this.registerProviders();

        for ( const providerName in this.#providers ) {
            const provider = this.#providers[providerName];

            this.driverService.register_service_alias(AIVideoGenerationService.SERVICE_NAME,
                            providerName,
                            { iface: 'puter-video-generation' });

            for ( const model of await provider.models() ) {
                if ( ! this.#modelIdMap[model.id] ) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({ ...model, provider: providerName });
                if ( model.aliases ) {
                    for ( const alias of model.aliases ) {
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
                    const aCostKey = a.index_cost_key || Object.keys(a.costs)[0];
                    const bCostKey = b.index_cost_key || Object.keys(b.costs)[0];
                    return a.costs[aCostKey] - b.costs[bCostKey];
                });
            }
        }
    }

    models () {
        return Object.entries(this.#modelIdMap)
            .map(([_, models]) => models)
            .flat()
            .sort((a, b) => {
                if ( a.provider === b.provider ) {
                    return a.id.localeCompare(b.id);
                }
                return a.provider!.localeCompare(b.provider!);
            });
    }

    list () {
        return Object.keys(this.#modelIdMap).sort();
    }

    async generate (parameters: IVideoGenerateParams) {
        const clientDriverCall = Context.get('client_driver_call');
        let { test_mode: testMode, intended_service: legacyProviderName } = clientDriverCall as { test_mode?: boolean; response_metadata: Record<string, unknown>; intended_service?: string };

        const configuredProviders = Object.keys(this.#providers);
        if ( configuredProviders.length === 0 ) {
            throw new Error('no video generation providers configured');
        }

        let intendedProvider = (parameters.provider || (legacyProviderName === AIVideoGenerationService.SERVICE_NAME ? '' : legacyProviderName)) ?? '';

        if ( !parameters.model && !intendedProvider ) {
            intendedProvider = configuredProviders.includes(AIVideoGenerationService.DEFAULT_PROVIDER)
                ? AIVideoGenerationService.DEFAULT_PROVIDER
                : configuredProviders[0];
        }

        if ( intendedProvider && !this.#providers[intendedProvider] ) {
            intendedProvider = configuredProviders[0];
        }

        if ( !parameters.model && intendedProvider ) {
            parameters.model = this.#providers[intendedProvider].getDefaultModel();
        }

        const model = parameters.model ? this.getModel({ modelId: parameters.model, provider: intendedProvider }) : undefined;

        if ( ! model ) {
            const availableModelsUrl = `${this.global_config.origin}/puterai/video/models`;

            throw APIError.create('field_invalid', undefined, {
                key: 'model',
                expected: `a valid model name from ${availableModelsUrl}`,
                got: parameters.model,
            });
        }

        const provider = this.#providers[model.provider!];
        if ( ! provider ) {
            throw new Error(`no provider found for model ${model.id}`);
        }

        if ( model.allowedDurationsSeconds?.length ) {
            const requestedSeconds = parameters.seconds ?? parameters.duration;
            const normalizedSeconds = typeof requestedSeconds === 'string'
                ? Number.parseInt(requestedSeconds, 10)
                : requestedSeconds;
            const validSeconds = model.allowedDurationsSeconds.includes(Number(normalizedSeconds))
                ? normalizedSeconds
                : model.allowedDurationsSeconds[0];
            parameters.seconds = validSeconds;
            parameters.duration = validSeconds;
        }

        if ( model.allowedResolutions?.length ) {
            const requestedResolution = typeof parameters.size === 'string' && parameters.size.trim()
                ? parameters.size
                : typeof parameters.resolution === 'string' && parameters.resolution.trim()
                    ? parameters.resolution
                    : undefined;

            const normalizedResolution = requestedResolution && model.allowedResolutions.includes(requestedResolution)
                ? requestedResolution
                : model.allowedResolutions[0];
            parameters.size = normalizedResolution;
            parameters.resolution = normalizedResolution;
        }

        const result = await provider.generate({
            ...parameters,
            model: model.id,
            provider: model.provider,
            test_mode: testMode,
        });

        return result as unknown as TypedValue;
    }
}
