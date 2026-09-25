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

import { assertImagePrompt } from '../../imageValidation.js';
import Replicate from 'replicate';
import { formatAspectRatio } from '../../imageDimensions.js';
import {
    parseDataUri,
    resolveSingleInputImage,
    toUrlOrDataUri,
} from '../../inputImage.js';
import sharp from 'sharp';
import type { Actor } from '../../../../core/actor.js';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { secureFetch } from '../../../../util/secureHttp.js';
import type { IGenerateParams, IImageProvider } from '../../types.js';
import {
    REPLICATE_IMAGE_GENERATION_MODELS,
    type ReplicateImageModel,
} from './models.js';
import {
    buildCatalogInput,
    catalogImageInputs,
    catalogOutputMegapixels,
    catalogCostComponents,
} from './catalogRequest.js';
import {
    CONTENT_FILTER_PATTERN,
    isUpstreamTimeoutError,
    sanitizeUpstreamMessage,
} from '../../../util/upstreamErrors.js';

const DEFAULT_MODEL = 'black-forest-labs/flux-schnell';
const DEFAULT_RATIO = { w: 1024, h: 1024 };

const PREDICTION_WINDOW_MS = 10 * 60 * 1000;
const CLEANUP_WINDOW_MS = 30_000;

// Input images are caller-supplied URLs fetched before the credit gate can
// price them, so the fan-out is bounded in count, concurrency, bytes and time.
const MAX_INPUT_IMAGES = 10;
const INPUT_MEASURE_CONCURRENCY = 4;
const INPUT_MEASURE_MAX_BYTES = 30 * 1024 * 1024;
const INPUT_MEASURE_TIMEOUT_MS = 30_000;

const PREDICTION_FAILED_PREFIX = 'Prediction failed:';

/** Buffer a response body, refusing to hold more than `maxBytes` of it. */
async function readBounded(
    response: Response,
    maxBytes: number,
): Promise<Buffer> {
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new HttpError(400, `Input image exceeds ${maxBytes} bytes`, {
                legacyCode: 'bad_request',
                code: 'input_too_large',
            });
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

function hasUpstreamStatus(err: unknown): boolean {
    const e = err as {
        status?: unknown;
        statusCode?: unknown;
        response?: { status?: unknown };
    };
    return (
        typeof e.status === 'number' ||
        typeof e.statusCode === 'number' ||
        typeof e.response?.status === 'number'
    );
}

export class ReplicateImageGenerationProvider implements IImageProvider {
    static readonly #CORE_PARAMS: readonly string[] = [
        'prompt',
        'model',
        'ratio',
        'imageSize',
        'quality',
        'provider',
        'test_mode',
        'input_image',
        'input_image_mime_type',
        'input_images',
    ];

    #client: Replicate;
    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        if (!config.apiKey) {
            throw new Error('Replicate image generation requires an API key');
        }
        // The SDK replays any thrown fetch error up to six times with the same
        // init object, POSTs included. A create that timed out may already
        // have started a billable prediction, so its failure is replayed to
        // the retry loop instead of the request being sent again.
        const failedCreates = new WeakMap<object, unknown>();
        this.#client = new Replicate({
            auth: config.apiKey,
            fetch: async (url, options) => {
                const headers = new Headers(options?.headers);
                const creating =
                    options?.method === 'POST' &&
                    String(url).endsWith('/predictions');
                if (creating && options && failedCreates.has(options)) {
                    throw failedCreates.get(options);
                }
                if (creating)
                    headers.set(
                        'Cancel-After',
                        `${PREDICTION_WINDOW_MS / 1000}s`,
                    );
                const timeout = AbortSignal.timeout(creating ? 90_000 : 30_000);
                try {
                    return await fetch(url, {
                        ...options,
                        headers,
                        signal: options?.signal
                            ? AbortSignal.any([options.signal, timeout])
                            : timeout,
                    });
                } catch (error) {
                    if (creating && options) failedCreates.set(options, error);
                    throw error;
                }
            },
        });
        this.#meteringService = meteringService;
    }

    // Read at construction so the catalog is consulted per instance.
    #unavailable = REPLICATE_IMAGE_GENERATION_MODELS.filter(
        (model) => model.unavailableReason,
    ).flatMap((model) =>
        [model.id, model.puterId!, ...(model.aliases ?? [])].map(
            (name) => [name, model.unavailableReason!] as const,
        ),
    );

    readonly retiredModelAliases = this.#unavailable.map(([name]) => name);

    readonly retiredModelReasons: Readonly<Record<string, string>> =
        Object.fromEntries(this.#unavailable);

    models() {
        return REPLICATE_IMAGE_GENERATION_MODELS.filter(
            (model) => !model.unavailableReason,
        );
    }

    getDefaultModel(): string {
        return DEFAULT_MODEL;
    }

    async generate(params: IGenerateParams): Promise<string> {
        const { prompt, test_mode } = params;

        const selectedModel = this.#getModel(params.model);
        const ratio = this.#normalizeRatio(params.ratio);

        if (test_mode) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        assertImagePrompt(prompt);
        const catalogInput = selectedModel.inputSchema
            ? buildCatalogInput(selectedModel, params)
            : undefined;

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'actor not found in context', {
                legacyCode: 'unauthorized',
            });
        }

        const signal = Context.get('abortSignal') as AbortSignal | undefined;
        const aborted = () =>
            new HttpError(400, 'Image generation request aborted', {
                legacyCode: 'client_aborted',
            });
        if (signal?.aborted) throw aborted();

        const filtered = this.#filterAllowedParams(params, selectedModel);
        const aliased = this.#applyParamAliases(filtered, selectedModel);
        const transformed = this.#applyTransforms(aliased, selectedModel);

        const goFast = !!transformed.go_fast;
        const generationMode =
            typeof transformed.generation_mode === 'string'
                ? transformed.generation_mode
                : undefined;

        const inputImages: string[] = [];
        if (selectedModel.imageInputKey) {
            if (params.input_image) inputImages.push(params.input_image);
            if (params.input_images?.length)
                inputImages.push(...params.input_images);
            if (inputImages.length === 0) {
                const nativeVal = (params as Record<string, unknown>)[
                    selectedModel.imageInputKey
                ];
                if (typeof nativeVal === 'string') {
                    inputImages.push(nativeVal);
                } else if (Array.isArray(nativeVal)) {
                    for (const v of nativeVal) {
                        if (typeof v === 'string') inputImages.push(v);
                    }
                }
            }
        }
        let singleImage: string | undefined;
        if (selectedModel.singleImageInputKey) {
            singleImage = resolveSingleInputImage(params, 'Replicate');
            if (!singleImage) {
                const nativeVal = (params as Record<string, unknown>)[
                    selectedModel.singleImageInputKey
                ];
                if (typeof nativeVal === 'string') singleImage = nativeVal;
            }
        }
        for (let index = 0; index < inputImages.length; index++) {
            inputImages[index] = toUrlOrDataUri(
                inputImages[index],
                params.input_image_mime_type,
            );
        }
        if (singleImage)
            singleImage = toUrlOrDataUri(
                singleImage,
                params.input_image_mime_type,
            );
        const allInputUrls = catalogInput
            ? catalogImageInputs(catalogInput)
            : singleImage
              ? [singleImage]
              : inputImages;
        if (allInputUrls.length > MAX_INPUT_IMAGES) {
            throw new HttpError(
                400,
                `Replicate accepts at most ${MAX_INPUT_IMAGES} input images`,
                { legacyCode: 'bad_request' },
            );
        }

        // A megapixel hint the model cannot take never reaches Replicate, so
        // it must not inflate the estimate either.
        const forwardsMegapixels =
            selectedModel.allowed_params?.includes('output_megapixels') ?? true;
        const outputMp = catalogInput
            ? catalogOutputMegapixels(catalogInput)
            : this.#resolveOutputMegapixels(
                  forwardsMegapixels
                      ? (params.output_megapixels as string | undefined)
                      : undefined,
              );

        const assertCredits = async (inputMegapixels: number) => {
            const totalCostMicroCents = catalogInput
                ? catalogCostComponents(selectedModel, catalogInput, {
                      inputMp: inputMegapixels,
                      outputMp,
                      seconds: 60,
                  }).reduce((sum, component) => sum + component.costOverride, 0)
                : this.#estimateCost(
                      selectedModel,
                      outputMp,
                      goFast,
                      inputMegapixels,
                      generationMode,
                  );
            if (totalCostMicroCents <= 0) {
                throw new HttpError(
                    400,
                    `Error calculating cost for Replicate model ${selectedModel.id}`,
                    { legacyCode: 'unknown_error' },
                );
            }
            const usageAllowed = await this.#meteringService.hasEnoughCredits(
                actor,
                totalCostMicroCents,
            );
            if (!usageAllowed) {
                throw new HttpError(
                    402,
                    'Insufficient credits for image generation',
                    {
                        legacyCode: 'insufficient_funds',
                    },
                );
            }
        };
        // Measuring input images fetches caller-supplied URLs, so the credit
        // gate runs on the output-only estimate before any of that I/O and
        // again once the input surcharge is known.
        await assertCredits(0);
        const inputMp =
            allInputUrls.length > 0
                ? await this.#measureInputMegapixels(
                      allInputUrls,
                      !catalogInput,
                  )
                : 0;
        if (inputMp > 0) await assertCredits(inputMp);

        const input =
            catalogInput ??
            this.#buildRequest(selectedModel, {
                prompt,
                ratio,
                transformed,
                inputImages,
                singleImage,
            });

        const deadline = Date.now() + PREDICTION_WINDOW_MS;
        const expired = () => Date.now() >= deadline;
        const timeout = () =>
            new HttpError(
                504,
                'Timed out waiting for Replicate image generation',
                {
                    legacyCode: 'upstream_timeout',
                    fields: { provider: 'replicate' },
                },
            );
        let interrupted: unknown;
        let output: unknown;
        let predictionSeconds: number | undefined;
        try {
            // Keep the creation response so a disconnect cannot discard the ID needed to cancel.
            let prediction = await this.#client.predictions.create({
                ...(selectedModel.replicateVersion
                    ? { version: selectedModel.replicateVersion }
                    : {
                          model: selectedModel.replicateId as `${string}/${string}`,
                      }),
                input,
                wait: 60,
            });
            const pending = () =>
                prediction.status === 'starting' ||
                prediction.status === 'processing';
            if (pending() && !signal?.aborted && !expired()) {
                try {
                    prediction = await this.#client.wait(
                        prediction,
                        { interval: 2000 },
                        async (current) =>
                            signal?.aborted ||
                            expired() ||
                            !['starting', 'processing'].includes(
                                current.status,
                            ),
                    );
                } catch (error) {
                    // Only our own abort or deadline is an interruption worth
                    // cancelling for. A poll failure or the SDK's "Prediction
                    // failed" throw is the prediction's real outcome: it must
                    // not cancel a healthy run or bill a stale one.
                    if (!signal?.aborted && !expired()) throw error;
                }
            }
            if (signal?.aborted) interrupted = aborted();
            else if (expired()) interrupted = timeout();
            if (interrupted && pending()) {
                try {
                    prediction = await this.#client.predictions.cancel(
                        prediction.id,
                    );
                } catch {
                    // Recheck briefly for a completed result; the upstream deadline bounds remaining work.
                }
                if (pending()) {
                    const cleanupDeadline = Date.now() + CLEANUP_WINDOW_MS;
                    prediction = await this.#client.wait(
                        prediction,
                        { interval: 2000 },
                        async (current) =>
                            Date.now() >= cleanupDeadline ||
                            !['starting', 'processing'].includes(
                                current.status,
                            ),
                    );
                }
            }
            if (prediction.status !== 'succeeded' && interrupted) {
                throw interrupted;
            }
            if (
                prediction.status === 'failed' ||
                prediction.status === 'canceled' ||
                (prediction.status as string) === 'aborted'
            ) {
                if (signal?.aborted) throw aborted();
                throw new Error(
                    `Prediction failed: ${prediction.error || prediction.status}`,
                );
            }
            output = prediction.output;
            predictionSeconds = prediction.metrics?.predict_time;
        } catch (err) {
            if (signal?.aborted) throw aborted();
            if (expired()) throw timeout();
            throw this.#translatePredictionFailure(err);
        }

        const selectedOutput =
            selectedModel.outputIndex !== undefined && Array.isArray(output)
                ? output[selectedModel.outputIndex]
                : output;
        const url = this.#extractUrl(selectedOutput);
        if (!url) {
            throw new HttpError(
                400,
                'Failed to extract image URL from Replicate response',
                { legacyCode: 'unknown_error' },
            );
        }

        if (catalogInput) {
            const seconds = predictionSeconds ?? 0;
            if (
                selectedModel.costs.second !== undefined &&
                (!Number.isFinite(predictionSeconds) || seconds < 0)
            ) {
                throw new HttpError(
                    502,
                    'Replicate response did not include billable runtime',
                    {
                        legacyCode: 'upstream_failed',
                    },
                );
            }
            const measuredOutputMp = selectedModel.billingRates?.some(
                (rate) => rate.costs.output_mp !== undefined,
            )
                ? await this.#measureMegapixels(url, false)
                : outputMp;
            this.#meteringService.batchIncrementUsages(
                actor,
                catalogCostComponents(selectedModel, catalogInput, {
                    inputMp,
                    outputMp: measuredOutputMp,
                    seconds,
                }).filter((component) => component.usageAmount > 0),
            );
        } else
            this.#recordUsage(
                actor,
                selectedModel,
                outputMp,
                goFast,
                inputMp,
                generationMode,
            );

        if (signal?.aborted) throw aborted();
        // A prediction that finished during deadline cleanup is paid for and
        // usable, so the caller gets the image rather than a 504.
        return url;
    }

    #getModel(model?: string): ReplicateImageModel {
        const models = REPLICATE_IMAGE_GENERATION_MODELS;
        const found = models.find(
            (m) => m.id === model || m.aliases?.includes(model ?? ''),
        );
        return found ?? models.find((m) => m.id === DEFAULT_MODEL)!;
    }

    /**
     * A prediction that ran and ended `failed` reaches us as a plain Error with
     * no HTTP status, so the driver boundary cannot classify it and it would
     * surface as an unhandled 500. Content-filter refusals are the caller's to
     * act on; anything else is an upstream fault. Errors that do carry a status
     * (the SDK's ApiError) pass through untouched so the boundary translator
     * still sees it.
     */
    #translatePredictionFailure(err: unknown): unknown {
        if (err instanceof HttpError) return err;
        if (!(err instanceof Error)) return err;
        const fields = { provider: 'replicate' };

        if (!err.message.startsWith(PREDICTION_FAILED_PREFIX)) {
            // Status-bearing SDK errors and timeouts are classified at the
            // driver boundary; a bare transport failure while creating or
            // polling has no status and would otherwise surface as a 500.
            if (hasUpstreamStatus(err) || isUpstreamTimeoutError(err))
                return err;
            return new HttpError(
                502,
                'Lost contact with Replicate during image generation',
                { legacyCode: 'upstream_failed', fields, cause: err },
            );
        }

        const detail = sanitizeUpstreamMessage(
            err.message.slice(PREDICTION_FAILED_PREFIX.length),
        );

        if (CONTENT_FILTER_PATTERN.test(detail)) {
            return new HttpError(
                400,
                detail || 'Prompt or output was rejected by the content filter',
                {
                    legacyCode: 'bad_request',
                    code: 'moderation_flagged',
                    fields,
                    cause: err,
                },
            );
        }
        return new HttpError(502, detail || 'Replicate prediction failed', {
            legacyCode: 'upstream_failed',
            fields,
            cause: err,
        });
    }

    /**
     * Builds the Replicate API input payload from already-aliased+transformed
     * params. Image inputs and prompt/ratio are placed explicitly; everything
     * else is spread verbatim so newly-allowed keys flow through without
     * needing a code change here.
     */
    #buildRequest(
        model: ReplicateImageModel,
        ctx: {
            prompt: string;
            ratio: { w: number; h: number };
            transformed: Record<string, unknown>;
            inputImages: string[];
            singleImage?: string;
        },
    ): Record<string, unknown> {
        const { prompt, ratio, transformed, inputImages, singleImage } = ctx;

        const input: Record<string, unknown> = {
            prompt,
            aspect_ratio: formatAspectRatio(ratio)!,
        };

        const handled = new Set<string>(
            ReplicateImageGenerationProvider.#CORE_PARAMS,
        );
        if (model.imageInputKey) handled.add(model.imageInputKey);
        if (model.singleImageInputKey) handled.add(model.singleImageInputKey);

        if (inputImages.length && model.imageInputKey) {
            input[model.imageInputKey] = inputImages;
        } else if (singleImage && model.singleImageInputKey) {
            input[model.singleImageInputKey] = singleImage;
        }

        for (const [key, value] of Object.entries(transformed)) {
            if (handled.has(key)) continue;
            if (value === undefined || value === null) continue;
            input[key] = value;
        }

        return input;
    }

    /**
     * Drops params not in `model.allowed_params` (plus `#CORE_PARAMS` and any
     * alias targets, so the native key is also accepted).
     */
    #filterAllowedParams(
        params: IGenerateParams,
        model: ReplicateImageModel,
    ): IGenerateParams {
        const allowedSet = model.allowed_params;
        if (!allowedSet) return params;

        const aliasTargets = model.param_aliases
            ? Object.values(model.param_aliases)
            : [];
        const nativeImageKeys: string[] = [];
        if (model.imageInputKey) nativeImageKeys.push(model.imageInputKey);
        if (model.singleImageInputKey)
            nativeImageKeys.push(model.singleImageInputKey);

        const filtered: Record<string, unknown> = {};
        for (const key of Object.keys(params)) {
            // `resolution` is the cross-provider tier option (xAI's '1k'/'2k').
            // On Replicate it is only meaningful as a native key a model
            // whitelists; admitting it as an alias target would send
            // `resolution: '2k MP'` to flux-2-pro.
            if (key === 'resolution' && !allowedSet.includes(key)) continue;
            if (
                ReplicateImageGenerationProvider.#CORE_PARAMS.includes(key) ||
                allowedSet.includes(key) ||
                aliasTargets.includes(key) ||
                nativeImageKeys.includes(key)
            ) {
                filtered[key] = params[key];
            }
        }
        return filtered as IGenerateParams;
    }

    /**
     * Renames canonical keys to the model's native API names per
     * `model.param_aliases` (e.g. `steps` → `num_inference_steps`).
     */
    #applyParamAliases(
        params: IGenerateParams,
        model: ReplicateImageModel,
    ): Record<string, unknown> {
        const aliases = model.param_aliases;
        if (!aliases) return params as Record<string, unknown>;

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
            const nativeKey = aliases[key] ?? key;
            result[nativeKey] = value;
        }
        return result;
    }

    /**
     * Applies `param_transforms` on top of the aliased map: injects defaults
     * for missing keys, then appends any configured string suffix to the value.
     * Returns the original map unchanged when the model declares no
     * transforms.
     */
    #applyTransforms(
        aliased: Record<string, unknown>,
        model: ReplicateImageModel,
    ): Record<string, unknown> {
        const transforms = model.param_transforms;
        if (!transforms) return aliased;

        const result = { ...aliased };
        for (const [key, cfg] of Object.entries(transforms)) {
            let value = result[key];
            if (value === undefined && cfg.default !== undefined) {
                value = cfg.default;
            }
            if (value === undefined) continue;
            if (cfg.suffix !== undefined && typeof value === 'string') {
                value = value + cfg.suffix;
            }
            result[key] = value;
        }
        return result;
    }

    #normalizeRatio(ratio?: { w: number; h: number }) {
        const w = Number(ratio?.w);
        const h = Number(ratio?.h);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            return { w, h };
        }
        return { ...DEFAULT_RATIO };
    }

    #resolveOutputMegapixels(userValue?: string): number {
        if (typeof userValue === 'string') {
            const parsed = parseFloat(userValue);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return 1;
    }

    async #measureInputMegapixels(
        imageUrls: string[],
        roundUp = true,
    ): Promise<number> {
        const measurements: number[] = new Array(imageUrls.length).fill(0);
        let next = 0;
        const worker = async () => {
            while (next < imageUrls.length) {
                const index = next++;
                measurements[index] = await this.#measureMegapixels(
                    imageUrls[index],
                    roundUp,
                    true,
                );
            }
        };
        await Promise.all(
            Array.from(
                {
                    length: Math.min(
                        INPUT_MEASURE_CONCURRENCY,
                        imageUrls.length,
                    ),
                },
                worker,
            ),
        );
        return measurements.reduce(
            (total, megapixels) => total + megapixels,
            0,
        );
    }

    /**
     * Unreadable images fall back to a one-megapixel estimate. A caller's
     * reference over the byte cap is refused instead: it would be forwarded
     * upstream while billed as if it were small.
     */
    async #measureMegapixels(
        url: string,
        roundUp = true,
        callerInput = false,
    ): Promise<number> {
        try {
            const inlineImage = parseDataUri(url);
            const buffer = inlineImage
                ? Buffer.from(inlineImage.base64, 'base64')
                : await readBounded(
                      await secureFetch(url, {
                          signal: AbortSignal.timeout(INPUT_MEASURE_TIMEOUT_MS),
                      }),
                      INPUT_MEASURE_MAX_BYTES,
                  );
            const meta = await sharp(buffer).metadata();
            const megapixels =
                meta.width && meta.height
                    ? (meta.width * meta.height) / 1_000_000
                    : 1;
            return roundUp ? Math.ceil(megapixels) : megapixels;
        } catch (error) {
            if (
                callerInput &&
                error instanceof HttpError &&
                error.code === 'input_too_large'
            )
                throw error;
            return 1;
        }
    }

    #resolveCosts(
        model: ReplicateImageModel,
        goFast: boolean,
        generationMode?: string,
    ): Record<string, number> {
        if (goFast && model.costs_go_fast) return model.costs_go_fast;
        if (
            generationMode &&
            model.costs_by_generation_mode?.[generationMode]
        ) {
            return model.costs_by_generation_mode[generationMode];
        }
        return model.costs;
    }

    #estimateCost(
        model: ReplicateImageModel,
        outputMp: number,
        goFast: boolean,
        inputMp: number,
        generationMode?: string,
    ): number {
        const costs = this.#resolveCosts(model, goFast, generationMode);

        if (model.billingScheme === 'per-image') {
            const cents = costs.output;
            if (!cents || cents <= 0) {
                throw new HttpError(
                    400,
                    `Replicate model ${model.id} has no valid per-image cost configured`,
                    { legacyCode: 'bad_request' },
                );
            }
            return Math.round(cents * 1_000_000);
        }

        const runCents = costs.run ?? 0;
        const outputMpCents = costs.output_mp;
        if (!outputMpCents || outputMpCents <= 0) {
            throw new HttpError(
                400,
                `Replicate model ${model.id} has no valid output_mp cost configured`,
                { legacyCode: 'bad_request' },
            );
        }
        const inputMpCents = (costs.input_mp ?? 0) * inputMp;
        return Math.round(
            (runCents + outputMpCents * outputMp + inputMpCents) * 1_000_000,
        );
    }

    #recordUsage(
        actor: Actor,
        model: ReplicateImageModel,
        outputMp: number,
        goFast: boolean,
        inputMp: number,
        generationMode?: string,
    ) {
        const prefix = `replicate:${model.id}`;
        const costs = this.#resolveCosts(model, goFast, generationMode);

        if (model.billingScheme === 'per-image') {
            const cents = costs.output;
            if (!cents || cents <= 0) return;
            this.#meteringService.incrementUsage(
                actor,
                `${prefix}:output`,
                1,
                Math.round(cents * 1_000_000),
            );
            return;
        }

        const components: {
            usageType: string;
            usageAmount: number;
            costOverride: number;
        }[] = [];

        const runCents = costs.run ?? 0;
        if (runCents > 0) {
            components.push({
                usageType: `${prefix}:run`,
                usageAmount: 1,
                costOverride: Math.round(runCents * 1_000_000),
            });
        }

        const outputMpCents = costs.output_mp ?? 0;
        if (outputMpCents > 0) {
            components.push({
                usageType: `${prefix}:output_mp`,
                usageAmount: outputMp,
                costOverride: Math.round(outputMpCents * outputMp * 1_000_000),
            });
        }

        const inputMpCents = costs.input_mp ?? 0;
        if (inputMpCents > 0 && inputMp > 0) {
            components.push({
                usageType: `${prefix}:input_mp`,
                usageAmount: inputMp,
                costOverride: Math.round(inputMpCents * inputMp * 1_000_000),
            });
        }

        if (components.length > 0) {
            this.#meteringService.batchIncrementUsages(actor, components);
        }
    }

    #extractUrl(output: unknown): string | undefined {
        if (typeof output === 'string')
            return /^(https?:\/\/|data:image\/)/.test(output)
                ? output
                : undefined;
        if (Array.isArray(output)) {
            for (const value of output) {
                const url = this.#extractUrl(value);
                if (url) return url;
            }
        }
        if (output && typeof output === 'object') {
            const object = output as Record<string, unknown>;
            for (const key of ['image', 'url', 'output', 'images']) {
                const url = this.#extractUrl(object[key]);
                if (url) return url;
            }
            const value = String(output);
            if (/^https?:\/\//.test(value)) return value;
        }
        return undefined;
    }
}
