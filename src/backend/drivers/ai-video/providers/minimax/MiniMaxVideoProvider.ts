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
import { insufficientCreditsError } from '../../../../services/metering/enforcement.js';
import type { CreditHold } from '../../../../services/metering/types.js';
import type { AiMeteringService } from '../../../util/aiCostFactor.js';
import { readBoundedBody } from '../../../util/fileInput.js';
import { toUrlOrDataUri } from '../../../util/imageInput.js';
import { sanitizeUpstreamMessage } from '../../../util/upstreamErrors.js';
import { capSecondsToRemainingCredits } from '../../creditCap.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { VideoProvider } from '../VideoProvider.js';
import {
    pollUntilSettled,
    VIDEO_HOLD_TTL_MS,
    videoJobFailure,
} from '../polling.js';
import {
    MINIMAX_VIDEO_GENERATION_MODELS,
    MINIMAX_VIDEO_SPECS,
    type MiniMaxVideoSpec,
} from './models.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const DEFAULT_BASE_URL = 'https://api.minimax.io';
const DEFAULT_MODEL = 'minimax-h3';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PROVIDER = 'minimax';

const ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const DEFAULT_ASPECT_RATIO = '16:9';

// MiniMax's business codes, from the trailing "(NNNN)" of a v2 error message
// or `base_resp.status_code` of a v1 reply.
// https://platform.minimax.io/docs/api-reference/errorcode
const AUTH_CODES = new Set([1004, 2049]);
const BALANCE_CODES = new Set([1008, 2053, 2056, 2067]);
const RATE_LIMIT_CODES = new Set([1002, 1039, 1041, 1045]);
const MODERATION_CODES = new Set([1026, 1027]);
const MODEL_UNAVAILABLE_CODES = new Set([2022, 2061, 2068, 2069]);
const INVALID_PARAM_CODES = new Set([2013, 2014]);
/** A 2013 about the model itself, which means the catalog has drifted. */
const UNSUPPORTED_MODEL_PATTERN =
    /this model is not supported|incorrect model param/i;

type MiniMaxVideoConfig = {
    apiKey: string;
    apiBaseUrl?: string;
    /** Test hook: polling cadence for task status checks. */
    pollIntervalMs?: number;
};

interface MiniMaxEnvelope {
    base_resp?: { status_code?: number; status_msg?: string };
    error?: { type?: string; message?: string; http_code?: string };
}

interface H3Task {
    id: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    content?: { url?: string };
    error?: { code?: string; message?: string };
    duration?: number;
    usage?: { output_seconds?: number };
}

interface HailuoTask {
    task_id?: string;
    status?: 'Preparing' | 'Queueing' | 'Processing' | 'Success' | 'Fail';
    file_id?: string;
}

const badRequest = (message: string) =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

const present = (value: unknown): boolean =>
    value !== undefined && value !== null;

const statusForCode = (code: number, httpStatus: number): number => {
    if (AUTH_CODES.has(code)) return 401;
    if (BALANCE_CODES.has(code)) return 402;
    if (RATE_LIMIT_CODES.has(code)) return 429;
    if (INVALID_PARAM_CODES.has(code)) return 400;
    return httpStatus >= 400 ? httpStatus : 502;
};

/** The code a v2 error message ends with, e.g. "invalid params (2013)". */
const parseCode = (message: string): number | undefined => {
    const match = message.match(/\((\d{4,5})\)\s*$/);
    return match ? Number.parseInt(match[1], 10) : undefined;
};

/** A request MiniMax refused, shaped for `translateProviderError`. */
const minimaxError = (
    code: number | undefined,
    message: string,
    status: number,
): Error => {
    // A model MiniMax doesn't serve is Puter's pick, so the catalog has
    // drifted from MiniMax's: our fault, not the caller's, and worth
    // someone's attention.
    if (
        code !== undefined &&
        (MODEL_UNAVAILABLE_CODES.has(code) ||
            (code === 2013 && UNSUPPORTED_MODEL_PATTERN.test(message)))
    ) {
        return new HttpError(
            502,
            'MiniMax does not support the model Puter requested',
            {
                legacyCode: 'upstream_failed',
                alarmSeverity: 'warning',
                fields: {
                    provider: PROVIDER,
                    upstreamCode: String(code),
                    upstreamMessage: sanitizeUpstreamMessage(message),
                },
            },
        );
    }
    if (code !== undefined && MODERATION_CODES.has(code)) {
        return new HttpError(
            400,
            sanitizeUpstreamMessage(message) ||
                'MiniMax rejected the request under its content policy',
            {
                legacyCode: 'bad_request',
                code: 'moderation_flagged',
                fields: { provider: PROVIDER, upstreamCode: String(code) },
            },
        );
    }
    // MiniMax's auth messages point at its own console; the caller can't act
    // on them.
    const isAuthFailure = code !== undefined && AUTH_CODES.has(code);
    return Object.assign(
        new Error(isAuthFailure ? 'MiniMax rejected the API key' : message),
        {
            status:
                code === undefined
                    ? status >= 400
                        ? status
                        : 502
                    : statusForCode(code, status),
            code: code === undefined ? undefined : String(code),
            provider: PROVIDER,
        },
    );
};

/**
 * MiniMax video generation (H3 and Hailuo).
 *
 * H3 models go through the v2 task API: a `content` list of text, frames and
 * references creates a task that is polled until it leaves queued/running, and
 * the clip's URL comes back on the task. Billing is per second of output at a
 * rate set by resolution. Hailuo models go through the v1 API, which takes a
 * prompt and frame images, is polled on its own status endpoint and hands back
 * a file id to exchange for a download URL. They are billed per clip, by
 * resolution and length.
 * https://platform.minimax.io/docs/api-reference/video-generation-v2-create
 */
export class MiniMaxVideoProvider extends VideoProvider {
    #apiKey: string;
    #baseUrl: string;
    #pollIntervalMs: number;
    #meteringService: AiMeteringService;

    constructor(
        config: MiniMaxVideoConfig,
        meteringService: AiMeteringService,
    ) {
        super();
        if (!config.apiKey) {
            throw new Error('MiniMax video generation requires an API key');
        }
        this.#apiKey = config.apiKey;
        // The shared chat block's base URL ends in the chat API's `/v1`; the
        // video API lives beside it on the same host.
        this.#baseUrl = (config.apiBaseUrl ?? DEFAULT_BASE_URL)
            .replace(/\/+$/, '')
            .replace(/\/v1$/, '');
        this.#pollIntervalMs =
            config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.#meteringService = meteringService;
    }

    getDefaultModel(): string {
        return DEFAULT_MODEL;
    }

    models(): IVideoModel[] {
        return MINIMAX_VIDEO_GENERATION_MODELS;
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
        const spec = MINIMAX_VIDEO_SPECS[model.id];
        if (prompt.length > spec.maxPromptChars) {
            throw badRequest(
                `${model.id} takes a prompt of at most ${spec.maxPromptChars} characters`,
            );
        }
        if (present(inputVideo)) {
            throw badRequest(`${model.id} does not accept a source video`);
        }

        const resolutionKey = this.#resolution(size ?? resolution, model);
        const firstFrame = this.#image(inputReference, 'input_reference');
        const endFrame = this.#image(lastFrame, 'last_frame');
        const references = this.#references(referenceImages);
        this.#checkInputs(spec, model, resolutionKey, {
            firstFrame,
            endFrame,
            references,
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

        const requestedSeconds =
            this.#coerceSeconds(seconds ?? duration) ??
            model.durationSeconds![0];
        const aspectRatio = this.#aspectRatio(width, height);
        const images = { firstFrame, endFrame, references };

        if (spec.api === 'v2') {
            return this.#generateH3(actor, model, spec, {
                prompt,
                resolutionKey,
                requestedSeconds,
                aspectRatio,
                ...images,
            });
        }
        return this.#generateHailuo(actor, model, spec, {
            prompt,
            resolutionKey,
            requestedSeconds,
            ...images,
        });
    }

    // -- H3 (v2 task API, per second) ---------------------------------------

    async #generateH3(
        actor: Actor,
        model: IVideoModel,
        spec: MiniMaxVideoSpec,
        input: {
            prompt: string;
            resolutionKey: string;
            requestedSeconds: number;
            aspectRatio: string | undefined;
            firstFrame?: string;
            endFrame?: string;
            references: string[];
        },
    ): Promise<string> {
        const costKey = `per-second:${input.resolutionKey}`;
        const centsPerSecond = model.costs?.[costKey];
        if (!centsPerSecond) {
            throw new Error(
                `No pricing configured for video model ${model.id} at ${costKey}`,
            );
        }
        const usageType = `minimax-video-generation:${model.id}:${costKey}`;
        const { seconds: cappedSeconds, hold } =
            await capSecondsToRemainingCredits({
                metering: this.#meteringService,
                actor,
                usageType,
                perSecondMicroCents: centsPerSecond * 1_000_000,
                requestedSeconds: input.requestedSeconds,
                allowedSeconds: model.durationSeconds,
            });

        try {
            const content: Array<Record<string, unknown>> = [
                { type: 'text', text: input.prompt },
            ];
            if (input.firstFrame) {
                content.push({
                    type: 'image_url',
                    image_url: { url: input.firstFrame },
                    role: 'first_frame',
                });
            }
            if (input.endFrame) {
                content.push({
                    type: 'image_url',
                    image_url: { url: input.endFrame },
                    role: 'last_frame',
                });
            }
            for (const url of input.references) {
                content.push({
                    type: 'image_url',
                    image_url: { url },
                    role: 'reference_image',
                });
            }
            const body: Record<string, unknown> = {
                model: spec.apiModel,
                content,
                duration: cappedSeconds,
                resolution: input.resolutionKey.toUpperCase(),
            };
            // A clip from frames takes their shape; MiniMax requires a ratio
            // for everything else.
            if (!input.firstFrame && !input.endFrame) {
                body.ratio = input.aspectRatio ?? DEFAULT_ASPECT_RATIO;
            }

            const created = await this.#request<{ task_id?: string }>(
                'POST',
                '/v2/video_generation',
                body,
            );
            if (!created.task_id) {
                throw new Error('MiniMax response did not include a task id');
            }
            const task = await pollUntilSettled<H3Task>({
                provider: PROVIDER,
                providerLabel: 'MiniMax',
                intervalMs: this.#pollIntervalMs,
                fetch: async () => {
                    const { task } = await this.#request<{ task?: H3Task }>(
                        'GET',
                        `/v2/query/video_generation/${encodeURIComponent(created.task_id!)}`,
                    );
                    if (!task) {
                        throw new Error('MiniMax task query returned no task');
                    }
                    return task;
                },
                isPending: (task) =>
                    task.status === 'queued' || task.status === 'running',
                onTimeout: () =>
                    this.#meteringService.incrementUsage(
                        actor,
                        usageType,
                        cappedSeconds,
                        Math.round(cappedSeconds * centsPerSecond * 1_000_000),
                    ),
            });
            if (task.status !== 'succeeded') {
                throw videoJobFailure(
                    PROVIDER,
                    task.error?.message || `Video generation ${task.status}`,
                    task.error?.code,
                );
            }
            const url = task.content?.url;
            if (typeof url !== 'string' || !url.trim()) {
                throw new Error('MiniMax response did not include a video URL');
            }

            // MiniMax bills the seconds of output the task reports.
            const outputSeconds = task.usage?.output_seconds ?? task.duration;
            const billedSeconds =
                typeof outputSeconds === 'number' &&
                Number.isFinite(outputSeconds) &&
                outputSeconds > 0
                    ? Math.max(1, Math.round(outputSeconds))
                    : cappedSeconds;
            await this.#meteringService.incrementUsage(
                actor,
                usageType,
                billedSeconds,
                Math.round(billedSeconds * centsPerSecond * 1_000_000),
            );
            return url;
        } finally {
            await hold.release();
        }
    }

    // -- Hailuo (v1 API, per clip) ------------------------------------------

    async #generateHailuo(
        actor: Actor,
        model: IVideoModel,
        spec: MiniMaxVideoSpec,
        input: {
            prompt: string;
            resolutionKey: string;
            requestedSeconds: number;
            firstFrame?: string;
            endFrame?: string;
        },
    ): Promise<string> {
        // A clip length the resolution doesn't offer falls back to the first
        // one it does, the way the driver treats any unsupported duration.
        const offered = (secs: number) =>
            model.costs?.[`per-video:${input.resolutionKey}:${secs}`];
        const clipSeconds = offered(input.requestedSeconds)
            ? input.requestedSeconds
            : model.durationSeconds!.find(offered)!;
        const costKey = `per-video:${input.resolutionKey}:${clipSeconds}`;
        const centsPerVideo = model.costs![costKey]!;
        const usageType = `minimax-video-generation:${model.id}:${costKey}`;
        const microCents = centsPerVideo * 1_000_000;
        const hold: CreditHold | null =
            await this.#meteringService.reserveAiCredits(
                actor,
                usageType,
                microCents,
                { ttlMs: VIDEO_HOLD_TTL_MS },
            );
        if (!hold) {
            throw insufficientCreditsError();
        }

        try {
            const body: Record<string, unknown> = {
                model: spec.apiModel,
                prompt: input.prompt,
                duration: clipSeconds,
                resolution: input.resolutionKey.toUpperCase(),
            };
            if (input.firstFrame) body.first_frame_image = input.firstFrame;
            if (input.endFrame) body.last_frame_image = input.endFrame;

            const created = await this.#request<{ task_id?: string }>(
                'POST',
                '/v1/video_generation',
                body,
            );
            if (!created.task_id) {
                throw new Error('MiniMax response did not include a task id');
            }
            const task = await pollUntilSettled<HailuoTask>({
                provider: PROVIDER,
                providerLabel: 'MiniMax',
                intervalMs: this.#pollIntervalMs,
                fetch: () =>
                    this.#request<HailuoTask>(
                        'GET',
                        `/v1/query/video_generation?task_id=${encodeURIComponent(created.task_id!)}`,
                    ),
                isPending: (task) =>
                    task.status === 'Preparing' ||
                    task.status === 'Queueing' ||
                    task.status === 'Processing',
                onTimeout: () =>
                    this.#meteringService.incrementUsage(
                        actor,
                        usageType,
                        1,
                        microCents,
                    ),
            });
            if (task.status !== 'Success' || !task.file_id) {
                throw videoJobFailure(
                    PROVIDER,
                    'MiniMax video generation failed',
                );
            }
            // The clip is a file in MiniMax's store; its download link is
            // minted on request and works for an hour.
            const { file } = await this.#request<{
                file?: { download_url?: string };
            }>(
                'GET',
                `/v1/files/retrieve?file_id=${encodeURIComponent(task.file_id)}`,
            );
            const url = file?.download_url;
            if (typeof url !== 'string' || !url.trim()) {
                throw new Error('MiniMax response did not include a video URL');
            }

            await this.#meteringService.incrementUsage(
                actor,
                usageType,
                1,
                microCents,
            );
            return url;
        } finally {
            await hold.release();
        }
    }

    // -- Validation ---------------------------------------------------------

    #checkInputs(
        spec: MiniMaxVideoSpec,
        model: IVideoModel,
        resolutionKey: string,
        inputs: {
            firstFrame?: string;
            endFrame?: string;
            references: string[];
        },
    ) {
        const { firstFrame, endFrame, references } = inputs;
        if (spec.firstFrameRequired && !firstFrame) {
            throw badRequest(`${model.id} requires an input_reference image`);
        }
        if (endFrame && !spec.lastFrame) {
            throw badRequest(`${model.id} does not support last_frame`);
        }
        if (endFrame && !firstFrame && spec.api === 'v1') {
            throw badRequest(
                'last_frame requires a first-frame image via input_reference',
            );
        }
        if (references.length > 0) {
            if (!spec.references) {
                throw badRequest(
                    `${model.id} does not support reference_images`,
                );
            }
            if (firstFrame || endFrame) {
                throw badRequest(
                    'reference_images cannot be combined with input_reference or last_frame',
                );
            }
        }
        const imageCount =
            (firstFrame ? 1 : 0) + (endFrame ? 1 : 0) + references.length;
        if (imageCount > spec.maxImages) {
            throw badRequest(
                `${model.id} takes at most ${spec.maxImages} image(s), frames and references together`,
            );
        }
        if (
            spec.imageOnlyResolutions?.includes(resolutionKey) &&
            (!firstFrame || endFrame)
        ) {
            throw badRequest(
                `${model.id} renders ${resolutionKey} only from an input_reference image without last_frame`,
            );
        }
    }

    async #request<T>(
        method: 'GET' | 'POST',
        path: string,
        body?: Record<string, unknown>,
    ): Promise<T> {
        const response = await fetch(`${this.#baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.#apiKey}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const raw = await readBoundedBody(response, MAX_RESPONSE_BYTES, () =>
            minimaxError(undefined, 'MiniMax response too large', 502),
        );
        let payload: MiniMaxEnvelope = {};
        try {
            const parsed: unknown = JSON.parse(raw.toString('utf8'));
            if (parsed && typeof parsed === 'object') {
                payload = parsed as MiniMaxEnvelope;
            }
        } catch {
            // Not JSON; the status alone decides.
        }
        // A v1 reply carries its verdict in `base_resp` under HTTP 200; a v2
        // reply uses the HTTP status and an OpenAI-style `error`.
        const v1Code = payload.base_resp?.status_code;
        if (typeof v1Code === 'number' && v1Code !== 0) {
            throw minimaxError(
                v1Code,
                payload.base_resp?.status_msg ||
                    `MiniMax request failed (code ${v1Code})`,
                response.status,
            );
        }
        if (!response.ok) {
            const message =
                payload.error?.message ||
                `MiniMax request failed (status ${response.status})`;
            throw minimaxError(parseCode(message), message, response.status);
        }
        return payload as unknown as T;
    }

    #getModel(requestedModel?: string): IVideoModel {
        const wanted = (requestedModel ?? '').trim().toLowerCase();
        return (
            MINIMAX_VIDEO_GENERATION_MODELS.find(
                (m) =>
                    m.id === wanted ||
                    m.puterId === wanted ||
                    m.aliases?.includes(wanted),
            ) ??
            MINIMAX_VIDEO_GENERATION_MODELS.find((m) => m.id === DEFAULT_MODEL)!
        );
    }

    #resolution(candidate: unknown, model: IVideoModel): string {
        const tiers = model.dimensions!;
        if (typeof candidate === 'string') {
            const wanted = candidate.trim().toLowerCase();
            if (tiers.includes(wanted)) return wanted;
        }
        return tiers[0];
    }

    /** An image as MiniMax takes it: a URL or a data URI. */
    #image(value: unknown, label: string): string | undefined {
        if (!present(value)) return undefined;
        if (typeof value !== 'string' || !value.trim()) {
            throw badRequest(
                `${label} must be an image URL, data URI or base64`,
            );
        }
        return toUrlOrDataUri(value);
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

    /** Snap width/height to one of MiniMax's aspect ratios. */
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
        // Other ratios are left to the 16:9 default.
        return ASPECT_RATIOS.includes(candidate) ? candidate : undefined;
    }
}
