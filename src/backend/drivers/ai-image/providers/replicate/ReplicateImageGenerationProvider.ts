/**
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

import Replicate from 'replicate';
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

const DEFAULT_MODEL = 'black-forest-labs/flux-schnell';
const DEFAULT_RATIO = { w: 1024, h: 1024 };

export class ReplicateImageGenerationProvider implements IImageProvider {
    static readonly #CORE_PARAMS: readonly string[] = [
        'prompt',
        'model',
        'ratio',
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
        this.#client = new Replicate({ auth: config.apiKey });
        this.#meteringService = meteringService;
    }

    models() {
        return REPLICATE_IMAGE_GENERATION_MODELS;
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

        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
            throw new HttpError(400, '`prompt` must be a non-empty string', {
                legacyCode: 'bad_request',
            });
        }

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'actor not found in context', {
                legacyCode: 'unauthorized',
            });
        }

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
            if (typeof params.input_image === 'string') {
                singleImage = params.input_image;
            } else {
                const nativeVal = (params as Record<string, unknown>)[
                    selectedModel.singleImageInputKey
                ];
                if (typeof nativeVal === 'string') singleImage = nativeVal;
            }
        }
        const allInputUrls = singleImage ? [singleImage] : inputImages;
        const inputMp =
            allInputUrls.length > 0
                ? await this.#measureInputMegapixels(allInputUrls)
                : 0;

        const outputMp = this.#resolveOutputMegapixels(
            params.output_megapixels as string | undefined,
        );

        const totalCostMicroCents = this.#estimateCost(
            selectedModel,
            outputMp,
            goFast,
            inputMp,
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

        const input = this.#buildRequest(selectedModel, {
            prompt,
            ratio,
            transformed,
            inputImages,
            singleImage,
        });

        const output = await this.#client.run(
            selectedModel.replicateId as `${string}/${string}`,
            { input },
        );

        const url = this.#extractUrl(output);
        if (!url) {
            throw new HttpError(
                400,
                'Failed to extract image URL from Replicate response',
                { legacyCode: 'unknown_error' },
            );
        }

        this.#recordUsage(
            actor,
            selectedModel,
            outputMp,
            goFast,
            inputMp,
            generationMode,
        );

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
            aspect_ratio: this.#toAspectRatio(ratio),
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
     * for missing keys, then appends any configured string suffix to the
     * value. Returns the original map unchanged when the model declares no
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
            return { w: Math.round(w), h: Math.round(h) };
        }
        return { ...DEFAULT_RATIO };
    }

    #toAspectRatio(ratio: { w: number; h: number }): string {
        const g = this.#gcd(ratio.w, ratio.h);
        return `${ratio.w / g}:${ratio.h / g}`;
    }

    #gcd(a: number, b: number): number {
        return b === 0 ? a : this.#gcd(b, a % b);
    }

    #resolveOutputMegapixels(userValue?: string): number {
        if (typeof userValue === 'string') {
            const parsed = parseFloat(userValue);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return 1;
    }

    async #measureInputMegapixels(imageUrls: string[]): Promise<number> {
        let totalMp = 0;
        for (const url of imageUrls) {
            try {
                // User-supplied URLs: SSRF-guarded + (optionally) proxied.
                const res = await secureFetch(url);
                const buffer = Buffer.from(await res.arrayBuffer());
                const meta = await sharp(buffer).metadata();
                if (meta.width && meta.height) {
                    totalMp += Math.ceil(
                        (meta.width * meta.height) / 1_000_000,
                    );
                }
            } catch {
                totalMp += 1;
            }
        }
        return totalMp;
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
        if (typeof output === 'string') return output;
        if (Array.isArray(output)) {
            const first = output[0];
            if (typeof first === 'string') return first;
            if (first && typeof first === 'object') return String(first);
        }
        if (output && typeof output === 'object') return String(output);
        return undefined;
    }
}
