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

import { assertImagePrompt } from './imageValidation.js';
import crypto from 'node:crypto';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { Actor } from '../../core/actor.js';
import { PuterDriver } from '../types.js';
import {
    type AiMeteringService,
    withAiCostFactor,
} from '../util/aiCostFactor.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import {
    resolveOutputPath,
    saveGeneratedMediaToFS,
} from '../util/generatedMedia.js';
import { ModelCatalog } from '../util/modelCatalog.js';
import { readProviderKey } from '../util/providerRegistry.js';
import { BytePlusImageProvider } from './providers/byteplus/BytePlusImageProvider.js';
import { CloudflareImageProvider } from './providers/cloudflare/CloudflareImageProvider.js';
import { GeminiImageProvider } from './providers/gemini/GeminiImageProvider.js';
import { OpenAiImageProvider } from './providers/openai/OpenAiImageProvider.js';
import { ReplicateImageGenerationProvider } from './providers/replicate/ReplicateImageGenerationProvider.js';
import { resolveImageSize } from './imageDimensions.js';
import { TogetherImageProvider } from './providers/together/TogetherImageProvider.js';
import { XAIImageProvider } from './providers/xai/XAIImageProvider.js';
import type { IGenerateParams, IImageModel, IImageProvider } from './types.js';
import { assertInputImagesShape } from './inputImage.js';

/**
 * Driver implementing the `puter-image-generation` interface.
 *
 * Manages multiple upstream providers and routes `generate()` calls based on
 * the requested model. Mirrors ChatCompletionDriver's pattern: providers are
 * instantiated from config on boot, a model map is built from each provider's
 * declared models, and calls are dispatched.
 *
 * Output is a URL string (web URL or data URI) — no streaming, no TypedValue
 * wrapper.
 */
export class ImageGenerationDriver extends PuterDriver {
    readonly driverInterface = 'puter-image-generation';
    readonly driverName = 'ai-image';
    // puter-js's `txt2img` falls through `options.driver` into the
    // driver-name slot (e.g. `xai-image-generation`), so alias all provider
    // ids here. `generate` falls back to `Context.driverName` when
    // `args.provider` isn't supplied.
    readonly driverAliases = [
        'openai-image-generation',
        'gemini-image-generation',
        'together-image-generation',
        'cloudflare-image-generation',
        'xai-image-generation',
        'replicate-image-generation',
        'byteplus-image-generation',
    ];
    readonly isDefault = true;

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    #providers: Record<string, IImageProvider> = Object.create(null);
    #modelIdMap: Record<string, IImageModel[]> = Object.create(null);
    #excludedModelIdMap: Record<string, IImageModel[]> = Object.create(null);
    #retiredModelAliases = new Map<
        string,
        { provider: string; reason?: string }
    >();
    #catalog = new ModelCatalog<IImageModel>([], [], 'aiImage');

    /** Metering scoped to this driver. Lazy: services wire up after drivers. */
    get #aiMetering(): AiMeteringService {
        return withAiCostFactor(
            this.services.metering,
            this.clients.event,
            this.driverName,
        );
    }

    override async onServerStart() {
        this.#registerProviders();
        await this.#buildModelMap();
        this.#catalog = new ModelCatalog(
            this.#listModels(),
            Object.values(this.#modelIdMap).flat(),
            'aiImage',
        );
    }

    async models(): Promise<IImageModel[]> {
        return this.#catalog.models;
    }

    async list(): Promise<string[]> {
        return this.#catalog.names;
    }

    #listModels(): IImageModel[] {
        const seen = new Set<string>();
        return Object.values(this.#modelIdMap)
            .flat()
            .filter((m) => {
                if (m.delisted) return false;
                const key = `${m.provider}:${m.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .map((model) => {
                if (!model.aliases) return model;
                // Advertise only aliases that reach this entry without a
                // provider hint; an alias another provider wins would route a
                // caller who picked it from this entry somewhere else.
                const aliases = model.aliases.filter((alias) => {
                    const resolved = this.#resolveModel(alias);
                    return (
                        resolved != null &&
                        resolved.provider === model.provider &&
                        resolved.id === model.id
                    );
                });
                return { ...model, aliases };
            })
            .sort((a, b) => {
                if (a.provider === b.provider) return a.id.localeCompare(b.id);
                return (a.provider ?? '').localeCompare(b.provider ?? '');
            });
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return this.#catalog.reportedCosts;
    }

    async generate(args: IGenerateParams): Promise<string> {
        const actor = Context.get('actor') as Actor | undefined;
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        // Every provider reads these off `args`, and several index into them
        // directly rather than through the shared helpers, so the shape is
        // settled here — once — before any provider runs.
        assertImagePrompt(args.prompt);
        assertInputImagesShape(args, 'image generation');
        for (const option of ['quality', 'resolution'] as const) {
            if (args[option] != null && typeof args[option] !== 'string') {
                throw new HttpError(400, `${option} must be a string`, {
                    legacyCode: 'bad_request',
                });
            }
        }

        // Providers and lifecycle listeners each get their own view: the
        // caller's `args` is re-emitted by reference in `.after`/`.error`
        // payloads, so it is never mutated here.
        const { puter_output_path: puterOutputPath, ...request } = args;

        // Validate the output path early — before spending credits.
        const resolvedOutputPath = puterOutputPath
            ? await resolveOutputPath(this.services, actor, puterOutputPath)
            : undefined;

        let modelId =
            typeof args.model === 'string'
                ? args.model.trim().toLowerCase()
                : undefined;
        const providerHint = args.provider ?? Context.get('driverName');
        let intendedProvider =
            typeof providerHint === 'string'
                ? providerHint.trim().toLowerCase()
                : undefined;
        if (intendedProvider === this.driverName) intendedProvider = undefined;
        if (
            intendedProvider &&
            !intendedProvider.endsWith('-image-generation')
        ) {
            intendedProvider += '-image-generation';
        }
        if (
            !modelId &&
            intendedProvider &&
            !this.#providers[intendedProvider]
        ) {
            throw new HttpError(
                400,
                `Image provider not available: ${providerHint}`,
                {
                    legacyCode: 'bad_request',
                },
            );
        }

        // Pick the first provider whose default model is available.
        if (!modelId && !intendedProvider) {
            intendedProvider = Object.keys(this.#providers).find((name) => {
                const defaultModel = this.#providers[name].getDefaultModel();
                return (
                    this.#resolveModel(defaultModel, name)?.provider === name
                );
            });
        }
        if (!modelId && intendedProvider) {
            modelId = this.#providers[intendedProvider]
                ?.getDefaultModel()
                .trim()
                .toLowerCase();
        }
        if (!modelId)
            throw new HttpError(400, 'Missing `model`', {
                legacyCode: 'bad_request',
            });

        const excludedModels =
            this.#excludedModelIdMap[modelId.trim().toLowerCase()] ?? [];
        const dataPolicyError = (excluded: IImageModel) =>
            new HttpError(
                400,
                `Image model excluded by data policy: ${excluded.id} (${excluded.excludedForDataPolicy === 'training' ? 'training on customer content' : 'required third-party data sharing'}).`,
                { legacyCode: 'bad_request' },
            );
        // A hinted provider answers for its own excluded route, even when
        // another provider retired the same bare name.
        const hintedExcludedModel = excludedModels.find(
            (entry) => entry.provider === intendedProvider,
        );
        if (hintedExcludedModel) throw dataPolicyError(hintedExcludedModel);

        // Retired aliases are never registered in the model map, so this gate
        // mostly turns "Model not found" into a message that names the
        // provider; it also keeps a retired name from reaching a provider
        // whose exact id happens to spell the same thing.
        const retired = this.#retiredModelAliases.get(modelId);
        if (retired) {
            throw new HttpError(
                400,
                `${args.model ?? modelId} is no longer available through ${retired.provider}; ${retired.reason ?? 'choose an available model.'}`,
                {
                    legacyCode: 'bad_request',
                },
            );
        }

        const model = this.#resolveModel(modelId, intendedProvider);
        if (!model && excludedModels[0])
            throw dataPolicyError(excludedModels[0]);
        if (!model) {
            throw new HttpError(400, `Model not found: ${args.model}`, {
                legacyCode: 'bad_request',
            });
        }

        const provider = this.#providers[model.provider!];
        if (!provider) {
            throw new HttpError(
                500,
                `No provider found for model ${model.id}`,
                { legacyCode: 'internal_error' },
            );
        }

        // Every caller-facing size field collapses into `imageSize`; the
        // `ratio` mirror carries plain dimensions for providers that need no
        // aspect-versus-pixels intent.
        const imageSize = resolveImageSize(request, model);
        delete request.width;
        delete request.height;
        delete request.aspect_ratio;
        delete request.ratio;
        delete request.imageSize;
        if (imageSize) {
            request.imageSize = imageSize;
            request.ratio = { w: imageSize.w, h: imageSize.h };
        }
        request.model = model.id;
        request.provider = model.provider;

        // Audit log for abuse / billing. Fired before the upstream call
        // so a failed generate still shows up in the log (prompt_block
        // uses this to track user-by-user image prompts). Logs the
        // normalized request so the row records the resolved model and size.
        const completionId = crypto.randomUUID();
        this.clients.event.emit(
            'ai.log.image',
            {
                actor,
                completionId,
                parameters: request,
                intended_service: model.id,
                model_used: model.id,
                service_used: model.provider!,
            },
            {},
        );

        const result = await provider.generate(request);

        if (resolvedOutputPath) {
            await saveGeneratedMediaToFS(
                this.services.fs,
                actor,
                result,
                resolvedOutputPath,
                { noun: 'image', defaultType: 'application/octet-stream' },
            );
        }

        return result;
    }

    #registerProviders() {
        const providers = this.config.providers ?? {};
        const m = this.#aiMetering;

        const openaiKey = readProviderKey(
            providers['openai-image-generation'],
            providers['openai-completion'],
            providers['openai'],
        );
        if (openaiKey) {
            this.#providers['openai-image-generation'] =
                new OpenAiImageProvider({ apiKey: openaiKey }, m);
        }

        const geminiKey = readProviderKey(
            providers['gemini-image-generation'],
            providers['gemini'],
        );
        if (geminiKey) {
            this.#providers['gemini-image-generation'] =
                new GeminiImageProvider({ apiKey: geminiKey }, m);
        }

        const togetherKey = readProviderKey(
            providers['together-image-generation'],
            providers['together-ai'],
        );
        if (togetherKey) {
            this.#providers['together-image-generation'] =
                new TogetherImageProvider({ apiKey: togetherKey }, m);
        }

        const cloudflare = (providers['cloudflare-image-generation'] ??
            providers['cloudflare-workers-ai-image'] ??
            providers['cloudflare-workers-ai']) as
            Record<string, unknown> | undefined;
        const cfToken =
            (cloudflare?.apiToken as string | undefined) ??
            readProviderKey(cloudflare);
        const cfAccount =
            (cloudflare?.accountId as string | undefined) ??
            (cloudflare?.account_id as string | undefined);
        if (cfToken && cfAccount) {
            this.#providers['cloudflare-image-generation'] =
                new CloudflareImageProvider(
                    {
                        apiToken: cfToken,
                        accountId: cfAccount,
                        apiBaseUrl: cloudflare?.apiBaseUrl as
                            string | undefined,
                    },
                    m,
                );
        }

        const xaiKey = readProviderKey(
            providers['xai-image-generation'],
            providers['xai'],
        );
        if (xaiKey) {
            this.#providers['xai-image-generation'] = new XAIImageProvider(
                { apiKey: xaiKey },
                m,
            );
        }

        const replicateKey = readProviderKey(
            providers['replicate-image-generation'],
        );
        if (replicateKey) {
            this.#providers['replicate-image-generation'] =
                new ReplicateImageGenerationProvider(
                    { apiKey: replicateKey },
                    m,
                );
        }

        // Falls back to the shared `byteplus` (ai-chat) key; `apiBaseUrl`
        // selects the ModelArk region, same as the chat provider. Each field
        // falls through independently so a partial image-specific block can't
        // pair its missing apiBaseUrl with the shared block's key (or vice
        // versa) and point a region-scoped key at the wrong endpoint.
        const byteplusImageCfg = providers['byteplus-image-generation'] as
            Record<string, unknown> | undefined;
        const byteplusSharedCfg = providers['byteplus'] as
            Record<string, unknown> | undefined;
        const byteplusKey = readProviderKey(
            byteplusImageCfg,
            byteplusSharedCfg,
        );
        if (byteplusKey) {
            this.#providers['byteplus-image-generation'] =
                new BytePlusImageProvider(
                    {
                        apiKey: byteplusKey,
                        apiBaseUrl: (byteplusImageCfg?.apiBaseUrl ??
                            byteplusSharedCfg?.apiBaseUrl) as
                            string | undefined,
                    },
                    m,
                );
        }
    }

    async #buildModelMap() {
        this.#modelIdMap = Object.create(null);
        this.#excludedModelIdMap = Object.create(null);
        this.#retiredModelAliases.clear();
        const models: IImageModel[] = [];
        for (const [providerName, provider] of Object.entries(
            this.#providers,
        )) {
            for (const alias of provider.retiredModelAliases ?? []) {
                this.#retiredModelAliases.set(alias.trim().toLowerCase(), {
                    provider: providerName,
                    reason: provider.retiredModelReasons?.[alias],
                });
            }
            for (const entry of await provider.models()) {
                models.push({ ...entry, provider: providerName });
            }
        }

        const register = (id: string, model: IImageModel) => {
            const key = id.trim().toLowerCase();
            const modelMap = model.excludedForDataPolicy
                ? this.#excludedModelIdMap
                : this.#modelIdMap;
            const bucket = (modelMap[key] ??= []);
            if (
                !bucket.some(
                    (entry) =>
                        entry.id === model.id &&
                        entry.provider === model.provider,
                )
            ) {
                bucket.push(model);
            }
        };
        // Exact IDs take precedence over another provider's shorthand aliases.
        // A puterId minus its provider prefix (`openai:openai/x` → `openai/x`)
        // is that provider's own spelling as well, so a reseller's exact id
        // never outranks it; ties keep provider registration order.
        const retired = (name: string) =>
            this.#retiredModelAliases.has(name.trim().toLowerCase());
        for (const model of models) {
            register(model.id, model);
            if (!model.puterId) continue;
            register(model.puterId, model);
            const ownSpelling = model.puterId.replace(/^[^:/]+:/, '');
            if (model.excludedForDataPolicy || !retired(ownSpelling))
                register(ownSpelling, model);
        }
        for (const model of models) {
            for (const alias of model.aliases ?? []) {
                // A retired name never routes anywhere, whichever catalog
                // still spells it, so the gate in generate() cannot depend on
                // which providers a deployment configures. Excluded routes
                // never route either, so they keep the alias for their error.
                if (
                    !model.excludedForDataPolicy &&
                    this.#retiredModelAliases.has(alias.trim().toLowerCase())
                )
                    continue;
                register(alias, model);
            }
        }
    }

    #resolveModel(modelId: string, provider?: string): IImageModel | null {
        const models = this.#modelIdMap[modelId.trim().toLowerCase()];
        if (!models || models.length === 0) return null;
        if (!provider) return models[0];
        return models.find((m) => m.provider === provider) ?? models[0];
    }
}
