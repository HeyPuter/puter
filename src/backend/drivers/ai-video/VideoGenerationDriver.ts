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
import { usesGoogleGeminiEndpoint } from '../util/geminiRest.js';
import {
    dataUriByteLength,
    MAX_INLINE_VIDEO_BYTES,
    readPuterImageInputs,
} from '../util/mediaInput.js';
import { ModelCatalog } from '../util/modelCatalog.js';
import { readProviderKey } from '../util/providerRegistry.js';
import { BytePlusVideoProvider } from './providers/byteplus/BytePlusVideoProvider.js';
import { GeminiVideoProvider } from './providers/gemini/GeminiVideoProvider.js';
import { KlingVideoProvider } from './providers/kling/KlingVideoProvider.js';
import { MiniMaxVideoProvider } from './providers/minimax/MiniMaxVideoProvider.js';
import { TogetherVideoProvider } from './providers/together/TogetherVideoProvider.js';
import type {
    IGenerateVideoParams,
    IVideoModel,
    IVideoProvider,
} from './types.js';

const DEFAULT_PROVIDER = 'together-video-generation';

/** A resolution tier such as `720p`, `2k` or `4k`, as opposed to pixels. */
const isResolutionTier = (value: string): boolean =>
    /^(\d{3,4}p|\dk)$/i.test(value);

const parsePixelSize = (
    value: string | undefined,
): { width: number; height: number } | undefined => {
    const match = value?.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (!match) return undefined;
    const width = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[2], 10);
    return width > 0 && height > 0 ? { width, height } : undefined;
};

/** Resolution tier of the shorter side, e.g. 1920x1080 and 1080x1920 → 1080p. */
const tierForPixels = (
    { width, height }: { width: number; height: number },
    dimensions: readonly string[],
) => {
    const shortSide = Math.min(width, height);
    const exactTier = dimensions.find(
        (tier) => tier.toLowerCase() === `${shortSide}p`,
    );
    if (exactTier) return exactTier;
    if (shortSide <= 480) return '480p';
    if (shortSide <= 720) return '720p';
    if (shortSide <= 1080) return '1080p';
    return '4k';
};

/**
 * Driver implementing the `puter-video-generation` interface.
 *
 * Manages multiple upstream providers (Together, BytePlus/Seedance, Gemini,
 * Kling, MiniMax) and handles model resolution, provider routing, and parameter
 * normalisation. Each provider is a plain `IVideoProvider` -- the driver
 * instantiates them from config on boot.
 *
 * Providers handle their own metering internally.
 */
export class VideoGenerationDriver extends PuterDriver {
    readonly driverInterface = 'puter-video-generation';
    readonly driverName = 'ai-video';
    // puter-js's `txt2vid` can pass a provider id via `options.driver`, so
    // alias all provider ids here. `generate` falls back to
    // `Context.driverName` when `args.provider` isn't supplied.
    readonly driverAliases = [
        'together-video-generation',
        'byteplus-video-generation',
        'gemini-video-generation',
        'kling-video-generation',
        'minimax-video-generation',
    ];
    readonly isDefault = true;

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    #providers: Record<string, IVideoProvider> = Object.create(null);
    #modelIdMap: Record<string, IVideoModel[]> = Object.create(null);
    #catalog = new ModelCatalog<IVideoModel>([], [], 'aiVideo');

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
            'aiVideo',
        );
    }

    // -- Interface methods ---------------------------------------------------

    async models(): Promise<IVideoModel[]> {
        return this.#catalog.models;
    }

    async list(): Promise<string[]> {
        return this.#catalog.names;
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return this.#catalog.reportedCosts;
    }

    #listModels(): IVideoModel[] {
        const seen = new Set<string>();
        return Object.values(this.#modelIdMap)
            .flat()
            .filter((model) => {
                const identity = `${model.provider}:${model.puterId || model.id}`;
                if (seen.has(identity)) return false;
                seen.add(identity);
                return true;
            })
            .sort((a, b) => {
                if (a.provider === b.provider) return a.id.localeCompare(b.id);
                return a.provider!.localeCompare(b.provider!);
            });
    }

    async generate(args: IGenerateVideoParams) {
        const actor = Context.get('actor') as Actor | undefined;
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        // Normalized on a copy: lifecycle listeners get the caller's `args`
        // by reference in their `.after`/`.error` payloads.
        const { puter_output_path: puterOutputPath, ...request } = args;

        // Validate the output path early — before spending credits.
        const resolvedOutputPath = puterOutputPath
            ? await resolveOutputPath(this.services, actor, puterOutputPath)
            : undefined;

        if (request.model) {
            request.model = request.model.trim().toLowerCase();
        }

        const configuredProviders = Object.keys(this.#providers);
        if (configuredProviders.length === 0) {
            throw new Error('no video generation providers configured');
        }

        // The generic `ai-video` driver name is not a provider, so requests
        // that name no usable provider land on the default rather than on
        // whichever provider happened to register first.
        const fallbackProvider = configuredProviders.includes(DEFAULT_PROVIDER)
            ? DEFAULT_PROVIDER
            : configuredProviders[0];

        let intendedProvider =
            request.provider ??
            (Context.get('driverName') as string | undefined) ??
            '';

        if (!request.model && !intendedProvider) {
            intendedProvider = fallbackProvider;
        }

        if (intendedProvider && !this.#providers[intendedProvider]) {
            if (intendedProvider === 'gemini-video-generation') {
                throw new HttpError(
                    400,
                    'Gemini video generation is not configured',
                    {
                        legacyCode: 'bad_request',
                    },
                );
            }
            intendedProvider = fallbackProvider;
        }

        if (!request.model && intendedProvider) {
            request.model = this.#providers[intendedProvider].getDefaultModel();
        }

        const model = request.model
            ? this.#resolveModel(request.model, intendedProvider)
            : undefined;

        if (!model) {
            throw new HttpError(400, `Model not found: ${request.model}`, {
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

        // Providers ignore options they don't know, so a source video sent to
        // a model that can't edit would be dropped and the clip still billed.
        if (request.input_video != null && !model.videoInput) {
            throw new HttpError(
                400,
                `${model.id} does not accept a source video`,
                { legacyCode: 'bad_request' },
            );
        }
        // A larger video comes as a URL or a Puter file, so it is never
        // parsed out of the request body or held as one string.
        if (
            typeof request.input_video === 'string' &&
            request.input_video.startsWith('data:') &&
            dataUriByteLength(request.input_video) > MAX_INLINE_VIDEO_BYTES
        ) {
            throw new HttpError(
                413,
                `A data URI input_video can be at most ${MAX_INLINE_VIDEO_BYTES} bytes; pass a URL or Puter file path instead`,
                { legacyCode: 'input_too_large' },
            );
        }

        // Validate / normalise duration
        if (model.durationSeconds?.length) {
            const requestedSeconds = request.seconds ?? request.duration;
            const normalizedSeconds =
                typeof requestedSeconds === 'string'
                    ? Number.parseInt(requestedSeconds, 10)
                    : requestedSeconds;
            const validSeconds = model.durationSeconds.includes(
                Number(normalizedSeconds),
            )
                ? normalizedSeconds
                : model.durationSeconds[0];
            request.seconds = validSeconds;
            request.duration = validSeconds;
        }

        // Validate / normalise dimensions
        if (model.dimensions?.length) {
            const requestedResolution =
                typeof request.size === 'string' && request.size.trim()
                    ? request.size.trim()
                    : typeof request.resolution === 'string' &&
                        request.resolution.trim()
                      ? request.resolution.trim()
                      : undefined;
            const requestedPixels = parsePixelSize(requestedResolution);

            // `WIDTHxHEIGHT` is the one size vocabulary callers can use with
            // every provider. Tier-based catalogs ('720p') take the tier of
            // the shorter side; width/height then carry the aspect ratio for
            // providers that derive one, or the exact size for providers that
            // take pixels.
            const catalogIsTiers = model.dimensions.every(isResolutionTier);
            const wanted =
                catalogIsTiers && requestedPixels
                    ? tierForPixels(requestedPixels, model.dimensions)
                    : requestedResolution;

            // Case-insensitive so '4K' matches a catalog entry spelled '4k';
            // the matched catalog spelling (not the caller's) is forwarded.
            const normalizedResolution =
                (wanted &&
                    model.dimensions.find(
                        (d) => d.toLowerCase() === wanted.toLowerCase(),
                    )) ||
                model.dimensions[0];
            request.size = normalizedResolution;
            request.resolution = normalizedResolution;

            if (
                requestedPixels &&
                request.width == null &&
                request.height == null
            ) {
                const pixels = catalogIsTiers
                    ? requestedPixels
                    : parsePixelSize(normalizedResolution);
                if (pixels) {
                    request.width = pixels.width;
                    request.height = pixels.height;
                }
            }
        }

        const result = await provider.generate({
            ...(request.test_mode
                ? request
                : await this.#withPuterImagesInlined(actor, request)),
            model: model.id,
            provider: model.provider,
        });

        if (resolvedOutputPath) {
            await saveGeneratedMediaToFS(
                this.services.fs,
                actor,
                result,
                resolvedOutputPath,
                { noun: 'video', defaultType: 'video/mp4' },
            );
        }

        return result;
    }

    /**
     * `request` with image inputs given as Puter file paths read within the
     * caller's access and replaced by data URIs. `request` is left as is.
     */
    async #withPuterImagesInlined(
        actor: Actor,
        request: IGenerateVideoParams,
    ): Promise<IGenerateVideoParams> {
        const references = Array.isArray(request.reference_images)
            ? request.reference_images
            : undefined;
        const frames = Array.isArray(request.frame_images)
            ? request.frame_images
            : undefined;
        const frameImage = (frame: object): unknown =>
            frame && typeof frame === 'object'
                ? (frame as { input_image?: unknown }).input_image
                : undefined;

        const inlined = await readPuterImageInputs(
            { stores: this.stores, fs: this.services.fs },
            actor,
            [
                request.input_reference,
                request.last_frame,
                ...(references ?? []),
                ...(frames ?? []).map(frameImage),
            ],
        );
        if (inlined.size === 0) return request;

        const swap = <T>(value: T): T | string =>
            (typeof value === 'string' && inlined.get(value)) || value;
        return {
            ...request,
            ...(request.input_reference != null && {
                input_reference: swap(request.input_reference),
            }),
            ...(request.last_frame && { last_frame: swap(request.last_frame) }),
            ...(references && { reference_images: references.map(swap) }),
            ...(frames && {
                frame_images: frames.map((frame) => {
                    const image = frameImage(frame);
                    return typeof image === 'string' && inlined.has(image)
                        ? { ...frame, input_image: inlined.get(image) }
                        : frame;
                }),
            }),
        };
    }

    // -- Provider registration -----------------------------------------------

    #registerProviders() {
        const providers = this.config.providers ?? {};
        const m = this.#aiMetering;

        // Falls back from the video-specific provider key to the shared chat
        // key when unset.
        const togetherKey = readProviderKey(
            providers['together-video-generation'],
            providers['together-ai'],
        );
        if (togetherKey) {
            this.#providers['together-video-generation'] =
                new TogetherVideoProvider({ apiKey: togetherKey }, m, {
                    stores: this.stores,
                    fs: this.services.fs,
                });
        }

        // Falls back to the shared `byteplus` (ai-chat) key; `apiBaseUrl`
        // selects the ModelArk region, same as the chat provider. Each field
        // falls through independently so a partial video-specific block can't
        // pair its missing apiBaseUrl with the shared block's key (or vice
        // versa) and point a region-scoped key at the wrong endpoint.
        const byteplusVideoCfg = providers['byteplus-video-generation'] as
            Record<string, unknown> | undefined;
        const byteplusSharedCfg = providers['byteplus'] as
            Record<string, unknown> | undefined;
        const byteplusKey = readProviderKey(
            byteplusVideoCfg,
            byteplusSharedCfg,
        );
        if (byteplusKey) {
            this.#providers['byteplus-video-generation'] =
                new BytePlusVideoProvider(
                    {
                        apiKey: byteplusKey,
                        apiBaseUrl: (byteplusVideoCfg?.apiBaseUrl ??
                            byteplusSharedCfg?.apiBaseUrl) as
                            string | undefined,
                    },
                    m,
                );
        }

        // Shares the chat provider's `gemini` key. A custom `apiBaseUrl` is a
        // proxy for chat only, so its key is never sent to Google directly.
        const geminiKey = readProviderKey(providers['gemini']);
        if (
            geminiKey &&
            usesGoogleGeminiEndpoint(providers['gemini']?.apiBaseUrl)
        ) {
            this.#providers['gemini-video-generation'] =
                new GeminiVideoProvider(
                    { apiKey: geminiKey },
                    { stores: this.stores, fs: this.services.fs, metering: m },
                );
        }

        // One `kling` key covers video, image and TTS.
        const klingCfg = (providers['kling-video-generation'] ??
            providers['kling']) as Record<string, unknown> | undefined;
        const klingKey = readProviderKey(klingCfg);
        if (klingKey) {
            this.#providers['kling-video-generation'] = new KlingVideoProvider(
                {
                    apiKey: klingKey,
                    apiBaseUrl: klingCfg?.apiBaseUrl as string | undefined,
                },
                m,
                { stores: this.stores, fs: this.services.fs },
            );
        }

        // Falls back to the shared `minimax` (ai-chat) key. The chat block's
        // `apiBaseUrl` names the chat API under `/v1`; the provider keeps its
        // host, since the video API lives beside it.
        const minimaxVideoCfg = providers['minimax-video-generation'] as
            Record<string, unknown> | undefined;
        const minimaxSharedCfg = providers['minimax'] as
            Record<string, unknown> | undefined;
        const minimaxKey = readProviderKey(minimaxVideoCfg, minimaxSharedCfg);
        if (minimaxKey) {
            this.#providers['minimax-video-generation'] =
                new MiniMaxVideoProvider(
                    {
                        apiKey: minimaxKey,
                        apiBaseUrl: (minimaxVideoCfg?.apiBaseUrl ??
                            minimaxSharedCfg?.apiBaseUrl) as string | undefined,
                    },
                    m,
                );
        }
    }

    // -- Model map -----------------------------------------------------------

    async #buildModelMap() {
        for (const providerName in this.#providers) {
            const provider = this.#providers[providerName];
            for (const entry of await provider.models()) {
                // Catalogs are module-level constants that providers hand
                // back by reference, so they are read and never written:
                // normalizing fields or appending puterId in place would
                // accumulate across map builds. Work on a copy instead —
                // every alias write below lands on an array created here.
                const model = { ...entry };
                model.id = model.id.trim().toLowerCase();
                if (model.puterId) {
                    model.puterId = model.puterId.trim().toLowerCase();
                }
                if (model.aliases) {
                    model.aliases = model.aliases.map((alias) =>
                        alias.trim().toLowerCase(),
                    );
                }
                if (!this.#modelIdMap[model.id]) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({
                    ...model,
                    provider: providerName,
                });

                if (model.puterId) {
                    if (model.aliases) {
                        model.aliases.push(model.puterId);
                    } else {
                        model.aliases = [model.puterId];
                    }

                    // Derive standard alias forms from puterId for model singularity:
                    // puterId "service:org/model" -> "org/model" and "model"
                    const withoutService = model.puterId.includes(':')
                        ? model.puterId.slice(model.puterId.indexOf(':') + 1)
                        : model.puterId;
                    if (!model.aliases.includes(withoutService)) {
                        model.aliases.push(withoutService);
                    }
                    const shortName = withoutService.includes('/')
                        ? withoutService.slice(withoutService.indexOf('/') + 1)
                        : withoutService;
                    if (
                        shortName !== withoutService &&
                        !model.aliases.includes(shortName)
                    ) {
                        model.aliases.push(shortName);
                    }
                }

                if (model.aliases) {
                    for (let alias of model.aliases) {
                        alias = alias.trim().toLowerCase();
                        if (!this.#modelIdMap[alias]) {
                            this.#modelIdMap[alias] =
                                this.#modelIdMap[model.id];
                            continue;
                        }
                        if (
                            this.#modelIdMap[alias] !==
                            this.#modelIdMap[model.id]
                        ) {
                            this.#modelIdMap[alias].push({
                                ...model,
                                provider: providerName,
                            });
                            this.#modelIdMap[model.id] =
                                this.#modelIdMap[alias];
                            continue;
                        }
                    }
                }

                // Sort: cheapest first
                this.#modelIdMap[model.id].sort((a, b) => {
                    const aCostKey =
                        a.index_cost_key ||
                        a.output_cost_key ||
                        Object.keys(a.costs || {})[0];
                    const bCostKey =
                        b.index_cost_key ||
                        b.output_cost_key ||
                        Object.keys(b.costs || {})[0];
                    const aCost = a.costs?.[aCostKey] ?? Infinity;
                    const bCost = b.costs?.[bCostKey] ?? Infinity;
                    return aCost - bCost;
                });
            }
        }
    }

    #resolveModel(modelId: string, provider?: string): IVideoModel | null {
        const models = this.#modelIdMap[modelId?.trim().toLowerCase()];
        if (!models || models.length === 0) return null;
        if (!provider) return models[0];

        // Prefer exact primary ID match over alias matches
        const exactIdMatch = models.find(
            (m) => m.id === modelId && m.provider === provider,
        );
        if (exactIdMatch) return exactIdMatch;

        const exactPuterIdMatch = models.find(
            (m) => m.puterId === modelId && m.provider === provider,
        );
        if (exactPuterIdMatch) return exactPuterIdMatch;

        return (
            models.find((m) => m.provider === provider) ??
            (provider === 'gemini-video-generation' ? null : models[0])
        );
    }
}
