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
import { imageDataUri } from '../../imageOutput.js';
import { OpenAI } from 'openai';
import { formatAspectRatio } from '../../imageDimensions.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IGenerateParams, IImageProvider } from '../../types.js';
import { XAI_IMAGE_GENERATION_MODELS, type XaiImageModel } from './models.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import { toUrlOrDataUri } from '../../inputImage.js';
import { upstreamUserIdentifier } from '../../../util/upstreamIdentifier.js';

const DEFAULT_MODEL = 'grok-imagine-image';
// xAI's Grok Imagine edit endpoint accepts up to 5 source images per request.
const MAX_INPUT_IMAGES = 5;

interface XaiImageResponse {
    data?: Array<{ url?: string; b64_json?: string }>;
}

export class XAIImageProvider implements IImageProvider {
    #client: OpenAI;
    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        if (!config.apiKey) {
            throw new Error('xAI image generation requires an API key');
        }

        this.#meteringService = meteringService;
        this.#client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.x.ai/v1',
        });
    }

    models(): XaiImageModel[] {
        return XAI_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel(): string {
        return DEFAULT_MODEL;
    }

    async generate(params: IGenerateParams): Promise<string> {
        const { prompt, test_mode, model, ratio, quality } = params;
        let { input_images } = params;
        const { input_image, input_image_mime_type } = params;

        const selectedModel = this.#getModel(model);

        if (test_mode) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        assertImagePrompt(prompt);

        for (const option of ['quality', 'resolution'] as const) {
            if (params[option] != null && typeof params[option] !== 'string') {
                throw new HttpError(400, `${option} must be a string`, {
                    legacyCode: 'bad_request',
                });
            }
        }

        // Backwards compat: fold singular `input_image` into `input_images`.
        if (input_image && (!input_images || input_images.length === 0)) {
            input_images = [input_image];
        }
        // Reject excess references instead of silently dropping part of an edit.
        if (input_images && input_images.length > MAX_INPUT_IMAGES) {
            throw new HttpError(
                400,
                `xAI accepts at most ${MAX_INPUT_IMAGES} input images`,
                { legacyCode: 'bad_request' },
            );
        }
        const inputImageCount = input_images?.length ?? 0;
        const hasInputImages = inputImageCount > 0;

        // xAI uses a `resolution` tier ('1k'/'2k') rather than a pixel size.
        const resolution = this.#normalizeResolution(
            params.resolution ?? quality,
        );
        const normalizedQuality = quality?.trim().toLowerCase();
        const imageQuality = selectedModel.defaultQuality
            ? normalizedQuality &&
              normalizedQuality !== 'auto' &&
              selectedModel.allowedQualityLevels?.includes(normalizedQuality)
                ? normalizedQuality
                : hasInputImages
                  ? (selectedModel.defaultEditQuality ??
                    selectedModel.defaultQuality)
                  : selectedModel.defaultQuality
            : undefined;
        const outputCostKey = `output:${resolution}${imageQuality ? `:${imageQuality}` : ''}`;
        const aspectRatio = formatAspectRatio(ratio);

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'actor not found in context', {
                legacyCode: 'unauthorized',
            });
        }
        const userIdentifier = upstreamUserIdentifier(actor);

        const outputPriceInCents = selectedModel.costs[outputCostKey];
        const mediaInputPriceInCents = selectedModel.costs.media_input ?? 0;
        const estimatedCostInCents =
            outputPriceInCents +
            (hasInputImages ? mediaInputPriceInCents * inputImageCount : 0);
        const usageAllowed = await this.#meteringService.hasEnoughCredits(
            actor,
            estimatedCostInCents * 1_000_000,
        );

        if (!usageAllowed) {
            throw new HttpError(
                402,
                'Insufficient credits for image generation',
                { legacyCode: 'insufficient_funds' },
            );
        }

        const response = hasInputImages
            ? await this.#edit(
                  selectedModel.id,
                  prompt,
                  input_images!,
                  input_image_mime_type,
                  resolution,
                  aspectRatio,
                  imageQuality,
                  userIdentifier,
              )
            : ((await this.#client.images.generate({
                  model: selectedModel.id,
                  prompt,
                  user: userIdentifier,
                  // xAI-specific params not in the OpenAI type; passed through.
                  ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
                  resolution,
                  ...(imageQuality ? { quality: imageQuality } : {}),
              } as Parameters<
                  OpenAI['images']['generate']
              >[0])) as XaiImageResponse);

        const first = response.data?.[0];
        const url =
            first?.url ||
            (first?.b64_json ? imageDataUri(first.b64_json) : undefined);

        if (!url) {
            throw new Error('Failed to extract image URL from xAI response');
        }

        const usageEntries = [
            {
                usageType: `xai:${selectedModel.id}:${outputCostKey}`,
                usageAmount: 1,
                costOverride: outputPriceInCents * 1_000_000,
            },
        ];
        if (hasInputImages && mediaInputPriceInCents > 0) {
            usageEntries.push({
                usageType: `xai:${selectedModel.id}:media_input`,
                usageAmount: inputImageCount,
                costOverride:
                    mediaInputPriceInCents * inputImageCount * 1_000_000,
            });
        }
        this.#meteringService.batchIncrementUsages(actor, usageEntries);

        return url;
    }

    // Edits go to POST /v1/images/edits as application/json (the OpenAI SDK's
    // images.edit() can't be used — it sends multipart/form-data, which xAI
    // rejects). We reuse the SDK client's auth + baseURL via its low-level
    // post(). Input images are passed as `{ type: 'image_url', url }` objects;
    // a single object for one image, an array for multiple.
    async #edit(
        modelId: string,
        prompt: string,
        inputImages: string[],
        mimeHint: string | undefined,
        resolution: string,
        aspectRatio: string | undefined,
        quality: string | undefined,
        user: string,
    ): Promise<XaiImageResponse> {
        const refs = inputImages.map((img) => ({
            type: 'image_url',
            url: toUrlOrDataUri(img, mimeHint),
        }));
        const body: Record<string, unknown> = {
            model: modelId,
            user,
            prompt,
            image: refs.length === 1 ? refs[0] : refs,
            resolution,
        };
        if (aspectRatio) body.aspect_ratio = aspectRatio;
        if (quality) body.quality = quality;
        return (await this.#client.post('/images/edits', {
            body,
        })) as XaiImageResponse;
    }

    #normalizeResolution(quality?: string): '1k' | '2k' {
        return (quality ?? '').trim().toLowerCase() === '2k' ? '2k' : '1k';
    }

    #getModel(model?: string) {
        const models = this.models();
        const found = models.find(
            (m) => m.id === model || m.aliases?.includes(model ?? ''),
        );
        return found || models.find((m) => m.id === DEFAULT_MODEL)!;
    }
}
