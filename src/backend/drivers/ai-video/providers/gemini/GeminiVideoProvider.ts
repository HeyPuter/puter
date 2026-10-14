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
import type { UsageInput } from '../../../../services/metering/types.js';
import { normalizeRawBase64ImageString } from '../../../../util/appIcon.js';
import {
    decodeStrictBase64,
    sniffImageMime,
    sniffVideoMime,
} from '../../../../util/mediaSniff.js';
import type { AiMeteringService } from '../../../util/aiCostFactor.js';
import { loadFileInput } from '../../../util/fileInput.js';
import {
    geminiUpstreamFailure,
    postGeminiJson,
    geminiTokenCount as tokenCount,
} from '../../../util/geminiRest.js';
import { fetchImageBytes, isHttpUrl } from '../../../util/imageInput.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { VideoProvider } from '../VideoProvider.js';
import {
    GEMINI_OMNI_COSTS,
    GEMINI_OMNI_MODEL,
    GEMINI_VIDEO_GENERATION_MODELS,
} from './models.js';

const SAMPLE_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';

export const GEMINI_OMNI_MAX_PROMPT_CHARS = 4000;
export const GEMINI_OMNI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Uses the lower input limit returned by the model metadata. */
export const GEMINI_OMNI_MAX_INPUT_TOKENS = 131_072;
/** Requested output cap; video generation can exceed it. */
export const GEMINI_OMNI_MAX_OUTPUT_TOKENS = 65_536;
const VIDEO_RESERVATION_ALLOWANCE = 173_760;
const TEXT_RESERVATION_ALLOWANCE = 65_536;
export const GEMINI_OMNI_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Covers the generation and reading the reply. */
export const GEMINI_OMNI_TIMEOUT_MS = 10 * 60 * 1000;
export const GEMINI_OMNI_COUNT_TOKENS_MAX_RESPONSE_BYTES = 64 * 1024;
export const GEMINI_OMNI_COUNT_TOKENS_TIMEOUT_MS = 30_000;
/** Outlasts the upstream deadline so the hold stands until usage is recorded. */
export const GEMINI_OMNI_HOLD_TTL_MS = 11 * 60 * 1000;

type OmniResolution = '360p' | '720p' | '1080p' | '4k';
type OmniAspectRatio = '16:9' | '9:16';

/** Landscape pixel size of each resolution; portrait swaps the sides. */
const LANDSCAPE_SIZES: Record<OmniResolution, [number, number]> = {
    '360p': [640, 360],
    '720p': [1280, 720],
    '1080p': [1920, 1080],
    '4k': [3840, 2160],
};

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Options other providers take; any value but null is refused. */
const UNSUPPORTED_OPTIONS = [
    'seconds',
    'duration',
    'fps',
    'steps',
    'guidance_scale',
    'seed',
    'negative_prompt',
    'output_quality',
    'generate_audio',
    'frame_images',
    'last_frame',
    'reference_images',
    'metadata',
] as const satisfies readonly (keyof IGenerateVideoParams)[];

interface OmniSize {
    resolution: OmniResolution;
    aspectRatio: OmniAspectRatio;
}

interface OmniRequest extends OmniSize {
    prompt: string;
    inputReference?: string;
}

interface InlineImage {
    mimeType: string;
    data: string;
}

export interface GeminiVideoDeps {
    stores: Parameters<typeof loadFileInput>[0];
    fs: Parameters<typeof loadFileInput>[1];
    metering: AiMeteringService;
}

// -- Gemini wire shapes --

type InteractionInput =
    | { type: 'image'; mime_type: string; data: string }
    | { type: 'text'; text: string };

interface InteractionRequest {
    model: string;
    input: string | InteractionInput[];
    response_format: {
        type: 'video';
        resolution: OmniResolution;
        aspect_ratio: OmniAspectRatio;
    };
    generation_config: {
        max_output_tokens: number;
        video_config?: { task: 'image_to_video' };
    };
    store: false;
    background: false;
    stream: false;
}

interface InteractionModalityTokens {
    modality?: string;
    tokens?: number;
}

interface InteractionUsage {
    total_input_tokens?: number;
    total_output_tokens?: number;
    output_tokens_by_modality?: InteractionModalityTokens[];
    total_thought_tokens?: number;
}

interface InteractionContent {
    type?: string;
    mime_type?: string;
    data?: string;
}

/** The reply as documented; every field is checked before use. */
interface Interaction {
    status?: string;
    steps?: { type?: string; content?: InteractionContent[] }[];
    usage?: InteractionUsage;
}

type CountTokensPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } };

interface CountTokensRequest {
    contents: { parts: CountTokensPart[] }[];
}

interface CountTokensReply {
    totalTokens?: number;
}

const badRequest = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

const isSet = (value: unknown): boolean =>
    value !== undefined && value !== null;

/**
 * Billable tokens from the reply's usage: input of every modality, video
 * output, and the rest of the output plus thinking as text. Undefined when a
 * count is missing, malformed, inconsistent or would cost more than a safe
 * integer.
 */
const billedTokens = (
    usage: InteractionUsage | undefined,
): { input: number; video: number; text: number } | undefined => {
    if (!usage || typeof usage !== 'object') return undefined;
    const input = tokenCount(usage.total_input_tokens);
    const output = tokenCount(usage.total_output_tokens);
    const thoughts =
        usage.total_thought_tokens === undefined
            ? 0
            : tokenCount(usage.total_thought_tokens);
    const byModality = usage.output_tokens_by_modality;
    if (
        input === undefined ||
        output === undefined ||
        thoughts === undefined ||
        !Array.isArray(byModality)
    )
        return undefined;

    let video = 0;
    let listed = 0;
    for (const entry of byModality) {
        const tokens = tokenCount(entry?.tokens);
        if (tokens === undefined) return undefined;
        listed += tokens;
        if (String(entry.modality).toLowerCase() === 'video') video += tokens;
    }
    // `total_output_tokens` excludes thinking, so the modalities fit inside it.
    if (video === 0 || listed > output) return undefined;

    const text = output - video + thoughts;
    const costs = GEMINI_OMNI_COSTS;
    if (
        !Number.isSafeInteger(
            input * costs.input +
                video * costs.outputVideo +
                text * costs.outputText,
        )
    )
        return undefined;
    return { input, video, text };
};

/** The pixel size a resolution and aspect ratio produce. */
const pixelSize = (
    resolution: OmniResolution,
    aspectRatio: OmniAspectRatio,
): string => {
    const [long, short] = LANDSCAPE_SIZES[resolution];
    return aspectRatio === '16:9' ? `${long}x${short}` : `${short}x${long}`;
};

/** Every accepted `WIDTHxHEIGHT`. */
const SIZES: Record<string, OmniSize> = {};
for (const resolution of Object.keys(LANDSCAPE_SIZES) as OmniResolution[]) {
    for (const aspectRatio of ['16:9', '9:16'] as const) {
        SIZES[pixelSize(resolution, aspectRatio)] = { resolution, aspectRatio };
    }
}

const SIZE_CHOICES = [
    ...Object.keys(LANDSCAPE_SIZES),
    ...Object.keys(SIZES),
].join(', ');

/**
 * Gemini Omni video generation through Gemini's Interactions API. One unary
 * call returns the clip inline, so the hold is sized from a `countTokens`
 * preflight plus the output and thinking allowances, and the reply's usage
 * settles it.
 */
export class GeminiVideoProvider extends VideoProvider {
    #apiKey: string;
    #deps: GeminiVideoDeps;

    constructor(config: { apiKey: string }, deps: GeminiVideoDeps) {
        super();
        if (!config.apiKey) {
            throw new Error('Gemini video generation requires an API key');
        }
        this.#apiKey = config.apiKey;
        this.#deps = deps;
    }

    getDefaultModel(): string {
        return GEMINI_OMNI_MODEL;
    }

    async models(): Promise<IVideoModel[]> {
        return GEMINI_VIDEO_GENERATION_MODELS;
    }

    async generate(params: IGenerateVideoParams): Promise<string> {
        const request = this.#readRequest(params);
        if (params.test_mode) return SAMPLE_VIDEO_URL;

        const actor = Context.get('actor') as Actor | undefined;
        if (!actor) {
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        }
        const signal = Context.get('abortSignal');
        const image =
            request.inputReference === undefined
                ? undefined
                : await this.#loadImage(actor, request.inputReference, signal);

        const inputTokens = await this.#countTokens(
            request.prompt,
            image,
            signal,
        );
        if (inputTokens > GEMINI_OMNI_MAX_INPUT_TOKENS) {
            throw new HttpError(
                400,
                `Input is ${inputTokens} tokens; Gemini Omni accepts at most ${GEMINI_OMNI_MAX_INPUT_TOKENS}`,
                { legacyCode: 'bad_request', code: 'input_too_large' },
            );
        }

        // The video allowance covers verified 4K usage, with a separate text
        // and thinking allowance. Neither is a guaranteed spending bound.
        const costs = GEMINI_OMNI_COSTS;
        const holdAmount =
            inputTokens * costs.input +
            VIDEO_RESERVATION_ALLOWANCE * costs.outputVideo +
            TEXT_RESERVATION_ALLOWANCE * costs.outputText;
        const metering = this.#deps.metering;
        const usagePrefix = `gemini-video-generation:${GEMINI_OMNI_MODEL}`;
        const hold = await metering.reserveAiCredits(
            actor,
            usagePrefix,
            holdAmount,
            { ttlMs: GEMINI_OMNI_HOLD_TTL_MS },
        );
        if (!hold) throw insufficientCreditsError();

        try {
            const interaction = await postGeminiJson<Interaction>(
                this.#apiKey,
                'interactions',
                this.#interactionRequest(request, image),
                {
                    label: 'Gemini video generation',
                    maxBytes: GEMINI_OMNI_MAX_RESPONSE_BYTES,
                    timeoutMs: GEMINI_OMNI_TIMEOUT_MS,
                    signal,
                },
            );
            if (interaction.status !== 'completed') {
                throw geminiUpstreamFailure(
                    'Gemini video generation did not complete the request',
                );
            }
            const video = this.#readVideo(interaction);

            const billed = billedTokens(interaction.usage);
            if (!billed) {
                throw geminiUpstreamFailure(
                    'Gemini video generation returned unusable usage',
                );
            }
            const usages: UsageInput[] = [
                {
                    usageType: `${usagePrefix}:input`,
                    usageAmount: billed.input,
                    costOverride: billed.input * costs.input,
                },
                {
                    usageType: `${usagePrefix}:output:video`,
                    usageAmount: billed.video,
                    costOverride: billed.video * costs.outputVideo,
                },
                {
                    usageType: `${usagePrefix}:output:text`,
                    usageAmount: billed.text,
                    costOverride: billed.text * costs.outputText,
                },
            ].filter((usage) => usage.usageAmount > 0);
            await metering.batchIncrementUsages(actor, usages);

            return `data:video/mp4;base64,${video}`;
        } finally {
            await hold.release();
        }
    }

    /** Validates every option before any I/O, test mode included. */
    #readRequest(params: IGenerateVideoParams): OmniRequest {
        if (params.model !== undefined && params.model !== GEMINI_OMNI_MODEL) {
            throw badRequest(
                `Unsupported model: ${String(params.model)}. Expected: ${GEMINI_OMNI_MODEL}`,
            );
        }
        const { prompt } = params;
        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw badRequest('prompt must be a non-empty string');
        }
        if (prompt.length > GEMINI_OMNI_MAX_PROMPT_CHARS) {
            throw badRequest(
                `prompt must be at most ${GEMINI_OMNI_MAX_PROMPT_CHARS} characters`,
            );
        }
        for (const key of UNSUPPORTED_OPTIONS) {
            if (isSet(params[key])) {
                throw badRequest(`${key} is not supported by Gemini Omni`);
            }
        }
        if (isSet(params.output_format) && params.output_format !== 'video/mp4') {
            throw badRequest('output_format must be video/mp4');
        }
        const inputReference = params.input_reference;
        if (
            isSet(inputReference) &&
            (typeof inputReference !== 'string' || !inputReference.trim())
        ) {
            throw badRequest(
                'input_reference must be an image URL, data URI, base64 string or Puter file path',
            );
        }
        return {
            prompt,
            ...this.#readSize(params),
            ...(isSet(inputReference)
                ? { inputReference: inputReference as string }
                : {}),
        };
    }

    /**
     * `size` and `resolution` take a resolution or an exact pixel size;
     * `width` with `height` take an exact pixel size. Controls that are given
     * together must agree. Defaults to 720p at 16:9.
     */
    #readSize(params: IGenerateVideoParams): OmniSize {
        const unsupported = () =>
            badRequest(`size must be one of: ${SIZE_CHOICES}`);

        const named: string[] = [];
        for (const value of [params.size, params.resolution]) {
            if (!isSet(value)) continue;
            if (typeof value !== 'string' || !value.trim()) throw unsupported();
            named.push(value.trim().toLowerCase());
        }
        if (named.length === 2 && named[0] !== named[1]) {
            throw badRequest('size and resolution must match');
        }

        let resolution: OmniResolution | undefined;
        let aspectRatio: OmniAspectRatio | undefined;
        if (named.length > 0) {
            const wanted = named[0]!;
            if (Object.hasOwn(LANDSCAPE_SIZES, wanted)) {
                resolution = wanted as OmniResolution;
            } else if (Object.hasOwn(SIZES, wanted)) {
                ({ resolution, aspectRatio } = SIZES[wanted]!);
            } else {
                throw unsupported();
            }
        }

        const { width, height } = params;
        if (isSet(width) || isSet(height)) {
            const pixels = `${width}x${height}`;
            if (
                !Number.isInteger(width) ||
                !Number.isInteger(height) ||
                !Object.hasOwn(SIZES, pixels)
            ) {
                throw badRequest(
                    `width and height must together be one of: ${Object.keys(SIZES).join(', ')}`,
                );
            }
            const exact = SIZES[pixels]!;
            if (
                (resolution && resolution !== exact.resolution) ||
                (aspectRatio && aspectRatio !== exact.aspectRatio)
            ) {
                throw badRequest('width and height must match size');
            }
            ({ resolution, aspectRatio } = exact);
        }

        return {
            resolution: resolution ?? '720p',
            aspectRatio: aspectRatio ?? '16:9',
        };
    }

    /** The first-frame image, read within the caller's access and size cap. */
    async #loadImage(
        actor: Actor,
        input: string,
        signal: AbortSignal | undefined,
    ): Promise<InlineImage> {
        const bytes = isHttpUrl(input)
            ? (
                  await fetchImageBytes(input, {
                      maxBytes: GEMINI_OMNI_MAX_IMAGE_BYTES,
                      signal,
                  })
              ).bytes
            : (
                  await loadFileInput(
                      this.#deps.stores,
                      this.#deps.fs,
                      actor,
                      normalizeRawBase64ImageString(input),
                      { maxBytes: GEMINI_OMNI_MAX_IMAGE_BYTES },
                  )
              ).buffer;
        const mimeType = sniffImageMime(bytes);
        if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType)) {
            throw badRequest('input_reference must be a PNG, JPEG or WebP image');
        }
        return { mimeType, data: bytes.toString('base64') };
    }

    /** Input tokens for the prompt and image, counted as they will be sent. */
    async #countTokens(
        prompt: string,
        image: InlineImage | undefined,
        signal: AbortSignal | undefined,
    ): Promise<number> {
        const parts: CountTokensPart[] = image
            ? [{ inlineData: image }, { text: prompt }]
            : [{ text: prompt }];
        const request: CountTokensRequest = { contents: [{ parts }] };
        const reply = await postGeminiJson<CountTokensReply>(
            this.#apiKey,
            `models/${GEMINI_OMNI_MODEL}:countTokens`,
            request,
            {
                label: 'Gemini token count',
                maxBytes: GEMINI_OMNI_COUNT_TOKENS_MAX_RESPONSE_BYTES,
                timeoutMs: GEMINI_OMNI_COUNT_TOKENS_TIMEOUT_MS,
                signal,
            },
        );
        const tokens = tokenCount(reply.totalTokens);
        if (!tokens) {
            throw geminiUpstreamFailure(
                'Gemini token count returned an unusable count',
            );
        }
        return tokens;
    }

    #interactionRequest(
        request: OmniRequest,
        image: InlineImage | undefined,
    ): InteractionRequest {
        const body: InteractionRequest = {
            model: GEMINI_OMNI_MODEL,
            input: image
                ? [
                      {
                          type: 'image',
                          mime_type: image.mimeType,
                          data: image.data,
                      },
                      { type: 'text', text: request.prompt },
                  ]
                : request.prompt,
            response_format: {
                type: 'video',
                resolution: request.resolution,
                aspect_ratio: request.aspectRatio,
            },
            generation_config: {
                max_output_tokens: GEMINI_OMNI_MAX_OUTPUT_TOKENS,
            },
            store: false,
            background: false,
            stream: false,
        };
        if (image) {
            body.generation_config.video_config = { task: 'image_to_video' };
        }
        return body;
    }

    /** The base64 MP4 of the last video the model returned. */
    #readVideo(interaction: Interaction): string {
        const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
        const video = steps
            .flatMap((step) =>
                step?.type === 'model_output' && Array.isArray(step.content)
                    ? step.content
                    : [],
            )
            .filter((content) => content?.type === 'video')
            .at(-1);
        if (!video) {
            throw new HttpError(400, 'Gemini did not return a video', {
                legacyCode: 'upstream_bad_request',
                fields: { provider: 'gemini' },
            });
        }
        const bytes =
            video.mime_type === 'video/mp4' && typeof video.data === 'string'
                ? decodeStrictBase64(video.data)
                : null;
        if (!bytes || sniffVideoMime(bytes) !== 'video/mp4') {
            throw geminiUpstreamFailure(
                'Gemini video generation returned a malformed video',
            );
        }
        return video.data!;
    }
}
