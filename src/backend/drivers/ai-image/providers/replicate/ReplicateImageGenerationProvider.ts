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

type ReplicateGenerateParams = IGenerateParams & {
    go_fast?: boolean;
    seed?: number;
    steps?: number;
    guidance?: number;
    output_quality?: number;
    output_megapixels?: string;
    prompt_strength?: number;
    negative_prompt?: string;
    response_format?: string;
    disable_safety_checker?: boolean;
};

export class ReplicateImageGenerationProvider implements IImageProvider {
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
        const extra = params as ReplicateGenerateParams;
        const { prompt, test_mode } = extra;

        const selectedModel = this.#getModel(extra.model);
        const ratio = this.#normalizeRatio(extra.ratio);

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

        const goFast = selectedModel.supportsGoFast
            ? extra.go_fast !== undefined
                ? !!extra.go_fast
                : (selectedModel.goFastDefault ?? false)
            : false;

        const inputImages: string[] = [];
        if (selectedModel.imageInputKey) {
            if (extra.input_image) inputImages.push(extra.input_image);
            if (extra.input_images?.length)
                inputImages.push(...extra.input_images);
        }
        const singleImage = selectedModel.singleImageInputKey
            ? extra.input_image
            : undefined;
        const allInputUrls = singleImage ? [singleImage] : inputImages;
        const inputMp =
            allInputUrls.length > 0
                ? await this.#measureInputMegapixels(allInputUrls)
                : 0;

        const outputMp = this.#resolveOutputMegapixels(extra.output_megapixels);

        const totalCostMicroCents = this.#estimateCost(
            selectedModel,
            outputMp,
            goFast,
            inputMp,
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

        const input: Record<string, unknown> = {
            prompt,
            aspect_ratio: this.#toAspectRatio(ratio),
            disable_safety_checker: !!extra.disable_safety_checker,
        };
        if (selectedModel.supportsGoFast) {
            input.go_fast = goFast;
        }
        if (inputImages.length && selectedModel.imageInputKey) {
            input[selectedModel.imageInputKey] = inputImages;
        } else if (singleImage && selectedModel.singleImageInputKey) {
            input[selectedModel.singleImageInputKey] = singleImage;
        }
        if (Number.isFinite(extra.seed))
            input.seed = Math.round(extra.seed as number);
        if (Number.isFinite(extra.steps))
            input.num_inference_steps = Math.round(extra.steps as number);
        if (Number.isFinite(extra.guidance)) input.guidance = extra.guidance;
        if (Number.isFinite(extra.output_quality))
            input.output_quality = Math.round(extra.output_quality as number);
        if (
            typeof extra.output_megapixels === 'string' &&
            selectedModel.resolutionInputKey
        ) {
            input[selectedModel.resolutionInputKey] =
                extra.output_megapixels +
                (selectedModel.resolutionSuffix ?? '');
        } else if (typeof extra.output_megapixels === 'string') {
            input.megapixels = extra.output_megapixels;
        }
        if (Number.isFinite(extra.prompt_strength))
            input.prompt_strength = extra.prompt_strength;
        if (typeof extra.negative_prompt === 'string')
            input.negative_prompt = extra.negative_prompt;
        if (typeof extra.response_format === 'string')
            input.output_format = extra.response_format;

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

        this.#recordUsage(actor, selectedModel, outputMp, goFast, inputMp);

        return url;
    }

    #getModel(model?: string): ReplicateImageModel {
        const models = REPLICATE_IMAGE_GENERATION_MODELS;
        const found = models.find(
            (m) => m.id === model || m.aliases?.includes(model ?? ''),
        );
        return found ?? models.find((m) => m.id === DEFAULT_MODEL)!;
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
    ): Record<string, number> {
        return goFast && model.costs_go_fast
            ? model.costs_go_fast
            : model.costs;
    }

    #estimateCost(
        model: ReplicateImageModel,
        outputMp: number,
        goFast: boolean,
        inputMp: number,
    ): number {
        const costs = this.#resolveCosts(model, goFast);

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
    ) {
        const prefix = `replicate:${model.id}`;
        const costs = this.#resolveCosts(model, goFast);

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
