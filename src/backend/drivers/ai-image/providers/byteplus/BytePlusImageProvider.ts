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

import { OpenAI } from 'openai';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type {
    IGenerateParams,
    IImageModel,
    IImageProvider,
} from '../../types.js';
import { toUrlOrDataUri } from '../../inputImage.js';
import {
    BYTEPLUS_IMAGE_GENERATION_MODELS,
    SEEDREAM_RESOLUTION_MAP,
} from './models.js';

const DEFAULT_MODEL = 'seedream-5-0-lite-260128';

// Ark's explicit-pixel `size` bounds ("method 2"): total pixels within
// [1280x720, 2048x2048x1.1025] and aspect ratio within [1/16, 16].
const MIN_TOTAL_PIXELS = 921_600;
const MAX_TOTAL_PIXELS = 4_624_220;
// Models restricted to the 2K tier (see SEEDREAM_2K_ONLY in models.ts)
// enforce this higher minimum on explicit sizes too.
const MIN_TOTAL_PIXELS_2K_ONLY = 3_686_400;
// dola-seedream-5-0-pro's price break: ≤ 2.61MP bills the "1.5K or lower"
// rate, above it the higher rate.
const PRO_TIER_BREAK_PIXELS = 2_610_000;

// Ark's `size` tiers, smallest first.
const TIERS = ['1k', '1.5k', '2k'] as const;
type Tier = (typeof TIERS)[number];
const isTier = (v: string): v is Tier =>
    (TIERS as readonly string[]).includes(v);

// Per-request reference image caps, per the API reference.
const MAX_INPUT_IMAGES_PRO = 10;
const MAX_INPUT_IMAGES_SEEDREAM = 14;

type BytePlusImageConfig = {
    apiKey: string;
    apiBaseUrl?: string;
};

interface ArkImageResponse {
    data?: Array<{
        url?: string;
        b64_json?: string;
        output_format?: string;
        error?: { code?: string; message?: string };
    }>;
    usage?: { generated_images?: number };
}

/**
 * BytePlus ModelArk image generation provider (Seedream).
 *
 * Ark's `POST /images/generations` is OpenAI-compatible enough to reuse the
 * OpenAI SDK (same client/auth as BytePlusProvider in ai-chat); Ark-specific
 * params (`image`, `watermark`, tier-style `size`) pass through the SDK
 * untouched. https://docs.byteplus.com/en/docs/ModelArk/1541523
 */
export class BytePlusImageProvider implements IImageProvider {
    #client: OpenAI;
    #meteringService: MeteringService;

    constructor(config: BytePlusImageConfig, meteringService: MeteringService) {
        if (!config.apiKey) {
            throw new Error('BytePlus image generation requires an API key');
        }
        this.#meteringService = meteringService;
        this.#client = new OpenAI({
            apiKey: config.apiKey,
            baseURL:
                config.apiBaseUrl ??
                'https://ark.ap-southeast.bytepluses.com/api/v3',
        });
    }

    models(): IImageModel[] {
        return BYTEPLUS_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel(): string {
        return DEFAULT_MODEL;
    }

    async generate(params: IGenerateParams): Promise<string> {
        const { prompt, test_mode, model, ratio, quality } = params;
        let { input_images } = params;
        const { input_image, input_image_mime_type } = params;

        const selectedModel = this.#getModel(model);
        const isPro = selectedModel.pricing_unit === 'per-tier';

        if (test_mode) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        if (typeof prompt !== 'string' || prompt.trim().length === 0) {
            throw new HttpError(400, '`prompt` must be a non-empty string', {
                legacyCode: 'bad_request',
            });
        }

        // Backwards compat: fold singular `input_image` into `input_images`.
        if (input_image && (!input_images || input_images.length === 0)) {
            input_images = [input_image];
        }
        const maxInputImages = isPro
            ? MAX_INPUT_IMAGES_PRO
            : MAX_INPUT_IMAGES_SEEDREAM;
        if (input_images && input_images.length > maxInputImages) {
            throw new HttpError(
                400,
                `${selectedModel.id} accepts at most ${maxInputImages} input image(s)`,
                { legacyCode: 'bad_request' },
            );
        }
        const inputImageCount = input_images?.length ?? 0;

        const tier = this.#normalizeTier(quality, selectedModel);
        const size = this.#resolveSize(tier, selectedModel, ratio);

        // The pro model bills by output pixel count; everything else is a
        // flat per-image rate.
        let outputCostKey: string;
        if (isPro) {
            const pixels = this.#sizePixels(size);
            outputCostKey =
                pixels !== undefined
                    ? pixels > PRO_TIER_BREAK_PIXELS
                        ? 'output:2k'
                        : 'output:1k'
                    : `output:${tier}`;
        } else {
            outputCostKey = 'per-image';
        }
        const outputCents = selectedModel.costs[outputCostKey];
        if (outputCents === undefined) {
            throw new Error(
                `Model ${selectedModel.id} missing '${outputCostKey}' cost`,
            );
        }
        // First input image is free on the pro model; the rest are billed.
        const inputImageCents = selectedModel.costs.input_image ?? 0;
        const billableInputs =
            inputImageCents > 0 ? Math.max(0, inputImageCount - 1) : 0;
        const estimatedCents = outputCents + billableInputs * inputImageCents;

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        }
        const usageAllowed = await this.#meteringService.hasEnoughCredits(
            actor,
            estimatedCents * 1_000_000,
        );
        if (!usageAllowed) {
            throw new HttpError(
                402,
                'Insufficient credits for image generation',
                { legacyCode: 'insufficient_funds' },
            );
        }

        const image =
            inputImageCount > 0
                ? input_images!.map((img) =>
                      toUrlOrDataUri(img, input_image_mime_type),
                  )
                : undefined;

        const response = (await this.#client.images.generate({
            model: selectedModel.id,
            prompt,
            // Ark-specific params not in the OpenAI type; passed through.
            ...(size ? { size } : {}),
            ...(image ? { image: image.length === 1 ? image[0] : image } : {}),
            response_format: 'url',
            watermark: false,
        } as Parameters<OpenAI['images']['generate']>[0])) as ArkImageResponse;

        const first = response.data?.[0];
        if (first?.error) {
            throw new HttpError(
                400,
                first.error.message ?? 'Image generation failed',
                {
                    legacyCode: 'upstream_failed',
                    fields: { provider: 'byteplus' },
                },
            );
        }
        const url =
            first?.url ||
            (first?.b64_json
                ? `data:image/${first.output_format ?? 'jpeg'};base64,${first.b64_json}`
                : undefined);
        if (!url) {
            throw new Error(
                'Failed to extract image URL from BytePlus response',
            );
        }

        const usageEntries = [
            {
                usageType: `byteplus-image-generation:${selectedModel.id}:${outputCostKey}`,
                usageAmount: 1,
                costOverride: outputCents * 1_000_000,
            },
        ];
        if (billableInputs > 0) {
            usageEntries.push({
                usageType: `byteplus-image-generation:${selectedModel.id}:input_image`,
                usageAmount: billableInputs,
                costOverride: billableInputs * inputImageCents * 1_000_000,
            });
        }
        this.#meteringService.batchIncrementUsages(actor, usageEntries);

        return url;
    }

    /**
     * Pick the tier to request. Models with a minimum output-pixel count reject
     * the smaller tiers outright (and the aspect-ratio table maps them to
     * sub-minimum sizes), so snap up to the nearest tier the model allows
     * rather than letting Ark 400 the request.
     */
    #normalizeTier(quality: string | undefined, model: IImageModel): Tier {
        const q = (quality ?? '').toLowerCase();
        // OpenAI-style quality names other Puter providers accept map onto
        // the nearest Ark tier so e.g. 'low' isn't silently billed at the
        // 2K rate; anything else falls back to Ark's own default of 2K.
        const synonym: Record<string, Tier> = {
            low: '1k',
            medium: '1.5k',
            high: '2k',
            hd: '2k',
        };
        const requested: Tier = isTier(q) ? q : (synonym[q] ?? '2k');

        const allowed = TIERS.filter(
            (t) => model.allowedQualityLevels?.includes(t) ?? true,
        );
        if (allowed.length === 0 || allowed.includes(requested)) {
            return requested;
        }
        return (
            allowed.find((t) => TIERS.indexOf(t) > TIERS.indexOf(requested)) ??
            allowed[allowed.length - 1]
        );
    }

    /**
     * Resolve the `size` request param:
     *
     * - `ratio` holding real pixel dimensions → explicit `WxH` (method 2)
     * - `ratio` holding an aspect ratio with a known tier mapping → the
     *   documented `WxH` for (aspect, tier)
     * - Otherwise → the tier keyword (`1K`/`1.5K`/`2K`, method 1)
     */
    #resolveSize(
        tier: Tier,
        model: IImageModel,
        ratio?: { w: number; h: number },
    ): string {
        if (ratio?.w && ratio?.h) {
            const pixels = ratio.w * ratio.h;
            if (pixels >= MIN_TOTAL_PIXELS) {
                // 2K-only models enforce a higher minimum on explicit sizes
                // too — fail fast with the real constraint instead of letting
                // Ark 400 the request after the round-trip.
                const minPixels = model.allowedQualityLevels?.includes('1k')
                    ? MIN_TOTAL_PIXELS
                    : MIN_TOTAL_PIXELS_2K_ONLY;
                const aspect = ratio.w / ratio.h;
                if (
                    pixels < minPixels ||
                    pixels > MAX_TOTAL_PIXELS ||
                    aspect < 1 / 16 ||
                    aspect > 16
                ) {
                    throw new HttpError(
                        400,
                        `Requested size ${ratio.w}x${ratio.h} is outside BytePlus limits ` +
                            `for ${model.id} (total pixels within [${minPixels}, ${MAX_TOTAL_PIXELS}], ` +
                            'aspect ratio within [1/16, 16])',
                        { legacyCode: 'bad_request' },
                    );
                }
                return `${ratio.w}x${ratio.h}`;
            }
            // Reduce w:h to lowest terms so any spelling of a supported
            // aspect (8:6, 32:18, ...) finds its documented tier size.
            const gcd = (a: number, b: number): number =>
                b === 0 ? a : gcd(b, a % b);
            const d = gcd(Math.round(ratio.w), Math.round(ratio.h)) || 1;
            const key = `${Math.round(ratio.w) / d}:${Math.round(ratio.h) / d}`;
            const mapped = SEEDREAM_RESOLUTION_MAP[key]?.[tier];
            if (mapped) return `${mapped.w}x${mapped.h}`;
        }
        return { '1k': '1K', '1.5k': '1.5K', '2k': '2K' }[tier];
    }

    /** Pixel count of an explicit `WxH` size; undefined for tier keywords. */
    #sizePixels(size: string): number | undefined {
        const m = /^(\d+)x(\d+)$/.exec(size);
        if (!m) return undefined;
        return Number(m[1]) * Number(m[2]);
    }

    #getModel(model?: string) {
        const models = this.models();
        const wanted = (model ?? '').trim().toLowerCase();
        const found = models.find(
            (m) =>
                m.id === wanted ||
                m.puterId === wanted ||
                m.aliases?.some((a) => a.toLowerCase() === wanted),
        );
        return found || models.find((m) => m.id === DEFAULT_MODEL)!;
    }
}
