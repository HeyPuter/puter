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

import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import { insufficientCreditsError } from '../../../../services/metering/enforcement.js';
import type { AiMeteringService } from '../../../util/aiCostFactor.js';
import { klingImageInput, klingRequest } from '../../../util/kling.js';
import {
    CONTENT_FILTER_PATTERN,
    isTransientUpstreamError,
    sanitizeUpstreamMessage,
} from '../../../util/upstreamErrors.js';
import {
    closestAspectRatio,
    formatAspectRatio,
} from '../../imageDimensions.js';
import { assertImagePrompt } from '../../imageValidation.js';
import type { IGenerateParams, IImageProvider } from '../../types.js';
import {
    KLING_IMAGE_GENERATION_MODELS,
    type KlingImageModel,
} from './models.js';

const DEFAULT_MODEL = 'kling-v3';
const MAX_PROMPT_CHARS = 2500;
const POLL_INTERVAL_MS = 2_000;
const POLL_WINDOW_MS = 5 * 60 * 1000;

type KlingImageConfig = {
    apiKey: string;
    apiBaseUrl?: string;
    /** Test hook: polling cadence for task status checks. */
    pollIntervalMs?: number;
};

interface KlingImageTask {
    task_id: string;
    task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
    task_status_msg?: string;
    task_result?: { images?: Array<{ url?: string }> };
}

const badRequest = (message: string) =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

/**
 * Kling AI image generation (Image 3.0, 3.0 Omni, O1, 2.1).
 *
 * Kling's image API is task-based: the create call returns a task id, which is
 * polled until it settles. Billed per image at the resolution tier's rate.
 * https://kling.ai/document-api/api/image/3-0-omni/image-generation
 */
export class KlingImageProvider implements IImageProvider {
    #apiKey: string;
    #baseUrl: string | undefined;
    #pollIntervalMs: number;
    #meteringService: AiMeteringService;

    constructor(config: KlingImageConfig, meteringService: AiMeteringService) {
        if (!config.apiKey) {
            throw new Error('Kling image generation requires an API key');
        }
        this.#apiKey = config.apiKey;
        this.#baseUrl = config.apiBaseUrl?.replace(/\/$/, '');
        this.#pollIntervalMs = config.pollIntervalMs ?? POLL_INTERVAL_MS;
        this.#meteringService = meteringService;
    }

    models(): KlingImageModel[] {
        return KLING_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel(): string {
        return DEFAULT_MODEL;
    }

    async generate(params: IGenerateParams): Promise<string> {
        const {
            prompt,
            test_mode: testMode,
            quality,
            negative_prompt,
        } = params;
        const model = this.#getModel(params.model);

        if (testMode) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        assertImagePrompt(prompt);
        if (prompt.length > MAX_PROMPT_CHARS) {
            throw badRequest(
                `Kling takes a prompt of at most ${MAX_PROMPT_CHARS} characters`,
            );
        }

        const inputs = (
            params.input_images?.length
                ? params.input_images
                : params.input_image
                  ? [params.input_image]
                  : []
        ).map(klingImageInput);
        if (inputs.length > model.maxInputImages) {
            throw badRequest(
                `${model.id} accepts at most ${model.maxInputImages} input image(s)`,
            );
        }

        const tier = this.#tier(quality, model);
        const costKey =
            inputs.length > 0 && model.costs[`${tier}:image-to-image`]
                ? `${tier}:image-to-image`
                : tier;
        const cents = model.costs[costKey];
        const usageType = `kling-image-generation:${model.id}:${costKey}`;

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        }
        const hold = await this.#meteringService.reserveAiCredits(
            actor,
            usageType,
            Math.round(cents * 1_000_000),
        );
        if (!hold) throw insufficientCreditsError();

        try {
            const aspectRatio = params.imageSize
                ? formatAspectRatio(
                      closestAspectRatio(
                          params.imageSize,
                          model.allowedRatios!,
                      ),
                  )
                : inputs.length > 0 && model.autoRatio
                  ? 'auto'
                  : '1:1';
            const body: Record<string, unknown> = {
                model_name: model.id,
                prompt,
                n: 1,
                resolution: tier,
                aspect_ratio: aspectRatio,
            };
            if (model.endpoint === 'omni-image') {
                if (inputs.length > 0) {
                    body.image_list = inputs.map((image) => ({ image }));
                }
            } else if (inputs.length > 0) {
                body.image = inputs[0];
            } else if (
                typeof negative_prompt === 'string' &&
                negative_prompt.trim()
            ) {
                // Kling takes a negative prompt only without a reference image.
                body.negative_prompt = negative_prompt;
            }

            const path = `/v1/images/${model.endpoint}`;
            const created = await klingRequest<KlingImageTask>(
                this.#apiKey,
                'POST',
                path,
                { body, baseUrl: this.#baseUrl },
            );
            const task = await this.#pollUntilSettled(path, created, () =>
                this.#meteringService.incrementUsage(
                    actor,
                    usageType,
                    1,
                    Math.round(cents * 1_000_000),
                ),
            );
            if (task.task_status !== 'succeed') {
                throw this.#taskFailure(task.task_status_msg);
            }
            const url = task.task_result?.images?.[0]?.url;
            if (!url) {
                throw new Error('Kling response did not include an image URL');
            }

            await this.#meteringService.incrementUsage(
                actor,
                usageType,
                1,
                Math.round(cents * 1_000_000),
            );
            return url;
        } finally {
            await hold.release();
        }
    }

    /**
     * Polls until the task settles. A client disconnect doesn't stop it, since
     * Kling bills the task either way; one that outlives the window is metered
     * through `onTimeout`.
     */
    async #pollUntilSettled(
        path: string,
        created: KlingImageTask,
        onTimeout: () => Promise<unknown>,
    ): Promise<KlingImageTask> {
        const deadline = Date.now() + POLL_WINDOW_MS;
        let task = created;
        while (
            task.task_status === 'submitted' ||
            task.task_status === 'processing'
        ) {
            if (Date.now() > deadline) {
                await onTimeout();
                throw new HttpError(
                    504,
                    'Timed out waiting for Kling image generation to complete',
                    {
                        legacyCode: 'upstream_timeout',
                        fields: { provider: 'kling' },
                    },
                );
            }
            await new Promise((resolve) =>
                setTimeout(resolve, this.#pollIntervalMs),
            );
            try {
                task = await klingRequest<KlingImageTask>(
                    this.#apiKey,
                    'GET',
                    `${path}/${encodeURIComponent(created.task_id)}`,
                    { baseUrl: this.#baseUrl },
                );
            } catch (err) {
                // A missed poll is not a failed task.
                if (!isTransientUpstreamError(err)) throw err;
            }
        }
        return task;
    }

    /**
     * A content-policy refusal is the caller's to act on; anything else
     * Kling's.
     */
    #taskFailure(message: string | undefined): HttpError {
        const detail =
            sanitizeUpstreamMessage(message ?? '') ||
            'Kling image generation failed';
        const fields = { provider: 'kling' };
        if (CONTENT_FILTER_PATTERN.test(detail)) {
            return new HttpError(400, detail, {
                legacyCode: 'bad_request',
                code: 'moderation_flagged',
                fields,
            });
        }
        return new HttpError(502, detail, {
            legacyCode: 'upstream_failed',
            fields,
        });
    }

    /** Kling's `1k` / `2k` / `4k`, accepting other providers' quality names. */
    #tier(quality: string | undefined, model: KlingImageModel): string {
        const allowed = model.allowedQualityLevels!;
        const wanted = (quality ?? '').trim().toLowerCase();
        const synonym: Record<string, string> = {
            low: '1k',
            medium: '1k',
            high: '2k',
            hd: '2k',
        };
        const tier = allowed.includes(wanted) ? wanted : synonym[wanted];
        return tier && allowed.includes(tier) ? tier : allowed[0];
    }

    #getModel(model?: string): KlingImageModel {
        const wanted = (model ?? '').trim().toLowerCase();
        return (
            KLING_IMAGE_GENERATION_MODELS.find(
                (m) =>
                    m.id === wanted ||
                    m.puterId === wanted ||
                    m.aliases?.includes(wanted),
            ) ??
            KLING_IMAGE_GENERATION_MODELS.find((m) => m.id === DEFAULT_MODEL)!
        );
    }
}
