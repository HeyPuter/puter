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
const { Readable } = require('stream');

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_DURATION_SECONDS = 4;
const DEFAULT_SIZE = '720x1280';
const ALLOWED_SIZES = new Set(['720x1280', '1280x720', '1024x1792', '1792x1024']);
const ALLOWED_SECONDS = new Set(['4', '8', '12']);

class OpenAIVideoGenerationService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService(){
        return this.services.get('meteringService').meteringService;
    }

    static MODULES = {
        openai: require('openai'),
    };

    _construct() {
        this.models_ = {
            'sora-2': {
                defaultUsageKey: 'openai:sora-2:default',
            },
            'sora-2-pro': {
                defaultUsageKey: 'openai:sora-2-pro:default',
            },
        };
    }

    async _init() {
        let apiKey =
            this.config?.services?.openai?.apiKey ??
            this.global_config?.services?.openai?.apiKey;

        if ( !apiKey ) {
            apiKey =
                this.config?.openai?.secret_key ??
                this.global_config.openai?.secret_key;

            console.warn('The `openai.secret_key` configuration format is deprecated. ' +
                'Please use `services.openai.apiKey` instead.');
        }

        this.openai = new this.modules.openai.OpenAI({
            apiKey,
        });
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
            duration,
            seconds,
            size,
            resolution,
            input_reference: inputReference,
            test_mode: testMode,
        } = params ?? {};

        if ( typeof prompt !== 'string' || !prompt.trim() ) {
            throw APIError.create('field_invalid', null, {
                key: 'prompt',
                expected: 'a non-empty string',
                got: prompt,
            });
        }

        const model = requestedModel ?? 'sora-2';
        const modelConfig = this.models_[model];
        if ( !modelConfig ) {
            throw APIError.create('field_invalid', null, {
                key: 'model',
                expected: 'one of: ' + Object.keys(this.models_).join(', '),
                got: model,
            });
        }

        if ( testMode ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'video',
            }, DEFAULT_TEST_VIDEO_URL);
        }

        const normalizedSize = this.#normalizeSize(size ?? resolution) ?? DEFAULT_SIZE;
        const normalizedSeconds = this.#normalizeSeconds(seconds ?? duration) ?? '4';

        const usageKey = this.#determineUsageKey(model, normalizedSize);
        if ( !usageKey ) {
            throw new Error(`Unsupported pricing tier for model ${model}`);
        }

        const estimatedUnits = this.#parseSeconds(normalizedSeconds) ?? DEFAULT_DURATION_SECONDS;
        const actor = Context.get('actor');
        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageKey, estimatedUnits);
        if ( !usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const createParams = {
            model,
            prompt,
            seconds: normalizedSeconds,
            size: normalizedSize,
        };

        if ( inputReference ) {
            createParams.input_reference = inputReference;
        }

        const createResponse = await this.openai.videos.create(createParams);
        const finalJob = await this.#pollUntilComplete(createResponse);

        if ( finalJob.status === 'failed' ) {
            const errorMessage = finalJob.error?.message ?? 'Video generation failed';
            throw new Error(errorMessage);
        }

        const finalResolution = this.#normalizeSize(finalJob.size) ?? normalizedSize;
        const finalUsageKey = this.#determineUsageKey(model, finalResolution);
        if ( !finalUsageKey ) {
            throw new Error(`Unsupported pricing tier for model ${model}`);
        }

        const actualSeconds = this.#parseSeconds(finalJob.seconds) ?? estimatedUnits;

        const downloadResponse = await this.openai.videos.downloadContent(finalJob.id);
        const contentType = downloadResponse.headers.get('content-type') ?? 'video/mp4';

        let stream = downloadResponse.body;
        if ( stream && typeof stream.getReader === 'function' ) {
            stream = Readable.fromWeb(stream);
        }

        if ( !stream ) {
            const arrayBuffer = await downloadResponse.arrayBuffer();
            stream = Readable.from(Buffer.from(arrayBuffer));
        }

        this.meteringService.incrementUsage(actor, finalUsageKey, actualSeconds);

        return new TypedValue({
            $: 'stream',
            content_type: contentType,
        }, stream);
    }

    async #pollUntilComplete(initialJob) {
        let job = initialJob;
        const start = Date.now();

        while ( job.status === 'queued' || job.status === 'in_progress' ) {
            if ( Date.now() - start > DEFAULT_TIMEOUT_MS ) {
                throw new Error('Timed out waiting for Sora video generation to complete');
            }

            await this.#delay(POLL_INTERVAL_MS);
            job = await this.openai.videos.retrieve(job.id);
        }

        return job;
    }

    async #delay(ms) {
        return await new Promise(resolve => setTimeout(resolve, ms));
    }

    #normalizeSize(candidate) {
        if ( !candidate ) return undefined;
        const normalized = this.#normalizeResolution(candidate);
        if ( normalized && ALLOWED_SIZES.has(normalized) ) {
            return normalized;
        }
        return undefined;
    }

    #normalizeSeconds(value) {
        if ( value === null || value === undefined ) {
            return undefined;
        }

        if ( typeof value === 'number' && Number.isFinite(value) ) {
            const rounded = String(Math.round(value));
            return ALLOWED_SECONDS.has(rounded) ? rounded : undefined;
        }

        if ( typeof value === 'string' ) {
            const trimmed = value.trim();
            if ( ALLOWED_SECONDS.has(trimmed) ) {
                return trimmed;
            }
            const numeric = Number.parseInt(trimmed, 10);
            if ( Number.isFinite(numeric) ) {
                const normalized = String(numeric);
                return ALLOWED_SECONDS.has(normalized) ? normalized : undefined;
            }
        }

        return undefined;
    }

    #determineUsageKey(model, normalizedSize) {
        const config = this.models_[model];
        if ( !config ) return null;

        if ( model === 'sora-2-pro' && normalizedSize === '1792x1024' ) {
            return 'openai:sora-2-pro:xl';
        }

        return config.defaultUsageKey;
    }

    #normalizeResolution(value) {
        if ( !value ) return undefined;
        if ( typeof value === 'string' ) {
            const match = value.match(/(\\d+)\\s*x\\s*(\\d+)/i);
            if ( match ) {
                const width = Number.parseInt(match[1], 10);
                const height = Number.parseInt(match[2], 10);
                if ( Number.isFinite(width) && Number.isFinite(height) ) {
                    const larger = Math.max(width, height);
                    const smaller = Math.min(width, height);
                    return `${larger}x${smaller}`;
                }
            }
        }
        return undefined;
    }

    #parseSeconds(value) {
        if ( value === null || value === undefined ) return undefined;
        if ( typeof value === 'number' && Number.isFinite(value) ) {
            return value;
        }
        if ( typeof value === 'string' ) {
            const numeric = Number.parseInt(value, 10);
            if ( Number.isFinite(numeric) ) {
                return numeric;
            }
        }
        return undefined;
    }
}

module.exports = {
    OpenAIVideoGenerationService,
};
