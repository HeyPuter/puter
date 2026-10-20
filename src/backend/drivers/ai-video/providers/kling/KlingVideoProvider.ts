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

import type { Actor } from '../../../../core/actor.js';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { AiMeteringService } from '../../../util/aiCostFactor.js';
import { isHttpUrl } from '../../../util/imageInput.js';
import { klingImageInput, klingRequest } from '../../../util/kling.js';
import {
    type MediaInputDeps,
    signedPuterVideoUrl,
} from '../../../util/mediaInput.js';
import { capSecondsToRemainingCredits } from '../../creditCap.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { VideoProvider } from '../VideoProvider.js';
import {
    pollUntilSettled,
    VIDEO_HOLD_TTL_MS,
    videoJobFailure,
} from '../polling.js';
import {
    KLING_VIDEO_GENERATION_MODELS,
    KLING_VIDEO_SPECS,
    type KlingVideoSpec,
} from './models.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const DEFAULT_MODEL = 'kling-3.0-turbo';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/** A Puter file Kling fetches itself as the source video. */
export const KLING_MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const ASPECT_RATIOS = ['16:9', '9:16', '1:1'];

type KlingVideoConfig = {
    apiKey: string;
    apiBaseUrl?: string;
    /** Test hook: polling cadence for task status checks. */
    pollIntervalMs?: number;
};

interface KlingTask {
    id: string;
    status: 'submitted' | 'processing' | 'succeeded' | 'failed';
    message?: string;
    outputs?: Array<{ type?: string; url?: string; duration?: string }>;
}

const badRequest = (message: string) =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

const present = (value: unknown): boolean =>
    value !== undefined && value !== null;

/** Kling's wording when it can't decode the source video of an edit. */
const SOURCE_DECODE_FAILURE_PATTERN = /VideoNormalize|ffmpeg/i;

const sourceUnreadableError = () =>
    new HttpError(
        400,
        "Kling couldn't read the source video. Re-save it as a standard, non-fragmented MP4 and try again",
        {
            legacyCode: 'upstream_bad_request',
            fields: { provider: 'kling' },
        },
    );

/**
 * Kling AI video generation (Kling 3.0, 3.0 Omni, O1, 2.6, 2.5 Turbo).
 *
 * Each model has its own create path; a task id comes back and is polled on
 * `/tasks` until it leaves submitted/processing. Billing is per second of
 * output at a rate set by resolution, native audio and whether a source video
 * is edited. An edit renders as long as its source, so it is held at the
 * longest source Kling accepts and billed for the clip it returns.
 * https://kling.ai/document-api/api/video/3-0-omni/text-to-video
 */
export class KlingVideoProvider extends VideoProvider {
    #apiKey: string;
    #baseUrl: string | undefined;
    #pollIntervalMs: number;
    #meteringService: AiMeteringService;
    #files: MediaInputDeps;

    constructor(
        config: KlingVideoConfig,
        meteringService: AiMeteringService,
        files: MediaInputDeps,
    ) {
        super();
        if (!config.apiKey) {
            throw new Error('Kling video generation requires an API key');
        }
        this.#apiKey = config.apiKey;
        this.#baseUrl = config.apiBaseUrl?.replace(/\/$/, '');
        this.#pollIntervalMs =
            config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.#meteringService = meteringService;
        this.#files = files;
    }

    getDefaultModel(): string {
        return DEFAULT_MODEL;
    }

    models(): IVideoModel[] {
        return KLING_VIDEO_GENERATION_MODELS;
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
            generate_audio: generateAudio,
            input_reference: inputReference,
            last_frame: lastFrame,
            reference_images: referenceImages,
            input_video: inputVideo,
            test_mode: testMode,
        } = params ?? {};

        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw badRequest('prompt must be a non-empty string');
        }
        const model = this.#getModel(requestedModel);
        const spec = KLING_VIDEO_SPECS[model.id];

        const resolutionKey = this.#resolution(size ?? resolution, model);
        const firstFrame = this.#image(inputReference, 'input_reference');
        const maxPromptChars =
            firstFrame && !spec.omniPath && spec.maxImagePromptChars
                ? spec.maxImagePromptChars
                : spec.maxPromptChars;
        if (prompt.length > maxPromptChars) {
            throw badRequest(
                `${model.id} takes a prompt of at most ${maxPromptChars} characters${maxPromptChars < spec.maxPromptChars ? ' with input_reference' : ''}`,
            );
        }
        const endFrame = this.#image(lastFrame, 'last_frame');
        const references = this.#references(referenceImages);
        const hasVideo = present(inputVideo);
        if (
            hasVideo &&
            (typeof inputVideo !== 'string' || !inputVideo.trim())
        ) {
            throw badRequest(
                'input_video must be a video URL or Puter file path',
            );
        }
        if (hasVideo && (inputVideo as string).startsWith('data:')) {
            throw badRequest(
                `${model.id} takes input_video as a URL or Puter file path, not a data URI`,
            );
        }
        const audio = this.#audio(
            spec,
            model.id,
            resolutionKey,
            generateAudio,
            {
                hasVideo,
            },
        );
        this.#checkInputs(spec, model.id, resolutionKey, audio, {
            firstFrame,
            endFrame,
            references,
            hasVideo,
        });

        if (testMode) {
            return DEFAULT_TEST_VIDEO_URL;
        }

        const actor = Context.get('actor') as Actor | undefined;
        if (!actor) {
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        }

        const costKey = `per-second:${resolutionKey}${
            hasVideo ? ':video-input' : audio === 'native' ? ':audio' : ''
        }`;
        const centsPerSecond = model.costs?.[costKey];
        if (!centsPerSecond) {
            throw new Error(
                `No pricing configured for video model ${model.id} at ${costKey}`,
            );
        }
        const usageType = `kling-video-generation:${model.id}:${costKey}`;

        // An edit is as long as its source, so it must cover the longest one,
        // in the whole seconds it's billed in.
        const editSeconds = hasVideo
            ? Math.ceil(spec.maxSourceSeconds!)
            : undefined;
        const firstFrameOnly =
            firstFrame !== undefined &&
            endFrame === undefined &&
            references.length === 0 &&
            spec.firstFrameOnlySeconds;
        const allowedSeconds = editSeconds
            ? [editSeconds]
            : firstFrameOnly || model.durationSeconds;
        const requestedSeconds =
            editSeconds ??
            this.#coerceSeconds(seconds ?? duration) ??
            model.durationSeconds![0];
        const { seconds: cappedSeconds, hold } =
            await capSecondsToRemainingCredits({
                metering: this.#meteringService,
                actor,
                usageType,
                perSecondMicroCents: centsPerSecond * 1_000_000,
                requestedSeconds,
                allowedSeconds,
            });

        try {
            const sourceVideo = hasVideo
                ? await this.#sourceVideo(actor, inputVideo as string)
                : undefined;
            const { path, body } = this.#buildRequest(spec, {
                prompt,
                resolutionKey,
                audio,
                seconds: cappedSeconds,
                aspectRatio: this.#aspectRatio(width, height),
                firstFrame,
                endFrame,
                references,
                sourceVideo,
            });

            const created = await klingRequest<KlingTask>(
                this.#apiKey,
                'POST',
                path,
                { body, baseUrl: this.#baseUrl },
            );
            const task = await this.#pollUntilComplete(created.id);
            if (
                task.status !== 'succeeded' &&
                sourceVideo &&
                SOURCE_DECODE_FAILURE_PATTERN.test(task.message ?? '')
            ) {
                throw sourceUnreadableError();
            }
            if (task.status !== 'succeeded') {
                throw videoJobFailure(
                    'kling',
                    task.message || 'Kling video generation failed',
                );
            }

            const video = task.outputs?.find(
                (output) => output.type === 'video' && output.url,
            );
            if (!video?.url) {
                throw new Error('Kling response did not include a video URL');
            }

            // Kling bills whole seconds of the clip it returns: an edit's
            // length comes from its source, everything else from the request.
            const outputSeconds = Number.parseFloat(video.duration ?? '');
            const billedSeconds =
                hasVideo && Number.isFinite(outputSeconds) && outputSeconds > 0
                    ? Math.max(1, Math.round(outputSeconds))
                    : cappedSeconds;
            await this.#meteringService.incrementUsage(
                actor,
                usageType,
                billedSeconds,
                Math.round(billedSeconds * centsPerSecond * 1_000_000),
            );

            return video.url;
        } finally {
            await hold.release();
        }
    }

    #buildRequest(
        spec: KlingVideoSpec,
        input: {
            prompt: string;
            resolutionKey: string;
            audio: 'native' | 'original' | 'off' | undefined;
            seconds: number;
            aspectRatio: string | undefined;
            firstFrame?: string;
            endFrame?: string;
            references: string[];
            sourceVideo?: string;
        },
    ): { path: string; body: Record<string, unknown> } {
        const settings: Record<string, unknown> = {
            resolution: input.resolutionKey,
        };
        if (input.audio) settings.audio = input.audio;
        // An edit renders as long as its source and takes no duration.
        if (!input.sourceVideo) settings.duration = input.seconds;
        const options = { watermark_info: { enabled: false } };

        if (spec.omniPath) {
            const contents: Array<Record<string, unknown>> = [
                { type: 'prompt', text: input.prompt },
            ];
            if (input.firstFrame) {
                contents.push({ type: 'first_frame', url: input.firstFrame });
            }
            if (input.endFrame) {
                contents.push({ type: 'last_frame', url: input.endFrame });
            }
            for (const url of input.references) {
                contents.push({ type: 'refer_image', url });
            }
            if (input.sourceVideo) {
                contents.push({ type: 'base_video', url: input.sourceVideo });
                // Multi-shot output is not available when editing.
                settings.multi_shot = false;
            }
            if (!input.firstFrame && !input.sourceVideo) {
                settings.aspect_ratio = input.aspectRatio ?? '16:9';
            }
            return {
                path: spec.omniPath,
                body: { contents, settings, options },
            };
        }

        if (input.firstFrame) {
            const contents: Array<Record<string, unknown>> = [
                { type: 'prompt', text: input.prompt },
                { type: 'first_frame', url: input.firstFrame },
            ];
            if (input.endFrame) {
                contents.push({ type: 'last_frame', url: input.endFrame });
            }
            return {
                path: spec.imagePath!,
                body: { contents, settings, options },
            };
        }

        settings.aspect_ratio = input.aspectRatio ?? '16:9';
        return {
            path: spec.textPath!,
            body: { prompt: input.prompt, settings, options },
        };
    }

    /**
     * The `audio` setting to send, or undefined for models without the switch.
     * Native audio is off unless asked for; an edit keeps its source's sound
     * unless `generate_audio` is false.
     */
    #audio(
        spec: KlingVideoSpec,
        modelId: string,
        resolutionKey: string,
        generateAudio: boolean | undefined,
        { hasVideo }: { hasVideo: boolean },
    ): 'native' | 'original' | 'off' | undefined {
        if (hasVideo) return generateAudio === false ? 'off' : 'original';
        if (spec.audio === 'always') return undefined;
        if (generateAudio !== true) {
            return spec.audio === 'none' && !spec.omniPath ? undefined : 'off';
        }
        if (spec.audio === 'none') {
            throw badRequest(`${modelId} does not generate audio`);
        }
        if (spec.audio === '1080p' && resolutionKey !== '1080p') {
            throw badRequest(`${modelId} generates audio only at 1080p`);
        }
        return 'native';
    }

    #checkInputs(
        spec: KlingVideoSpec,
        modelId: string,
        resolutionKey: string,
        audio: string | undefined,
        inputs: {
            firstFrame?: string;
            endFrame?: string;
            references: string[];
            hasVideo: boolean;
        },
    ) {
        const { firstFrame, endFrame, references, hasVideo } = inputs;
        if (endFrame && !firstFrame) {
            throw badRequest(
                'last_frame requires a first-frame image via input_reference',
            );
        }
        if (endFrame) {
            if (!spec.lastFrame) {
                throw badRequest(`${modelId} does not support last_frame`);
            }
            if (spec.lastFrame === '1080p' && resolutionKey !== '1080p') {
                throw badRequest(
                    `${modelId} supports last_frame only at 1080p`,
                );
            }
            if (spec.lastFrame === '1080p' && audio === 'native') {
                throw badRequest(
                    `${modelId} can't generate audio with a last_frame`,
                );
            }
        }
        if (hasVideo && (firstFrame || endFrame)) {
            throw badRequest(
                'input_video cannot be combined with input_reference or last_frame',
            );
        }
        if (
            spec.framePairExcludesReferences &&
            endFrame &&
            references.length > 0
        ) {
            throw badRequest(
                `${modelId} can't combine reference_images with a last_frame`,
            );
        }
        if (references.length > 0) {
            const max = hasVideo
                ? spec.maxReferenceImagesWithVideo
                : spec.maxReferenceImages;
            if (max === 0) {
                throw badRequest(
                    `${modelId} does not support reference_images`,
                );
            }
            if (references.length > max) {
                throw badRequest(
                    `${modelId} accepts at most ${max} reference image(s)${hasVideo ? ' with input_video' : ''}`,
                );
            }
        }
    }

    /**
     * The source video as Kling takes it: a web URL as given, and a Puter file
     * as a short-lived signed URL Kling fetches.
     */
    async #sourceVideo(actor: Actor, input: string): Promise<string> {
        if (isHttpUrl(input)) return input;
        return signedPuterVideoUrl(this.#files, actor, input, {
            maxBytes: KLING_MAX_VIDEO_BYTES,
            expiresInSeconds: VIDEO_HOLD_TTL_MS / 1000,
        });
    }

    async #pollUntilComplete(taskId: string): Promise<KlingTask> {
        return pollUntilSettled<KlingTask>({
            provider: 'kling',
            providerLabel: 'Kling',
            intervalMs: this.#pollIntervalMs,
            fetch: async () => {
                const tasks = await klingRequest<KlingTask[]>(
                    this.#apiKey,
                    'GET',
                    `/tasks?task_ids=${encodeURIComponent(taskId)}`,
                    { baseUrl: this.#baseUrl },
                );
                const task = Array.isArray(tasks)
                    ? tasks.find((t) => t?.id === taskId)
                    : undefined;
                // A task the query doesn't list yet is still pending.
                return task ?? { id: taskId, status: 'submitted' };
            },
            isPending: (task) =>
                task.status === 'submitted' || task.status === 'processing',
        });
    }

    #getModel(requestedModel?: string): IVideoModel {
        const wanted = (requestedModel ?? '').trim().toLowerCase();
        return (
            KLING_VIDEO_GENERATION_MODELS.find(
                (m) =>
                    m.id === wanted ||
                    m.puterId === wanted ||
                    m.aliases?.includes(wanted),
            ) ??
            KLING_VIDEO_GENERATION_MODELS.find((m) => m.id === DEFAULT_MODEL)!
        );
    }

    #resolution(candidate: unknown, model: IVideoModel): string {
        const tiers = model.dimensions ?? ['720p'];
        if (typeof candidate === 'string') {
            const wanted = candidate.trim().toLowerCase();
            if (tiers.includes(wanted)) return wanted;
        }
        return tiers[0];
    }

    #image(value: unknown, label: string): string | undefined {
        if (!present(value)) return undefined;
        if (typeof value !== 'string' || !value.trim()) {
            throw badRequest(
                `${label} must be an image URL, data URI or base64`,
            );
        }
        return klingImageInput(value);
    }

    #references(value: unknown): string[] {
        if (!present(value)) return [];
        if (!Array.isArray(value)) {
            throw badRequest('reference_images must be an array');
        }
        return value.map((image) => this.#image(image, 'reference_images')!);
    }

    #coerceSeconds(value: unknown): number | undefined {
        const numeric =
            typeof value === 'string' ? Number.parseInt(value, 10) : value;
        return typeof numeric === 'number' &&
            Number.isFinite(numeric) &&
            numeric > 0
            ? Math.round(numeric)
            : undefined;
    }

    /** Snap width/height to one of Kling's aspect ratios. */
    #aspectRatio(width?: number, height?: number): string | undefined {
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
        const w = Math.round(width);
        const h = Math.round(height);
        const d = gcd(w, h) || 1;
        const candidate = `${w / d}:${h / d}`;
        // Other ratios are left to Kling's 16:9 default.
        return ASPECT_RATIOS.includes(candidate) ? candidate : undefined;
    }
}
