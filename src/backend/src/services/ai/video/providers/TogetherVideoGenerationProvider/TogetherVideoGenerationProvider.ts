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
import { Together } from 'together-ai';
import APIError from '../../../../../api/APIError.js';
import { ErrorService } from '../../../../../modules/core/ErrorService.js';
import { Context } from '../../../../../util/context.js';
import { TypedValue } from '../../../../drivers/meta/Runtime.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { TOGETHER_VIDEO_MODELS } from './models.js';
import { IVideoGenerateParams, IVideoModel, IVideoProvider } from '../types.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class TogetherVideoGenerationProvider implements IVideoProvider {
    #client: Together;
    #meteringService: MeteringService;
    #errors: ErrorService;

    constructor (config: { apiKey: string }, meteringService: MeteringService, errors: ErrorService) {
        if ( ! config.apiKey ) {
            throw new Error('Together AI video generation requires an API key');
        }
        this.#client = new Together({ apiKey: config.apiKey });
        this.#meteringService = meteringService;
        this.#errors = errors;
    }

    models (): IVideoModel[] {
        return TOGETHER_VIDEO_MODELS;
    }

    getDefaultModel (): string {
        return TOGETHER_VIDEO_MODELS[0].id;
    }

    async generate (params: IVideoGenerateParams) {
        const {
            prompt,
            model: requestedModel,
            seconds,
            duration,
            width,
            height,
            fps,
            steps,
            guidance_scale: guidanceScale,
            seed,
            output_format: outputFormat,
            output_quality: outputQuality,
            negative_prompt: negativePrompt,
            reference_images: referenceImages,
            frame_images: frameImages,
            metadata,
            test_mode: testMode,
            ...rest
        } = params ?? {};

        if ( typeof prompt !== 'string' || !prompt.trim() ) {
            throw APIError.create('field_invalid', undefined, {
                key: 'prompt',
                expected: 'a non-empty string',
                got: prompt,
            });
        }

        const selectedModel = this.#selectModel(requestedModel);

        if ( testMode ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'video',
            }, DEFAULT_TEST_VIDEO_URL);
        }

        const normalizedSeconds = this.#coercePositiveInteger(seconds ?? duration) ?? selectedModel.allowedDurationsSeconds?.[0];

        const actor = Context.get('actor');
        if ( ! actor ) {
            this.#errors.report('together-video-generation:unknown-actor', {
                message: 'actor not found in context',
                trace: true,
            });
            throw new Error('actor not found in context');
        }

        const estimatedUsageUnits = 1;
        const usageKey = this.#determineUsageKey(selectedModel);

        const usageAllowed = await this.#meteringService.hasEnoughCreditsFor(actor, usageKey as any, estimatedUsageUnits);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const createPayload: Record<string, unknown> = {
            prompt,
            model: selectedModel.id,
            ...rest,
        };

        if ( normalizedSeconds ) {
            createPayload.seconds = normalizedSeconds;
        }
        if ( this.#isFiniteNumber(width) ) {
            createPayload.width = Number(width);
        }
        if ( this.#isFiniteNumber(height) ) {
            createPayload.height = Number(height);
        }
        if ( this.#isFiniteNumber(fps) ) {
            createPayload.fps = Number(fps);
        }
        if ( this.#isFiniteNumber(steps) ) {
            createPayload.steps = Number(steps);
        }
        if ( this.#isFiniteNumber(guidanceScale) ) {
            createPayload.guidance_scale = Number(guidanceScale);
        }
        if ( this.#isFiniteNumber(seed) ) {
            createPayload.seed = Number(seed);
        }
        if ( typeof outputFormat === 'string' && outputFormat.trim() ) {
            createPayload.output_format = outputFormat.trim();
        }
        if ( this.#isFiniteNumber(outputQuality) ) {
            createPayload.output_quality = Number(outputQuality);
        }
        if ( typeof negativePrompt === 'string' && negativePrompt.trim() ) {
            createPayload.negative_prompt = negativePrompt;
        }
        if ( Array.isArray(referenceImages) && referenceImages.length > 0 ) {
            createPayload.reference_images = referenceImages.filter(item => typeof item === 'string' && item.trim().length > 0);
        }
        if ( Array.isArray(frameImages) && frameImages.length > 0 ) {
            createPayload.frame_images = frameImages.filter(frame => frame && typeof frame === 'object');
        }
        if ( metadata && typeof metadata === 'object' ) {
            createPayload.metadata = metadata;
        }

        const job = await this.#client.videos.create(createPayload as any);
        const finalJob = await this.#pollUntilComplete(job.id) as any;

        const finalJobStatus = finalJob.status as string;

        if ( finalJobStatus === 'failed' ) {
            const errorMessage = finalJob?.info?.errors?.[0]?.message ??
                finalJob?.info?.errors?.message ??
                finalJob?.info?.errors ??
                'Video generation failed';
            throw new Error(errorMessage);
        }

        if ( finalJobStatus === 'cancelled' ) {
            throw new Error('Video generation was cancelled');
        }

        this.#meteringService.incrementUsage(actor, usageKey as any, 1);

        const videoUrl = finalJob?.outputs?.video_url;
        if ( typeof videoUrl === 'string' && videoUrl.trim() ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'video',
            }, videoUrl);
        }

        throw new Error('Together AI response did not include a video URL');
    }

    #selectModel (requestedModel?: string) {
        return this.models().find(m => m.id === requestedModel) ?? this.models()[0];
    }

    async #pollUntilComplete (jobId: string) {
        let job: any = await this.#client.videos.retrieve(jobId);
        const start = Date.now();

        while ( job.status === 'queued' || job.status === 'in_progress' ) {
            if ( Date.now() - start > DEFAULT_TIMEOUT_MS ) {
                throw new Error('Timed out waiting for Together AI video generation to complete');
            }

            await this.#delay(POLL_INTERVAL_MS);
            job = await this.#client.videos.retrieve(jobId);
        }

        return job;
    }

    async #delay (ms: number) {
        return await new Promise(resolve => setTimeout(resolve, ms));
    }

    #determineUsageKey (model: IVideoModel) {
        return model.defaultUsageKey ?? `together-video:${model.id}`;
    }

    #coercePositiveInteger (value?: unknown) {
        if ( typeof value === 'number' && Number.isFinite(value) ) {
            const rounded = Math.round(value);
            return rounded > 0 ? rounded : undefined;
        }
        if ( typeof value === 'string' ) {
            const numeric = Number.parseInt(value, 10);
            return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
        }
        return undefined;
    }

    #isFiniteNumber (value?: unknown) {
        if ( typeof value === 'number' ) {
            return Number.isFinite(value);
        }
        if ( typeof value === 'string' ) {
            const numeric = Number(value);
            return Number.isFinite(numeric);
        }
        return false;
    }
}
