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
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { capSecondsToRemainingCredits } from '../../creditCap.js';
import { VideoProvider } from '../VideoProvider.js';
import {
    BYTEPLUS_VIDEO_GENERATION_MODELS,
    BYTEPLUS_VIDEO_SPECS,
    type BytePlusVideoSpec,
} from './models.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MODEL = 'dreamina-seedance-2-0-mini-260615';
// Seedance 2.0 multimodal reference accepts up to 9 reference images.
const MAX_REFERENCE_IMAGES = 9;

const ARK_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];

type BytePlusVideoConfig = {
    apiKey: string;
    apiBaseUrl?: string;
    /** Test hook — polling cadence for task status checks. */
    pollIntervalMs?: number;
};

interface ArkVideoTask {
    id: string;
    status:
        'queued' | 'running' | 'cancelled' | 'succeeded' | 'failed' | 'expired';
    content?: { video_url?: string };
    usage?: { completion_tokens?: number; total_tokens?: number };
    resolution?: string;
    duration?: number;
    error?: { code?: string; message?: string } | null;
}

/**
 * BytePlus ModelArk video generation provider (Seedance).
 *
 * Ark's video API is task-based rather than OpenAI-shaped: POST
 * `/contents/generations/tasks` returns a task id, which is then polled via GET
 * until it leaves queued/running. Billing is per video token (≈ duration ×
 * width × height × fps / 1024) with the authoritative count in the final task's
 * `usage.completion_tokens`.
 * https://docs.byteplus.com/en/docs/ModelArk/1520757
 */
export class BytePlusVideoProvider extends VideoProvider {
    #apiKey: string;
    #baseUrl: string;
    #pollIntervalMs: number;
    #meteringService: MeteringService;

    constructor(config: BytePlusVideoConfig, meteringService: MeteringService) {
        super();
        if (!config.apiKey) {
            throw new Error('BytePlus video generation requires an API key');
        }
        this.#apiKey = config.apiKey;
        this.#baseUrl = (config.apiBaseUrl ?? DEFAULT_BASE_URL).replace(
            /\/$/,
            '',
        );
        this.#pollIntervalMs =
            config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.#meteringService = meteringService;
    }

    getDefaultModel(): string {
        return DEFAULT_MODEL;
    }

    async models(): Promise<IVideoModel[]> {
        return BYTEPLUS_VIDEO_GENERATION_MODELS;
    }

    async generate(params: IGenerateVideoParams): Promise<unknown> {
        const {
            prompt,
            model: requestedModel,
            seconds,
            duration,
            size,
            resolution,
            width,
            height,
            seed,
            generate_audio: generateAudio,
            input_reference: inputReference,
            last_frame: lastFrame,
            reference_images: referenceImages,
            test_mode: testMode,
        } = params ?? {};

        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw new HttpError(400, 'prompt must be a non-empty string', {
                legacyCode: 'bad_request',
            });
        }

        const model = this.#getModel(requestedModel);
        const spec = BYTEPLUS_VIDEO_SPECS[model.id];

        if (testMode) {
            return DEFAULT_TEST_VIDEO_URL;
        }

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        }

        const resolutionKey = this.#normalizeResolution(
            size ?? resolution,
            model,
        );
        // Audio is priced in for 1.5 Pro, so always send an explicit value to
        // keep billing deterministic; Ark's own default is true.
        const audioOn = spec.supportsAudio && generateAudio !== false;
        const costKey = this.#costKey(model, resolutionKey, audioOn);
        const centsPerToken = model.costs?.[costKey];
        if (!centsPerToken) {
            throw new Error(
                `No pricing configured for video model ${model.id} at ${resolutionKey}`,
            );
        }

        const dims = spec.dims[resolutionKey];
        const tokensPerSecond = (dims.w * dims.h * 24) / 1024;
        const perSecondMicroCents = tokensPerSecond * centsPerToken * 1_000_000;

        const requestedSeconds = Math.min(
            this.#coerceSeconds(seconds ?? duration) ?? spec.duration.default,
            spec.duration.max,
        );
        // `durationSeconds` enumerates the model's whole-second range, so a
        // sub-minimum request rounds up to the shortest supported clip rather
        // than being rejected as unaffordable.
        const cappedSeconds = await capSecondsToRemainingCredits({
            metering: this.#meteringService,
            actor,
            perSecondMicroCents,
            requestedSeconds,
            allowedSeconds: model.durationSeconds,
            modelId: model.id,
        });

        const body: Record<string, unknown> = {
            model: model.id,
            content: this.#buildContent(prompt, spec, model.id, {
                inputReference,
                lastFrame,
                referenceImages,
            }),
            resolution: resolutionKey === '4k' ? '4K' : resolutionKey,
            duration: cappedSeconds,
            watermark: false,
        };
        if (spec.supportsAudio) {
            body.generate_audio = audioOn;
        }
        const ratio = this.#deriveRatio(width, height);
        if (ratio) {
            body.ratio = ratio;
        }
        if (
            spec.supportsSeed &&
            typeof seed === 'number' &&
            Number.isFinite(seed)
        ) {
            body.seed = Math.round(seed);
        }

        const task = await this.#createTask(body);
        const finalTask = await this.#pollUntilComplete(task.id);

        if (finalTask.status !== 'succeeded') {
            const errorMessage =
                finalTask.error?.message ??
                `Video generation ${finalTask.status}`;
            // Ark's `failed` covers both user-input issues (content
            // moderation) and upstream outages — same ambiguity as the
            // Together provider, so expose it the same way: a 400 with
            // `upstream_failed` that the alarm gate skips.
            throw new HttpError(400, errorMessage, {
                legacyCode: 'upstream_failed',
                fields: { provider: 'byteplus' },
            });
        }

        const videoUrl = finalTask.content?.video_url;
        if (typeof videoUrl !== 'string' || !videoUrl.trim()) {
            throw new Error('BytePlus response did not include a video URL');
        }

        // Bill the tokens the task actually reports; fall back to the
        // pre-flight estimate if usage is missing.
        const finalResolutionKey = this.#normalizeResolution(
            finalTask.resolution,
            model,
            resolutionKey,
        );
        const finalCostKey = this.#costKey(model, finalResolutionKey, audioOn);
        const finalCentsPerToken = model.costs?.[finalCostKey] ?? centsPerToken;
        const tokens =
            finalTask.usage?.completion_tokens ??
            Math.round(tokensPerSecond * cappedSeconds);
        await this.#meteringService.incrementUsage(
            actor,
            `byteplus-video-generation:${model.id}:${finalCostKey}`,
            tokens,
            tokens * finalCentsPerToken * 1_000_000,
        );

        return videoUrl;
    }

    #buildContent(
        prompt: string,
        spec: BytePlusVideoSpec,
        modelId: string,
        images: {
            inputReference?: unknown;
            lastFrame?: string;
            referenceImages?: string[];
        },
    ): Array<Record<string, unknown>> {
        const { inputReference, lastFrame, referenceImages } = images;
        const content: Array<Record<string, unknown>> = [
            { type: 'text', text: prompt },
        ];

        const firstFrame =
            typeof inputReference === 'string' && inputReference.trim()
                ? inputReference
                : undefined;
        const hasReferenceImages =
            Array.isArray(referenceImages) && referenceImages.length > 0;

        // Ark treats first/last-frame and reference-image generation as
        // mutually exclusive scenarios.
        if (hasReferenceImages && (firstFrame || lastFrame)) {
            throw new HttpError(
                400,
                'reference_images cannot be combined with input_reference/last_frame',
                { legacyCode: 'bad_request' },
            );
        }

        if (hasReferenceImages) {
            if (!spec.supportsReferenceImages) {
                throw new HttpError(
                    400,
                    `${modelId} does not support reference_images`,
                    { legacyCode: 'bad_request' },
                );
            }
            if (referenceImages!.length > MAX_REFERENCE_IMAGES) {
                throw new HttpError(
                    400,
                    `${modelId} accepts at most ${MAX_REFERENCE_IMAGES} reference image(s)`,
                    { legacyCode: 'bad_request' },
                );
            }
            for (const img of referenceImages!) {
                if (typeof img !== 'string' || !img.trim()) continue;
                content.push({
                    type: 'image_url',
                    image_url: { url: img },
                    role: 'reference_image',
                });
            }
            return content;
        }

        if (lastFrame && !firstFrame) {
            throw new HttpError(
                400,
                'last_frame requires a first-frame image via input_reference',
                { legacyCode: 'bad_request' },
            );
        }
        if (firstFrame) {
            content.push({
                type: 'image_url',
                image_url: { url: firstFrame },
                ...(lastFrame ? { role: 'first_frame' } : {}),
            });
        }
        if (lastFrame) {
            if (!spec.supportsLastFrame) {
                throw new HttpError(
                    400,
                    `${modelId} does not support last_frame`,
                    { legacyCode: 'bad_request' },
                );
            }
            content.push({
                type: 'image_url',
                image_url: { url: lastFrame },
                role: 'last_frame',
            });
        }

        return content;
    }

    async #createTask(body: Record<string, unknown>): Promise<ArkVideoTask> {
        return (await this.#request('POST', '/contents/generations/tasks', {
            body,
        })) as ArkVideoTask;
    }

    async #pollUntilComplete(taskId: string): Promise<ArkVideoTask> {
        const start = Date.now();
        for (;;) {
            const task = (await this.#request(
                'GET',
                `/contents/generations/tasks/${taskId}`,
            )) as ArkVideoTask;
            if (task.status !== 'queued' && task.status !== 'running') {
                return task;
            }
            if (Date.now() - start > DEFAULT_TIMEOUT_MS) {
                throw new Error(
                    'Timed out waiting for BytePlus video generation to complete',
                );
            }
            await this.#delay(this.#pollIntervalMs);
        }
    }

    async #request(
        method: string,
        path: string,
        opts: { body?: Record<string, unknown> } = {},
    ): Promise<unknown> {
        const response = await fetch(`${this.#baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.#apiKey}`,
                ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        });
        const payload = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
        >;
        if (!response.ok) {
            const message =
                ((payload.error as Record<string, unknown>)
                    ?.message as string) ??
                `BytePlus video API error (status ${response.status})`;
            throw new HttpError(response.status >= 500 ? 502 : 400, message, {
                legacyCode: 'upstream_failed',
                fields: { provider: 'byteplus' },
            });
        }
        return payload;
    }

    async #delay(ms: number): Promise<void> {
        return await new Promise((resolve) => setTimeout(resolve, ms));
    }

    #getModel(requestedModel?: string): IVideoModel {
        const wanted = (requestedModel ?? '').trim().toLowerCase();
        const found = BYTEPLUS_VIDEO_GENERATION_MODELS.find(
            (m) =>
                m.id === wanted ||
                m.puterId === wanted ||
                m.aliases?.some((a) => a.toLowerCase() === wanted),
        );
        return (
            found ??
            BYTEPLUS_VIDEO_GENERATION_MODELS.find(
                (m) => m.id === DEFAULT_MODEL,
            )!
        );
    }

    /** '480p' | '720p' | '1080p' | '4k', falling back to the model default. */
    #normalizeResolution(
        candidate: unknown,
        model: IVideoModel,
        fallback?: string,
    ): string {
        const spec = BYTEPLUS_VIDEO_SPECS[model.id];
        if (typeof candidate === 'string') {
            const normalized = candidate.trim().toLowerCase();
            // The shared `dims` table covers a whole model family, so gate on
            // what this model actually advertises — otherwise e.g. 1080p on a
            // 480p/720p-only model reaches Ark just to be rejected there.
            const supported = model.dimensions!.some(
                (d) => d.toLowerCase() === normalized,
            );
            if (supported && spec.dims[normalized]) return normalized;
        }
        return fallback ?? model.dimensions![0].toLowerCase();
    }

    #costKey(
        model: IVideoModel,
        resolutionKey: string,
        audioOn: boolean,
    ): string {
        const costs = model.costs ?? {};
        if (costs[`video_tokens:${resolutionKey}`] !== undefined) {
            return `video_tokens:${resolutionKey}`;
        }
        const audioKey = audioOn ? 'video_tokens:audio' : 'video_tokens:silent';
        if (costs[audioKey] !== undefined) {
            return audioKey;
        }
        return 'video_tokens';
    }

    #coerceSeconds(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) {
            const rounded = Math.round(value);
            return rounded > 0 ? rounded : undefined;
        }
        if (typeof value === 'string') {
            const numeric = Number.parseInt(value, 10);
            return Number.isFinite(numeric) && numeric > 0
                ? numeric
                : undefined;
        }
        return undefined;
    }

    /** Snap width/height to one of Ark's supported aspect-ratio strings. */
    #deriveRatio(width?: number, height?: number): string | undefined {
        if (
            typeof width !== 'number' ||
            typeof height !== 'number' ||
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width <= 0 ||
            height <= 0
        ) {
            return undefined;
        }
        const gcd = (a: number, b: number): number =>
            b === 0 ? a : gcd(b, a % b);
        const d = gcd(Math.round(width), Math.round(height)) || 1;
        const candidate = `${Math.round(width) / d}:${Math.round(height) / d}`;
        // Unsupported ratios are omitted so Ark's `adaptive` default applies.
        return ARK_RATIOS.includes(candidate) ? candidate : undefined;
    }
}
