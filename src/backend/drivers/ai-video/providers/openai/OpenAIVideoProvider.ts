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

import OpenAI from 'openai';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { VideoProvider } from '../VideoProvider.js';
import { OPENAI_VIDEO_MODELS, OPENAI_VIDEO_ALLOWED_SECONDS } from './models.js';
import { Readable } from 'stream';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_DURATION_SECONDS = 4;

export class OpenAIVideoProvider extends VideoProvider {
    #openai: OpenAI;
    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        super();
        if (!config.apiKey) {
            throw new Error('OpenAI video generation requires an API key');
        }
        this.#openai = new OpenAI({ apiKey: config.apiKey });
        this.#meteringService = meteringService;
    }

    getDefaultModel(): string {
        return OPENAI_VIDEO_MODELS[0].id;
    }

    async models(): Promise<IVideoModel[]> {
        return OPENAI_VIDEO_MODELS;
    }

    async generate(params: IGenerateVideoParams): Promise<unknown> {
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

        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw new HttpError(400, 'prompt must be a non-empty string');
        }

        const selectedModel = await this.#selectModel(requestedModel);

        if (!selectedModel) {
            throw new HttpError(400, `Unknown video model: ${requestedModel}`, {
                legacyCode: 'bad_request',
            });
        }

        if (testMode) {
            return DEFAULT_TEST_VIDEO_URL;
        }

        const defaultSize = selectedModel.dimensions?.[0] ?? '720x1280';
        const normalizedSize =
            this.#normalizeSize(size ?? resolution, selectedModel) ??
            defaultSize;
        const normalizedSeconds =
            this.#normalizeSeconds(seconds ?? duration) ??
            String(DEFAULT_DURATION_SECONDS);

        const sizeTier = this.#determineSizeTier(selectedModel, normalizedSize);
        const costPerSecondCents = this.#getCostPerSecond(
            selectedModel,
            sizeTier,
        );

        if (!costPerSecondCents) {
            throw new Error(
                `No pricing configured for model ${selectedModel.id} at size ${normalizedSize}`,
            );
        }

        const estimatedUnits =
            this.#parseSeconds(normalizedSeconds) ?? DEFAULT_DURATION_SECONDS;
        const actor = Context.get('actor');
        const costInMicroCents = costPerSecondCents * 1_000_000;
        const usageAllowed = await this.#meteringService.hasEnoughCredits(
            actor,
            costInMicroCents * estimatedUnits,
        );
        if (!usageAllowed) {
            throw new HttpError(402, 'Insufficient funds');
        }

        const createParams: OpenAI.VideoCreateParams = {
            prompt,
            model: selectedModel.id,
            seconds: normalizedSeconds as OpenAI.VideoSeconds,
            size: normalizedSize as OpenAI.VideoSize,
        };

        if (inputReference) {
            createParams.input_reference =
                inputReference as OpenAI.VideoCreateParams['input_reference'];
        }

        const createResponse = await this.#openai.videos.create(createParams);
        const finalJob = await this.#pollUntilComplete(createResponse);

        if (finalJob.status === 'failed') {
            const errorMessage =
                finalJob.error?.message ?? 'Video generation failed';
            throw new Error(errorMessage);
        }

        const finalResolution =
            this.#normalizeSize(finalJob.size, selectedModel) ?? normalizedSize;
        const finalTier = this.#determineSizeTier(
            selectedModel,
            finalResolution,
        );
        const finalCostPerSecondCents = this.#getCostPerSecond(
            selectedModel,
            finalTier,
        );

        if (!finalCostPerSecondCents) {
            throw new Error(
                `No pricing configured for model ${selectedModel.id} at size ${finalResolution}`,
            );
        }

        const finalCostInMicroCents = finalCostPerSecondCents * 1_000_000;
        const actualSeconds =
            this.#parseSeconds(finalJob.seconds) ?? estimatedUnits;

        const downloadResponse = await this.#openai.videos.downloadContent(
            finalJob.id,
        );
        const contentType =
            downloadResponse.headers.get('content-type') ?? 'video/mp4';

        let stream: any = downloadResponse.body;
        if (stream && typeof stream.getReader === 'function') {
            stream = Readable.fromWeb(stream as any);
        }

        if (!stream) {
            const arrayBuffer = await downloadResponse.arrayBuffer();
            stream = Readable.from(Buffer.from(arrayBuffer));
        }

        const finalUsageKey = this.#getUsageKey(selectedModel, finalTier);
        await this.#meteringService.incrementUsage(
            actor,
            finalUsageKey,
            actualSeconds,
            finalCostInMicroCents * actualSeconds,
        );

        return {
            stream,
            content_type: contentType,
        };
    }

    async #selectModel(
        requestedModel?: string,
    ): Promise<IVideoModel | undefined> {
        const allModels = await this.models();
        return allModels.find(
            (m) => m.id.toLowerCase() === requestedModel?.toLowerCase(),
        );
    }

    async #pollUntilComplete(initialJob: OpenAI.Video): Promise<OpenAI.Video> {
        let job = initialJob;
        const start = Date.now();

        while (job.status === 'queued' || job.status === 'in_progress') {
            if (Date.now() - start > DEFAULT_TIMEOUT_MS) {
                throw new Error(
                    'Timed out waiting for Sora video generation to complete',
                );
            }

            await this.#delay(POLL_INTERVAL_MS);
            job = await this.#openai.videos.retrieve(job.id);
        }

        return job;
    }

    async #delay(ms: number): Promise<void> {
        return await new Promise((resolve) => setTimeout(resolve, ms));
    }

    #normalizeSize(candidate: unknown, model: IVideoModel): string | undefined {
        if (!candidate) return undefined;
        const normalized = this.#normalizeResolution(candidate);
        if (normalized && model.dimensions?.includes(normalized)) {
            return normalized;
        }
        return undefined;
    }

    #normalizeSeconds(value: unknown): string | undefined {
        if (value === null || value === undefined) {
            return undefined;
        }
        const parsed =
            typeof value === 'number'
                ? String(Math.round(value))
                : typeof value === 'string'
                  ? value.trim()
                  : undefined;
        if (
            parsed &&
            OPENAI_VIDEO_ALLOWED_SECONDS.includes(
                Number(parsed) as (typeof OPENAI_VIDEO_ALLOWED_SECONDS)[number],
            )
        ) {
            return parsed;
        }
        return undefined;
    }

    #determineSizeTier(model: IVideoModel, size: string): string {
        if (model.id === 'sora-2-pro') {
            if (size === '1080x1920' || size === '1920x1080') return 'xxl';
            if (size === '1024x1792' || size === '1792x1024') return 'xl';
        }
        return 'default';
    }

    #getCostPerSecond(model: IVideoModel, tier: string): number | undefined {
        const key = tier === 'default' ? 'per-second' : `per-second-${tier}`;
        return model.costs?.[key];
    }

    #getUsageKey(model: IVideoModel, tier: string): string {
        return `openai:${model.id}:${tier}`;
    }

    #normalizeResolution(value: unknown): string | undefined {
        if (!value) return undefined;
        if (typeof value === 'string') {
            const match = value.match(/(\d+)\s*x\s*(\d+)/i);
            if (match) {
                const w = Number.parseInt(match[1], 10);
                const h = Number.parseInt(match[2], 10);
                if (Number.isFinite(w) && Number.isFinite(h)) {
                    return `${w}x${h}`;
                }
            }
        }
        return undefined;
    }

    #parseSeconds(value: unknown): number | undefined {
        if (value === null || value === undefined) return undefined;
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.round(value);
        }
        if (typeof value === 'string') {
            const numeric = Number.parseInt(value, 10);
            return Number.isFinite(numeric) ? numeric : undefined;
        }
        return undefined;
    }
}
