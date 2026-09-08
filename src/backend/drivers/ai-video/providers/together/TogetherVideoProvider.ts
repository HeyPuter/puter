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

import { Together } from 'together-ai';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { capSecondsToRemainingCredits } from '../../creditCap.js';
import { VideoProvider } from '../VideoProvider.js';
import { pollUntilSettled, videoJobFailure } from '../polling.js';
import {
    TOGETHER_VIDEO_GENERATION_MODELS,
    type ITogetherVideoModel,
} from './models.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MODEL = 'minimax/video-01-director';
const DEFAULT_DURATION_SECONDS = 6;

// Resolution tiers ('720p', '1080P') mark models that size their output
// through `resolution` (+ `ratio`) rather than width/height.
const isResolutionTier = (value: string): boolean => /^\d{3,4}p$/i.test(value);

// The SDK's create params trail the API: `resolution`, `ratio` and
// `generate_audio` are documented request fields it does not type yet.
type TogetherCreatePayload = Together.VideoCreateParams & {
    metadata?: object;
    resolution?: string;
    ratio?: string;
    generate_audio?: boolean;
};

export class TogetherVideoProvider extends VideoProvider {
    #client: Together;
    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        super();
        if (!config.apiKey) {
            throw new Error('Together AI video generation requires an API key');
        }
        // Bounds each create/retrieve call; a slow poll is retried by the
        // loop rather than failing the job.
        this.#client = new Together({
            apiKey: config.apiKey,
            timeout: REQUEST_TIMEOUT_MS,
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel(): string {
        return 'togetherai:minimax/video-01-director';
    }

    async models(): Promise<IVideoModel[]> {
        return TOGETHER_VIDEO_GENERATION_MODELS.map((model) => ({
            ...model,
            aliases: [model.model],
            durationSeconds: model.durationSeconds ?? undefined,
            dimensions: model.dimensions ?? undefined,
            fps: model.fps ?? undefined,
            keyframes: model.keyframes ?? undefined,
            promptLength: model.promptLength ?? undefined,
            promptSupported: model.promptSupported ?? undefined,
        }));
    }

    async generate(params: IGenerateVideoParams): Promise<unknown> {
        const {
            prompt,
            model: requestedModel,
            seconds,
            no_extra_params,
            duration,
            size,
            resolution,
            width,
            height,
            fps,
            steps,
            guidance_scale: guidanceScale,
            seed,
            output_format: outputFormat,
            output_quality: outputQuality,
            negative_prompt: negativePrompt,
            generate_audio: generateAudio,
            reference_images: referenceImages,
            frame_images: frameImages,
            input_reference: inputReference,
            last_frame: lastFrame,
            metadata,
            test_mode: testMode,
        } = params ?? {};

        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw new HttpError(400, 'prompt must be a non-empty string', {
                legacyCode: 'bad_request',
            });
        }

        const selectedModel = this.#getModel(requestedModel);
        const model =
            selectedModel?.model ??
            this.#stripTogetherPrefix(requestedModel ?? DEFAULT_MODEL);

        if (testMode) {
            return DEFAULT_TEST_VIDEO_URL;
        }

        const costs = selectedModel?.costs ?? {};
        const resolutionTier = this.#resolveResolutionTier(
            size ?? resolution,
            selectedModel,
        );
        const perSecondCents =
            (resolutionTier !== undefined
                ? costs[`per-second-${resolutionTier.toLowerCase()}`]
                : undefined) ?? costs['per-second'];
        const perVideoCents = costs['per-video'];
        if (!perSecondCents && !perVideoCents) {
            throw new Error(`No pricing configured for video model ${model}`);
        }

        let normalizedSeconds = this.#coercePositiveInteger(
            seconds ?? duration,
        );

        if (!no_extra_params) {
            normalizedSeconds ??= DEFAULT_DURATION_SECONDS;
        }

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        }

        // Per-second models are clamped to what the balance buys, like Veo
        // and Seedance; per-clip models stay all-or-nothing.
        let estimateMicroCents: number;
        let billedUnits: number;
        if (perSecondCents) {
            normalizedSeconds = await capSecondsToRemainingCredits({
                metering: this.#meteringService,
                actor,
                perSecondMicroCents: perSecondCents * 1_000_000,
                requestedSeconds: normalizedSeconds ?? DEFAULT_DURATION_SECONDS,
                allowedSeconds: selectedModel?.durationSeconds,
                modelId: model,
            });
            estimateMicroCents = Math.round(
                perSecondCents * 1_000_000 * normalizedSeconds,
            );
            billedUnits = normalizedSeconds;
        } else {
            estimateMicroCents = perVideoCents! * 1_000_000;
            const usageAllowed = await this.#meteringService.hasEnoughCredits(
                actor,
                estimateMicroCents,
            );
            if (!usageAllowed) {
                throw new HttpError(402, 'Insufficient funds', {
                    legacyCode: 'insufficient_funds',
                });
            }
            billedUnits = 1;
        }

        const createPayload: TogetherCreatePayload = {
            prompt,
            model,
        };

        if (normalizedSeconds) {
            createPayload.seconds = String(normalizedSeconds);
        }
        if (resolutionTier !== undefined) {
            createPayload.resolution = resolutionTier;
            const ratio = this.#deriveRatio(
                width,
                height,
                selectedModel?.ratios,
            );
            if (ratio) {
                createPayload.ratio = ratio;
            }
        } else {
            if (this.#isFiniteNumber(width)) {
                createPayload.width = Number(width);
            }
            if (this.#isFiniteNumber(height)) {
                createPayload.height = Number(height);
            }
        }
        if (this.#isFiniteNumber(fps)) {
            createPayload.fps = Number(fps);
        }
        if (this.#isFiniteNumber(steps)) {
            createPayload.steps = Number(steps);
        }
        if (this.#isFiniteNumber(guidanceScale)) {
            createPayload.guidance_scale = Number(guidanceScale);
        }
        if (this.#isFiniteNumber(seed)) {
            createPayload.seed = Number(seed);
        }
        if (typeof outputFormat === 'string' && outputFormat.trim()) {
            createPayload.output_format =
                outputFormat.trim() as Together.VideoCreateParams['output_format'];
        }
        if (this.#isFiniteNumber(outputQuality)) {
            createPayload.output_quality = Number(outputQuality);
        }
        if (typeof negativePrompt === 'string' && negativePrompt.trim()) {
            createPayload.negative_prompt = negativePrompt;
        }
        if (typeof generateAudio === 'boolean') {
            createPayload.generate_audio = generateAudio;
        }
        if (Array.isArray(referenceImages) && referenceImages.length > 0) {
            createPayload.reference_images = referenceImages.filter(
                (item: string) =>
                    typeof item === 'string' && item.trim().length > 0,
            );
        }
        if (Array.isArray(frameImages) && frameImages.length > 0) {
            createPayload.frame_images = frameImages.filter(
                (frame: any) =>
                    frame &&
                    typeof frame === 'object' &&
                    typeof frame.input_image === 'string',
            ) as Together.VideoCreateParams['frame_images'];
        } else {
            // `input_reference` / `last_frame` are the cross-provider names
            // for Together's keyframes; an explicit `frame_images` wins.
            const keyframes = [
                [inputReference, 'first'],
                [lastFrame, 'last'],
            ]
                .filter(([image]) => typeof image === 'string' && image.trim())
                .map(([image, frame]) => ({
                    input_image: (image as string).trim(),
                    frame,
                }));
            if (keyframes.length > 0) {
                createPayload.frame_images =
                    keyframes as unknown as Together.VideoCreateParams['frame_images'];
            }
        }
        if (metadata && typeof metadata === 'object') {
            createPayload.metadata = metadata;
        }

        const job = await this.#client.videos.create(createPayload);
        const finalJob = await this.#pollUntilComplete(job.id);

        if (finalJob.status === 'failed') {
            const errorMessage =
                finalJob?.error?.message ??
                finalJob?.info?.errors?.[0]?.message ??
                finalJob?.info?.errors?.message ??
                finalJob?.info?.errors ??
                'Video generation failed';
            throw videoJobFailure(
                'together',
                typeof errorMessage === 'string'
                    ? errorMessage
                    : JSON.stringify(errorMessage),
                finalJob?.error?.code,
            );
        }

        if (finalJob.status === 'cancelled') {
            throw videoJobFailure('together', 'Video generation was cancelled');
        }

        // Together reports what it actually charged for the job; the catalog
        // rate above was only the pre-flight estimate.
        const reportedCost = finalJob?.outputs?.cost;
        const costMicroCents =
            typeof reportedCost === 'number' &&
            Number.isFinite(reportedCost) &&
            reportedCost >= 0
                ? Math.round(reportedCost * 100 * 1_000_000)
                : estimateMicroCents;

        const usageKey = `together-video:${model}`;
        await this.#meteringService.incrementUsage(
            actor,
            usageKey,
            billedUnits,
            costMicroCents,
        );

        const videoUrl = finalJob?.outputs?.video_url;
        if (typeof videoUrl === 'string' && videoUrl.trim()) {
            return videoUrl;
        }

        throw new Error('Together AI response did not include a video URL');
    }

    async #pollUntilComplete(jobId: string): Promise<any> {
        // any here because sdk types are wrong https://docs.together.ai/docs/videos-overview -> "Job Status Reference"
        return await pollUntilSettled<any>({
            provider: 'together',
            providerLabel: 'Together AI',
            intervalMs: POLL_INTERVAL_MS,
            fetch: () => (this.#client as any).videos.retrieve(jobId),
            isPending: (job) =>
                job.status === 'queued' || job.status === 'in_progress',
        });
    }

    #getModel(requestedModel?: string): ITogetherVideoModel | undefined {
        const bareModel = this.#stripTogetherPrefix(
            requestedModel ?? DEFAULT_MODEL,
        );
        return TOGETHER_VIDEO_GENERATION_MODELS.find(
            (m) => m.model.toLowerCase() === bareModel.toLowerCase(),
        );
    }

    #stripTogetherPrefix(model: string): string {
        if (typeof model === 'string' && model.startsWith('togetherai:')) {
            return model.slice('togetherai:'.length);
        }
        return model;
    }

    /**
     * The catalog spelling of the requested tier, or the model's default tier;
     * undefined for models sized by width/height.
     */
    #resolveResolutionTier(
        candidate: unknown,
        model?: ITogetherVideoModel,
    ): string | undefined {
        const tiers = (model?.dimensions ?? []).filter(isResolutionTier);
        if (tiers.length === 0) return undefined;
        if (typeof candidate === 'string') {
            const wanted = candidate.trim().toLowerCase();
            const match = tiers.find((t) => t.toLowerCase() === wanted);
            if (match) return match;
        }
        return tiers[0];
    }

    /** Snap width/height to one of the model's `ratio` strings. */
    #deriveRatio(
        width?: number,
        height?: number,
        ratios?: string[] | null,
    ): string | undefined {
        if (
            !ratios?.length ||
            !this.#isFiniteNumber(width) ||
            !this.#isFiniteNumber(height)
        ) {
            return undefined;
        }
        const w = Math.round(Number(width));
        const h = Math.round(Number(height));
        if (w <= 0 || h <= 0) return undefined;
        const gcd = (a: number, b: number): number =>
            b === 0 ? a : gcd(b, a % b);
        const d = gcd(w, h) || 1;
        const candidate = `${w / d}:${h / d}`;
        return ratios.includes(candidate) ? candidate : undefined;
    }

    #coercePositiveInteger(value: unknown): number | undefined {
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

    #isFiniteNumber(value: unknown): boolean {
        if (typeof value === 'number') {
            return Number.isFinite(value);
        }
        if (typeof value === 'string') {
            const numeric = Number(value);
            return Number.isFinite(numeric);
        }
        return false;
    }
}
