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
import OpenAI from 'openai';
import { VideoCreateParams } from 'openai/resources';
import { Readable } from 'stream';
import APIError from '../../../../../api/APIError.js';
import { Context } from '../../../../../util/context.js';
import { TypedValue } from '../../../../drivers/meta/Runtime.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { OPENAI_VIDEO_ALLOWED_SECONDS, OPENAI_VIDEO_ALLOWED_SIZES, OPENAI_VIDEO_MODELS } from './models.js';
import { IVideoGenerateParams, IVideoModel, IVideoProvider } from '../types.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 5_000;

export class OpenAiVideoGenerationProvider implements IVideoProvider {
    #meteringService: MeteringService;
    #client: OpenAI;

    constructor (config: { apiKey: string }, meteringService: MeteringService) {
        this.#client = new OpenAI({
            apiKey: config.apiKey,
        });
        this.#meteringService = meteringService;
    }

    models (): IVideoModel[] {
        return OPENAI_VIDEO_MODELS;
    }

    getDefaultModel (): string {
        return OPENAI_VIDEO_MODELS[0].id;
    }

    async generate (params: IVideoGenerateParams) {
        const {
            prompt,
            model: requestedModel,
            duration,
            seconds,
            size,
            resolution,
            input_reference: inputReference,
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

        const normalizedSize = this.#normalizeSize(size ?? resolution) ?? OPENAI_VIDEO_ALLOWED_SIZES[0];
        const normalizedSeconds = this.#normalizeSeconds(seconds ?? duration) ?? OPENAI_VIDEO_ALLOWED_SECONDS[0].toString();

        const usageKey = this.#determineUsageKey(selectedModel, normalizedSize);
        const estimatedUnits = this.#parseSeconds(normalizedSeconds) ?? 0;
        const actor = Context.get('actor');
        const usageAllowed = await this.#meteringService.hasEnoughCreditsFor(actor, usageKey as any, estimatedUnits);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const createParams = {
            model: selectedModel.id,
            prompt,
            seconds: normalizedSeconds,
            size: normalizedSize,
            ...rest,
        } as VideoCreateParams;

        if ( inputReference ) {
            createParams.input_reference = inputReference;
        }

        const createResponse = await this.#client.videos.create(createParams);
        const finalJob = await this.#pollUntilComplete(createResponse);

        if ( finalJob.status === 'failed' ) {
            const errorMessage = finalJob.error?.message ?? 'Video generation failed';
            throw new Error(errorMessage);
        }

        const finalResolution = this.#normalizeSize(finalJob.size) ?? normalizedSize;
        const finalUsageKey = this.#determineUsageKey(selectedModel, finalResolution);
        const actualSeconds = this.#parseSeconds(finalJob.seconds) ?? estimatedUnits;

        const downloadResponse = await this.#client.videos.downloadContent(finalJob.id);
        const contentType = downloadResponse.headers.get('content-type') ?? 'video/mp4';

        const body = downloadResponse.body as unknown;
        let stream: Readable;

        if ( body instanceof Readable ) {
            stream = body;
        } else if ( body && typeof (body as any).getReader === 'function' ) {
            stream = Readable.fromWeb(body as any);
        } else {
            const arrayBuffer = await downloadResponse.arrayBuffer();
            stream = Readable.from(Buffer.from(arrayBuffer));
        }

        this.#meteringService.incrementUsage(actor, finalUsageKey as any, actualSeconds);

        return new TypedValue({
            $: 'stream',
            content_type: contentType,
        }, stream);
    }

    #selectModel (requestedModel?: string): IVideoModel {
        const models = this.models();
        const match = models.find(m => m.id === requestedModel) ?? models[0];
        return match;
    }

    async #pollUntilComplete (initialJob: any) {
        let job = initialJob;
        const start = Date.now();

        while ( job.status === 'queued' || job.status === 'in_progress' ) {
            if ( Date.now() - start > DEFAULT_TIMEOUT_MS ) {
                throw new Error('Timed out waiting for Sora video generation to complete');
            }

            await this.#delay(POLL_INTERVAL_MS);
            job = await this.#client.videos.retrieve(job.id);
        }

        return job;
    }

    async #delay (ms: number) {
        return await new Promise(resolve => setTimeout(resolve, ms));
    }

    #normalizeSize (candidate?: unknown) {
        if ( ! candidate ) return undefined;
        const normalized = this.#normalizeResolution(candidate);
        if ( normalized && OPENAI_VIDEO_ALLOWED_SIZES.includes(normalized as typeof OPENAI_VIDEO_ALLOWED_SIZES[number]) ) {
            return normalized;
        }
        return undefined;
    }

    #normalizeSeconds (value?: unknown) {
        if ( value === null || value === undefined ) {
            return undefined;
        }
        const parsed = typeof value === 'string' ? value.trim() : value.toString();
        if ( OPENAI_VIDEO_ALLOWED_SECONDS.includes(Number(parsed) as typeof OPENAI_VIDEO_ALLOWED_SECONDS[number]) ) {
            return parsed;
        }
        return undefined;
    }

    #determineUsageKey (model: IVideoModel, size: string) {
        if ( model.id === 'sora-2-pro' && (size === '1280x720' || size === '720x1280') ) {
            return 'openai:sora-2-pro:xl';
        }
        return model.defaultUsageKey ?? `openai:${model.id}:default`;
    }

    #parseSeconds (value?: unknown) {
        if ( typeof value === 'number' && Number.isFinite(value) ) {
            return Math.round(value);
        }
        if ( typeof value === 'string' ) {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
    }

    #normalizeResolution (value: unknown): string | undefined {
        if ( typeof value !== 'string' ) return undefined;
        const trimmed = value.trim();
        const match = trimmed.match(/^(\d+)[xX](\d+)$/);
        if ( ! match ) return undefined;
        const [, w, h] = match;
        return `${Number.parseInt(w, 10)}x${Number.parseInt(h, 10)}`;
    }
}
