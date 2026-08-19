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

import { GoogleGenAI, type Interactions } from '@google/genai';
import type { Actor } from '../../../../core/actor.js';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { partitionOutputs } from '../../../util/interactions/index.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { VideoProvider } from '../VideoProvider.js';
import {
    GEMINI_OMNI_VIDEO_MODELS,
    IGeminiOmniModel,
    OMNI_MAX_BILLED_SECONDS,
    OMNI_VIDEO_TOKENS_PER_SECOND_720P,
} from './omniModels.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const POLL_INTERVAL_MS = 10_000;
const FILE_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const ASPECT_BY_DIMENSION: Record<string, string> = {
    '1280x720': '16:9',
    '720x1280': '9:16',
};

const FILE_NAME_IN_URI = /\/(files\/[^/:?]+)/;

/**
 * Gemini Omni video generation, over the Interactions API.
 *
 * Omni is reachable only through `/v1beta/interactions` — there is no
 * `generateVideos` operation to poll — so this is a sibling of
 * [[GeminiVideoProvider]] rather than another entry in its catalog. What the
 * two share is the `IVideoProvider` contract: a prompt in, a video URL out.
 *
 * Two things Veo's shape does not cover:
 *
 * - Omni exposes no duration parameter, so there is no clip length to clamp to
 *   the caller's remaining credit. The affordability gate checks the worst-case
 *   clip up front instead, and metering reads the tokens actually billed.
 * - Retrieving a long-running interaction requires Google to have stored it, so
 *   `store` cannot be false here the way it is on the chat route. The
 *   interaction is deleted once the video URI is in hand.
 */
export class GeminiOmniVideoProvider extends VideoProvider {
    #client: GoogleGenAI;
    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        super();
        if (!config.apiKey) {
            throw new Error('Gemini Omni video generation requires an API key');
        }
        this.#client = new GoogleGenAI({ apiKey: config.apiKey });
        this.#meteringService = meteringService;
    }

    getDefaultModel(): string {
        return GEMINI_OMNI_VIDEO_MODELS[0].id;
    }

    async models(): Promise<IVideoModel[]> {
        return GEMINI_OMNI_VIDEO_MODELS.map((model) => ({
            ...model,
            aliases: [model.id, `google/${model.id}`],
        }));
    }

    async generate(params: IGenerateVideoParams): Promise<unknown> {
        const {
            prompt,
            model: requestedModel,
            size,
            reference_images: referenceImages,
            input_reference: inputReference,
            test_mode: testMode,
        } = params ?? {};

        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw new HttpError(400, 'prompt must be a non-empty string', {
                legacyCode: 'bad_request',
            });
        }

        const selectedModel = this.#getModel(requestedModel);

        if (testMode) {
            return DEFAULT_TEST_VIDEO_URL;
        }

        const actor = Context.get('actor') as Actor | undefined;
        if (!actor) {
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        }

        await this.#assertAffordable(actor, selectedModel);

        const firstFrame =
            selectedModel.supportsImageInput &&
            typeof inputReference === 'string' &&
            inputReference.trim()
                ? inputReference
                : undefined;
        const refImages =
            selectedModel.supportsReferenceImages &&
            Array.isArray(referenceImages)
                ? referenceImages.filter(
                      (img) => typeof img === 'string' && img.trim(),
                  )
                : [];

        const input: Interactions.Content[] = [{ type: 'text', text: prompt }];
        for (const image of firstFrame ? [firstFrame] : refImages) {
            input.push(this.#imageContent(image));
        }

        const task = firstFrame
            ? 'image_to_video'
            : refImages.length
              ? 'reference_to_video'
              : 'text_to_video';

        const interaction = await this.#createAndAwait({
            model: selectedModel.id,
            input,
            response_format: {
                type: 'video',
                aspect_ratio: this.#aspectRatio(size, selectedModel),
                // Base64 delivery caps out at 4MB, which a real clip clears
                // immediately.
                delivery: 'uri',
            },
            generation_config: { video_config: { task } },
            // Forced by retrieval, not chosen: see the class comment.
            store: true,
            stream: false,
        });

        try {
            const video = this.#extractVideo(interaction);
            await this.#meter(actor, selectedModel, interaction.usage);

            if (video.uri) {
                await this.#awaitFileActive(video.uri);
                return video.uri;
            }
            return `data:${video.mime_type ?? 'video/mp4'};base64,${video.data}`;
        } finally {
            await this.#forget(interaction.id);
        }
    }

    // -- Upstream ------------------------------------------------------------

    async #createAndAwait(
        params: Record<string, unknown>,
    ): Promise<Interactions.Interaction> {
        let interaction: Interactions.Interaction;
        try {
            interaction = await this.#client.interactions.create(
                params as unknown as Interactions.CreateModelInteractionParamsNonStreaming,
            );
        } catch (e) {
            console.error('Gemini Omni video generation error:', e);
            throw e;
        }

        const start = Date.now();
        while (interaction.status === 'in_progress') {
            if (Date.now() - start > DEFAULT_TIMEOUT_MS) {
                throw new HttpError(
                    504,
                    'Timed out waiting for Gemini Omni video generation to complete',
                    { legacyCode: 'timeout' },
                );
            }
            await this.#delay(POLL_INTERVAL_MS);
            interaction = await this.#client.interactions.get(interaction.id);
        }

        if (interaction.status !== 'completed') {
            throw new HttpError(
                502,
                `Gemini Omni video generation ${interaction.status}`,
                { legacyCode: 'bad_response' },
            );
        }

        return interaction;
    }

    /**
     * A URI-delivered video is a Files API entry that is still being written
     * when the interaction completes. Handing the caller a URI that 404s until
     * processing finishes makes the wait their problem instead of ours.
     */
    async #awaitFileActive(uri: string): Promise<void> {
        const name = FILE_NAME_IN_URI.exec(uri)?.[1];
        if (!name) return;

        const start = Date.now();
        for (;;) {
            const file = await this.#client.files.get({ name });
            if (file.state === 'ACTIVE') return;
            if (file.state === 'FAILED') {
                throw new HttpError(
                    502,
                    'Gemini Omni video failed to process',
                    { legacyCode: 'bad_response' },
                );
            }
            if (Date.now() - start > DEFAULT_TIMEOUT_MS) {
                throw new HttpError(
                    504,
                    'Timed out waiting for the generated video to become available',
                    { legacyCode: 'timeout' },
                );
            }
            await this.#delay(FILE_POLL_INTERVAL_MS);
        }
    }

    /**
     * Drop the stored interaction now that its output has been collected.
     *
     * Storage was a precondition for polling, not something the caller asked
     * for, so it does not outlive the request. Best-effort: a video we already
     * have is not worth failing over a retention cleanup.
     */
    async #forget(id: string): Promise<void> {
        try {
            await this.#client.interactions.delete(id);
        } catch (e) {
            console.error('Failed to delete Gemini Omni interaction:', e);
        }
    }

    #extractVideo(
        interaction: Interactions.Interaction,
    ): Interactions.VideoContent {
        const { extra } = partitionOutputs(interaction.outputs);
        const video = extra.find(
            (output): output is Interactions.VideoContent =>
                output.type === 'video',
        );

        if (!video || (!video.uri && !video.data)) {
            throw new HttpError(
                502,
                'Gemini Omni response did not include a video',
                { legacyCode: 'bad_response' },
            );
        }

        return video;
    }

    // -- Metering ------------------------------------------------------------

    /** Micro-cents per token for one of the model's per-million-token rates. */
    #microCentsPerToken(model: IGeminiOmniModel, key: string): number {
        const scale = model.costs?.tokens ?? 1_000_000;
        const rate = model.costs?.[key];
        if (!Number.isFinite(rate)) {
            throw new Error(
                `No '${key}' cost configured for video model '${model.id}'`,
            );
        }
        return (rate! * 1_000_000) / scale;
    }

    /**
     * Reject up front what the account cannot cover.
     *
     * Veo's equivalent shortens the clip to fit the wallet. Omni takes no
     * duration, so the only honest gate is whether the longest clip it might
     * return is affordable — anything less risks handing back a video the
     * account cannot pay for.
     */
    async #assertAffordable(
        actor: Actor,
        model: IGeminiOmniModel,
    ): Promise<void> {
        const worstCase = Math.ceil(
            OMNI_MAX_BILLED_SECONDS *
                OMNI_VIDEO_TOKENS_PER_SECOND_720P *
                this.#microCentsPerToken(model, 'video_tokens'),
        );

        if (await this.#meteringService.hasEnoughCredits(actor, worstCase)) {
            return;
        }

        const usd = (microCents: number) => (microCents / 1e8).toFixed(2);
        throw new HttpError(
            402,
            `Insufficient funds: ${model.id} bills up to $${usd(worstCase)} ` +
                `per clip and does not accept a duration to shorten it.`,
            { legacyCode: 'insufficient_funds' },
        );
    }

    async #meter(
        actor: Actor,
        model: IGeminiOmniModel,
        usage?: Interactions.Usage,
    ): Promise<void> {
        const byModality = new Map(
            (usage?.output_tokens_by_modality ?? []).map((entry) => [
                entry.modality,
                entry.tokens ?? 0,
            ]),
        );
        const totalOutput = usage?.total_output_tokens ?? 0;

        // No breakdown means we cannot tell text output from video output. Bill
        // it all at the video rate: this is a video model, video is the
        // expensive modality, and guessing the cheap one gives the clip away.
        const videoTokens = byModality.size
            ? (byModality.get('video') ?? 0)
            : totalOutput;
        const textTokens = byModality.size
            ? Math.max(0, totalOutput - videoTokens)
            : 0;

        const trackedUsage = {
            prompt_tokens: usage?.total_input_tokens ?? 0,
            completion_tokens: textTokens,
            video_tokens: videoTokens,
        };

        const costs: Record<string, number> = {
            prompt_tokens:
                trackedUsage.prompt_tokens *
                this.#microCentsPerToken(model, 'prompt_tokens'),
            completion_tokens:
                trackedUsage.completion_tokens *
                this.#microCentsPerToken(model, 'completion_tokens'),
            video_tokens:
                trackedUsage.video_tokens *
                this.#microCentsPerToken(model, 'video_tokens'),
        };

        await this.#meteringService.utilRecordUsageObject(
            trackedUsage,
            actor,
            `gemini:${model.id}`,
            costs,
        );
    }

    // -- Request shaping -----------------------------------------------------

    #imageContent(input: string): Interactions.Content {
        if (input.startsWith('data:')) {
            const commaIdx = input.indexOf(',');
            const header = input.substring(5, commaIdx);
            if (commaIdx !== -1 && header.endsWith(';base64')) {
                return {
                    type: 'image',
                    data: input.substring(commaIdx + 1),
                    mime_type: header.substring(0, header.length - 7),
                } as Interactions.Content;
            }
        }
        if (/^https?:\/\//.test(input)) {
            return { type: 'image', uri: input } as Interactions.Content;
        }
        return {
            type: 'image',
            data: input,
            mime_type: 'image/png',
        } as Interactions.Content;
    }

    #aspectRatio(size: string | undefined, model: IGeminiOmniModel): string {
        return (
            (size ? ASPECT_BY_DIMENSION[size] : undefined) ??
            model.aspectRatios[0]
        );
    }

    #getModel(requestedModel?: string): IGeminiOmniModel {
        return (
            GEMINI_OMNI_VIDEO_MODELS.find((m) => m.id === requestedModel) ??
            GEMINI_OMNI_VIDEO_MODELS[0]
        );
    }

    async #delay(ms: number): Promise<void> {
        return await new Promise((resolve) => setTimeout(resolve, ms));
    }
}
