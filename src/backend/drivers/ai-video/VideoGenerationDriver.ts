import { HttpError } from '../../core/http/HttpError.js';
import { Context } from '../../core/context.js';
import { PuterDriver } from '../types.js';
import type { IVideoProvider, IVideoModel, IGenerateVideoParams } from './types.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import { OpenAIVideoProvider } from './providers/openai/OpenAIVideoProvider.js';
import { TogetherVideoProvider } from './providers/together/TogetherVideoProvider.js';
import { GeminiVideoProvider } from './providers/gemini/GeminiVideoProvider.js';

const DEFAULT_PROVIDER = 'openai-video-generation';

/**
 * Driver implementing the `puter-video-generation` interface.
 *
 * Manages multiple upstream providers (OpenAI/Sora, Together, Gemini/Veo, ...)
 * and handles model resolution, provider routing, and parameter normalisation.
 * Each provider is a plain `IVideoProvider` -- the driver instantiates them
 * from config on boot.
 *
 * Providers handle their own metering internally.
 */
export class VideoGenerationDriver extends PuterDriver {
    readonly driverInterface = 'puter-video-generation';
    readonly driverName = 'ai-video';
    readonly isDefault = true;

    #providers: Record<string, IVideoProvider> = {};
    #modelIdMap: Record<string, IVideoModel[]> = {};

    override onServerStart () {
        this.#registerProviders();
        this.#buildModelMap();
    }

    // -- Interface methods ---------------------------------------------------

    async models () {
        const seen = new Set<string>();
        return Object.values(this.#modelIdMap)
            .flat()
            .filter(model => {
                const identity = `${model.provider}:${model.puterId || model.id}`;
                if ( seen.has(identity) ) return false;
                seen.add(identity);
                return true;
            })
            .sort((a, b) => {
                if ( a.provider === b.provider ) return a.id.localeCompare(b.id);
                return a.provider!.localeCompare(b.provider!);
            });
    }

    async list () {
        return (await this.models()).map(m => m.puterId || m.id).sort();
    }

    async generate (args: IGenerateVideoParams) {
        const actor = Context.get('actor');
        if ( ! actor ) throw new HttpError(401, 'Authentication required');

        if ( args.model ) {
            args.model = args.model.trim().toLowerCase();
        }

        const configuredProviders = Object.keys(this.#providers);
        if ( configuredProviders.length === 0 ) {
            throw new Error('no video generation providers configured');
        }

        let intendedProvider = args.provider ?? '';

        if ( !args.model && !intendedProvider ) {
            intendedProvider = configuredProviders.includes(DEFAULT_PROVIDER)
                ? DEFAULT_PROVIDER
                : configuredProviders[0];
        }

        if ( intendedProvider && !this.#providers[intendedProvider] ) {
            intendedProvider = configuredProviders[0];
        }

        if ( !args.model && intendedProvider ) {
            args.model = this.#providers[intendedProvider].getDefaultModel();
        }

        const model = args.model
            ? this.#resolveModel(args.model, intendedProvider)
            : undefined;

        if ( ! model ) {
            throw new HttpError(400, `Model not found: ${args.model}`);
        }

        const provider = this.#providers[model.provider!];
        if ( ! provider ) {
            throw new HttpError(500, `No provider found for model ${model.id}`);
        }

        // Validate / normalise duration
        if ( model.durationSeconds?.length ) {
            const requestedSeconds = args.seconds ?? args.duration;
            const normalizedSeconds = typeof requestedSeconds === 'string'
                ? Number.parseInt(requestedSeconds, 10)
                : requestedSeconds;
            const validSeconds = model.durationSeconds.includes(Number(normalizedSeconds))
                ? normalizedSeconds
                : model.durationSeconds[0];
            args.seconds = validSeconds;
            args.duration = validSeconds;
        }

        // Validate / normalise dimensions
        if ( model.dimensions?.length ) {
            const requestedResolution = typeof args.size === 'string' && args.size.trim()
                ? args.size
                : typeof args.resolution === 'string' && args.resolution.trim()
                    ? args.resolution
                    : undefined;

            const normalizedResolution = requestedResolution && model.dimensions.includes(requestedResolution)
                ? requestedResolution
                : model.dimensions[0];
            args.size = normalizedResolution;
            args.resolution = normalizedResolution;
        }

        return await provider.generate({
            ...args,
            model: model.id,
            provider: model.provider,
        });
    }

    // -- Provider registration -----------------------------------------------

    #registerProviders () {
        const providers = this.config.providers ?? {};
        const m = this.services.metering;

        const openai = providers['openai-video-generation'];
        if ( openai?.apiKey ) {
            this.#providers['openai-video-generation'] = new OpenAIVideoProvider({ apiKey: openai.apiKey }, m);
        }

        const together = providers['together-video-generation'];
        if ( together?.apiKey ) {
            this.#providers['together-video-generation'] = new TogetherVideoProvider({ apiKey: together.apiKey }, m);
        }

        const gemini = providers['gemini-video-generation'];
        if ( gemini?.apiKey ) {
            this.#providers['gemini-video-generation'] = new GeminiVideoProvider({ apiKey: gemini.apiKey }, m);
        }
    }

    // -- Model map -----------------------------------------------------------

    async #buildModelMap () {
        for ( const providerName in this.#providers ) {
            const provider = this.#providers[providerName];
            for ( const model of await provider.models() ) {
                model.id = model.id.trim().toLowerCase();
                if ( model.puterId ) {
                    model.puterId = model.puterId.trim().toLowerCase();
                }
                if ( model.aliases ) {
                    model.aliases = model.aliases.map(alias => alias.trim().toLowerCase());
                }
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

                    // Derive standard alias forms from puterId for model singularity:
                    // puterId "service:org/model" -> "org/model" and "model"
                    const withoutService = model.puterId.includes(':')
                        ? model.puterId.slice(model.puterId.indexOf(':') + 1)
                        : model.puterId;
                    if ( ! model.aliases.includes(withoutService) ) {
                        model.aliases.push(withoutService);
                    }
                    const shortName = withoutService.includes('/')
                        ? withoutService.slice(withoutService.indexOf('/') + 1)
                        : withoutService;
                    if ( shortName !== withoutService && !model.aliases.includes(shortName) ) {
                        model.aliases.push(shortName);
                    }
                }

                if ( model.aliases ) {
                    for ( let alias of model.aliases ) {
                        alias = alias.trim().toLowerCase();
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

                // Sort: cheapest first
                this.#modelIdMap[model.id].sort((a, b) => {
                    const aCostKey = a.index_cost_key || a.output_cost_key || Object.keys(a.costs || {})[0];
                    const bCostKey = b.index_cost_key || b.output_cost_key || Object.keys(b.costs || {})[0];
                    const aCost = a.costs?.[aCostKey] ?? Infinity;
                    const bCost = b.costs?.[bCostKey] ?? Infinity;
                    return aCost - bCost;
                });
            }
        }
    }

    #resolveModel (modelId: string, provider?: string): IVideoModel | null {
        const models = this.#modelIdMap[modelId?.trim().toLowerCase()];
        if ( !models || models.length === 0 ) return null;
        if ( ! provider ) return models[0];

        // Prefer exact primary ID match over alias matches
        const exactIdMatch = models.find(m => m.id === modelId && m.provider === provider);
        if ( exactIdMatch ) return exactIdMatch;

        const exactPuterIdMatch = models.find(m => m.puterId === modelId && m.provider === provider);
        if ( exactPuterIdMatch ) return exactPuterIdMatch;

        return models.find(m => m.provider === provider) ?? models[0];
    }
}
