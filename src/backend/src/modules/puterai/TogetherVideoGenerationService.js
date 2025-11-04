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
const APIError = require('../../api/APIError');
const BaseService = require('../../services/BaseService');
const { TypedValue } = require('../../services/drivers/meta/Runtime');
const { Context } = require('../../util/context');
const { Together } = require('together-ai');

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MODEL = 'minimax/video-01-director';
const DEFAULT_DURATION_SECONDS = 6;
const DEFAULT_USAGE_KEY = 'together-video:default';

class TogetherVideoGenerationService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService() {
        return this.services.get('meteringService').meteringService;
    }

    static MODULES = {};

    async _init() {
        const apiKey =
            this.config?.apiKey ??
            this.global_config?.services?.['together-ai']?.apiKey;

        if ( !apiKey ) {
            throw new Error('Together AI video generation requires an API key');
        }

        this.client = new Together({ apiKey });
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode(iface, method_name) {
                return iface === 'puter-video-generation' &&
                    method_name === 'generate';
            },
        },
        ['puter-video-generation']: {
            async generate(params) {
                return await this.generateVideo(params);
            },
        },
    };

    async generateVideo(params) {
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
        } = params ?? {};

        if ( typeof prompt !== 'string' || !prompt.trim() ) {
            throw APIError.create('field_invalid', null, {
                key: 'prompt',
                expected: 'a non-empty string',
                got: prompt,
            });
        }

        const model = requestedModel ?? DEFAULT_MODEL;

        if ( testMode ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'video',
            }, DEFAULT_TEST_VIDEO_URL);
        }

        const normalizedSeconds = this.#coercePositiveInteger(seconds ?? duration) ?? DEFAULT_DURATION_SECONDS;

        const actor = Context.get('actor');
        if ( !actor ) {
            throw new Error('actor not found in context');
        }

        const estimatedUsageUnits = 1; // Together video billing is per generated video
        const usageKey = this.#determineUsageKey(model);

        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageKey, estimatedUsageUnits);
        if ( !usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const createPayload = {
            prompt,
            model,
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

        const job = await this.client.videos.create(createPayload);
        const finalJob = await this.#pollUntilComplete(job.id);

        if ( finalJob.status === 'failed' ) {
            const errorMessage = finalJob?.info?.errors?.[0]?.message ??
                finalJob?.info?.errors?.message ??
                finalJob?.info?.errors ??
                'Video generation failed';
            throw new Error(errorMessage);
        }

        if ( finalJob.status === 'cancelled' ) {
            throw new Error('Video generation was cancelled');
        }

        this.meteringService.incrementUsage(actor, usageKey, 1);

        const videoUrl = finalJob?.outputs?.video_url;
        if ( typeof videoUrl === 'string' && videoUrl.trim() ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'video',
            }, videoUrl);
        }

        throw new Error('Together AI response did not include a video URL');
    }

    async #pollUntilComplete(jobId) {
        let job = await this.client.videos.retrieve(jobId);
        const start = Date.now();

        while ( job.status === 'queued' || job.status === 'in_progress' ) {
            if ( Date.now() - start > DEFAULT_TIMEOUT_MS ) {
                throw new Error('Timed out waiting for Together AI video generation to complete');
            }

            await this.#delay(POLL_INTERVAL_MS);
            job = await this.client.videos.retrieve(jobId);
        }

        return job;
    }

    async #delay(ms) {
        return await new Promise(resolve => setTimeout(resolve, ms));
    }

    #determineUsageKey(model) {
        if ( typeof model === 'string' && model.trim() ) {
            return `together-video:${model}`;
        }
        return DEFAULT_USAGE_KEY;
    }

    #coercePositiveInteger(value) {
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

    #isFiniteNumber(value) {
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

module.exports = {
    TogetherVideoGenerationService,
};
