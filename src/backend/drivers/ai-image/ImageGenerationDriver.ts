import crypto from 'node:crypto';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterDriver } from '../types.js';
import { CloudflareImageProvider } from './providers/cloudflare/CloudflareImageProvider.js';
import { GeminiImageProvider } from './providers/gemini/GeminiImageProvider.js';
import { OpenAiImageProvider } from './providers/openai/OpenAiImageProvider.js';
import { ReplicateImageGenerationProvider } from './providers/replicate/ReplicateImageGenerationProvider.js';
import { TogetherImageProvider } from './providers/together/TogetherImageProvider.js';
import { XAIImageProvider } from './providers/xai/XAIImageProvider.js';
import type { IGenerateParams, IImageModel, IImageProvider } from './types.js';

/**
 * Driver implementing the `puter-image-generation` interface.
 *
 * Manages multiple upstream providers and routes `generate()` calls
 * based on the requested model. Mirrors ChatCompletionDriver's pattern:
 * providers are instantiated from config on boot, a model map is built
 * from each provider's declared models, and calls are dispatched.
 *
 * Output is a URL string (web URL or data URI) — no streaming, no
 * TypedValue wrapper.
 */
export class ImageGenerationDriver extends PuterDriver {
    readonly driverInterface = 'puter-image-generation';
    readonly driverName = 'ai-image';
    readonly isDefault = true;

    #providers: Record<string, IImageProvider> = {};
    #modelIdMap: Record<string, IImageModel[]> = {};

    override onServerStart() {
        this.#registerProviders();
        this.#buildModelMap();
    }

    // ── Interface methods ───────────────────────────────────────────

    async models() {
        const seen = new Set<string>();
        return Object.values(this.#modelIdMap)
            .flat()
            .filter((m) => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
            })
            .sort((a, b) => {
                if (a.provider === b.provider) return a.id.localeCompare(b.id);
                return (a.provider ?? '').localeCompare(b.provider ?? '');
            });
    }

    async list() {
        return (await this.models()).map((m) => m.puterId || m.id).sort();
    }

    async generate(args: IGenerateParams): Promise<string> {
        const actor = Context.get('actor');
        if (!actor) throw new HttpError(401, 'Authentication required');

        let modelId = args.model?.trim().toLowerCase();
        let intendedProvider = args.provider;

        // Default: first registered provider's default model if none given
        if (!modelId && !intendedProvider) {
            intendedProvider = Object.keys(this.#providers)[0];
        }
        if (!modelId && intendedProvider) {
            modelId = this.#providers[intendedProvider]?.getDefaultModel();
        }
        if (!modelId) throw new HttpError(400, 'Missing `model`');

        const model = this.#resolveModel(modelId, intendedProvider);
        if (!model) {
            throw new HttpError(400, `Model not found: ${args.model}`);
        }

        const provider = this.#providers[model.provider!];
        if (!provider) {
            throw new HttpError(500, `No provider found for model ${model.id}`);
        }

        // Audit log for abuse / billing. Fired before the upstream call
        // so a failed generate still shows up in the log (prompt_block
        // uses this to track user-by-user image prompts).
        const completionId = crypto.randomUUID();
        this.clients.event.emit(
            'ai.log.image',
            {
                actor,
                completionId,
                parameters: args,
                intended_service: model.id,
                model_used: model.id,
                service_used: model.provider,
            },
            {},
        );

        return provider.generate({
            ...args,
            model: model.id,
            provider: model.provider,
        });
    }

    // ── Provider registration ───────────────────────────────────────

    #registerProviders() {
        const providers = this.config.providers ?? {};
        const m = this.services.metering;

        const openai = providers['openai-image-generation'];
        if (openai?.apiKey) {
            this.#providers['openai-image-generation'] =
                new OpenAiImageProvider({ apiKey: openai.apiKey }, m);
        }

        const gemini = providers['gemini-image-generation'];
        if (gemini?.apiKey) {
            this.#providers['gemini-image-generation'] =
                new GeminiImageProvider({ apiKey: gemini.apiKey }, m);
        }

        const together = providers['together-image-generation'];
        if (together?.apiKey) {
            this.#providers['together-image-generation'] =
                new TogetherImageProvider({ apiKey: together.apiKey }, m);
        }

        const cloudflare = providers['cloudflare-image-generation'];
        if (cloudflare?.apiToken && cloudflare?.accountId) {
            this.#providers['cloudflare-image-generation'] =
                new CloudflareImageProvider(
                    {
                        apiToken: cloudflare.apiToken,
                        accountId: cloudflare.accountId,
                        apiBaseUrl: cloudflare.apiBaseUrl,
                    },
                    m,
                );
        }

        const xai = providers['xai-image-generation'];
        if (xai?.apiKey) {
            this.#providers['xai-image-generation'] = new XAIImageProvider(
                { apiKey: xai.apiKey },
                m,
            );
        }

        const replicate = providers['replicate-image-generation'];
        if (replicate?.apiKey) {
            this.#providers['replicate-image-generation'] =
                new ReplicateImageGenerationProvider(
                    { apiKey: replicate.apiKey },
                    m,
                );
        }
    }

    // ── Model map ───────────────────────────────────────────────────

    async #buildModelMap() {
        for (const providerName in this.#providers) {
            const provider = this.#providers[providerName];
            for (const model of await provider.models()) {
                model.id = model.id.trim().toLowerCase();
                if (!this.#modelIdMap[model.id]) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({
                    ...model,
                    provider: providerName,
                });

                if (model.puterId) {
                    model.aliases = model.aliases
                        ? [...model.aliases, model.puterId]
                        : [model.puterId];
                }
                if (model.aliases) {
                    for (let alias of model.aliases) {
                        alias = alias.trim().toLowerCase();
                        if (!this.#modelIdMap[alias]) {
                            this.#modelIdMap[alias] =
                                this.#modelIdMap[model.id];
                        } else if (
                            this.#modelIdMap[alias] !==
                            this.#modelIdMap[model.id]
                        ) {
                            this.#modelIdMap[alias].push({
                                ...model,
                                provider: providerName,
                            });
                            this.#modelIdMap[model.id] =
                                this.#modelIdMap[alias];
                        }
                    }
                }
            }
        }
    }

    #resolveModel(modelId: string, provider?: string): IImageModel | null {
        const models = this.#modelIdMap[modelId];
        if (!models || models.length === 0) return null;
        if (!provider) return models[0];
        return models.find((m) => m.provider === provider) ?? models[0];
    }
}
