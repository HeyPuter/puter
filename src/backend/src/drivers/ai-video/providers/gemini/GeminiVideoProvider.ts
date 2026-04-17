import { GoogleGenAI, GenerateVideosOperation, GenerateVideosParameters } from '@google/genai';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { VideoProvider } from '../VideoProvider.js';
import { GEMINI_VIDEO_GENERATION_MODELS, IGeminiVideoModel } from './models.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const POLL_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const DIMENSION_MAP: Record<string, { aspectRatio: string; resolution: string }> = {
    '1280x720': { aspectRatio: '16:9', resolution: '720p' },
    '720x1280': { aspectRatio: '9:16', resolution: '720p' },
    '1920x1080': { aspectRatio: '16:9', resolution: '1080p' },
    '1080x1920': { aspectRatio: '9:16', resolution: '1080p' },
    '3840x2160': { aspectRatio: '16:9', resolution: '4k' },
    '2160x3840': { aspectRatio: '9:16', resolution: '4k' },
};

export class GeminiVideoProvider extends VideoProvider {
    #client: GoogleGenAI;
    #meteringService: MeteringService;

    constructor (config: { apiKey: string }, meteringService: MeteringService) {
        super();
        if ( ! config.apiKey ) {
            throw new Error('Gemini video generation requires an API key');
        }
        this.#client = new GoogleGenAI({ apiKey: config.apiKey });
        this.#meteringService = meteringService;
    }

    getDefaultModel (): string {
        return GEMINI_VIDEO_GENERATION_MODELS[0].id;
    }

    async models (): Promise<IVideoModel[]> {
        return GEMINI_VIDEO_GENERATION_MODELS.map(model => ({
            ...model,
            aliases: [model.id, `google/${model.id}`],
        }));
    }

    async generate (params: IGenerateVideoParams): Promise<unknown> {
        const {
            prompt,
            model: requestedModel,
            seconds,
            duration,
            size,
            resolution,
            negative_prompt: negativePrompt,
            reference_images: referenceImages,
            input_reference: inputReference,
            last_frame: lastFrame,
            test_mode: testMode,
        } = params ?? {};

        if ( typeof prompt !== 'string' || !prompt.trim() ) {
            throw new HttpError(400, 'prompt must be a non-empty string');
        }

        const selectedModel = this.#getModel(requestedModel);

        if ( testMode ) {
            return DEFAULT_TEST_VIDEO_URL;
        }

        const hasFirstFrame = selectedModel.supportsImageInput
            && typeof inputReference === 'string' && inputReference.trim().length > 0;
        const hasRefImages = selectedModel.supportsReferenceImages
            && Array.isArray(referenceImages) && referenceImages.length > 0;

        const { aspectRatio, videoResolution } = this.#resolveAspectAndResolution(size, selectedModel);

        // 1080p and 4K require duration=8
        const isHighRes = videoResolution === '1080p' || videoResolution === '4k';
        let durationSeconds = this.#coercePositiveInteger(seconds ?? duration)
            ?? selectedModel.durationSeconds?.[0] ?? 8;
        if ( isHighRes || hasRefImages ) {
            durationSeconds = 8;
        }

        const is4K = videoResolution === '4k';
        const is1080p = videoResolution === '1080p';
        const perSecondCents = is4K
            ? selectedModel.costs?.['per-second-4k'] ?? selectedModel.costs?.['per-second']
            : is1080p
                ? selectedModel.costs?.['per-second-1080p'] ?? selectedModel.costs?.['per-second']
                : selectedModel.costs?.['per-second'];
        if ( perSecondCents === undefined ) {
            throw new Error(`No per-second cost configured for video model '${selectedModel.id}'`);
        }
        const costCents = perSecondCents * durationSeconds;
        const costInMicroCents = Math.ceil(costCents * 1_000_000);

        const actor = Context.get('actor');
        if ( ! actor ) {
            throw new HttpError(401, 'Authentication required');
        }

        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, costInMicroCents);
        if ( ! usageAllowed ) {
            throw new HttpError(402, 'Insufficient funds');
        }

        const config: Record<string, unknown> = {
            numberOfVideos: 1,
            durationSeconds,
        };

        if ( aspectRatio ) config.aspectRatio = aspectRatio;
        if ( videoResolution && selectedModel.resolutions.length > 0 ) {
            config.resolution = videoResolution;
        }
        if ( typeof negativePrompt === 'string' && negativePrompt.trim() ) {
            config.negativePrompt = negativePrompt;
        }

        // Reference images (Veo 3.1 supports up to 3)
        // When referenceImages is set, image (first frame), video, and lastFrame are not supported.
        if ( hasRefImages ) {
            const validImages = referenceImages
                .filter((img: string) => typeof img === 'string' && img.trim().length > 0)
                .slice(0, 3);
            config.referenceImages = validImages.map((img: string) => ({
                image: this.#parseImageInput(img),
                referenceType: 'asset',
            }));
        }

        if ( !hasRefImages && typeof lastFrame === 'string' && lastFrame.trim() ) {
            config.lastFrame = this.#parseImageInput(lastFrame);
        }

        const generateParams: GenerateVideosParameters = {
            model: selectedModel.id,
            prompt,
            config,
        };

        // First frame (image-to-video)
        if ( hasFirstFrame && !hasRefImages ) {
            generateParams.image = this.#parseImageInput(inputReference as string);
        }

        let operation: GenerateVideosOperation;
        try {
            operation = await this.#client.models.generateVideos(generateParams);
        } catch (e) {
            console.error('Gemini video generation error:', e);
            throw e;
        }

        const completed = await this.#pollUntilComplete(operation);

        const generatedVideos = completed.response?.generatedVideos;
        if ( !generatedVideos || generatedVideos.length === 0 ) {
            const filtered = completed.response?.raiMediaFilteredCount ?? 0;
            if ( filtered > 0 ) {
                const reasons = completed.response?.raiMediaFilteredReasons?.join(', ') || 'content policy';
                throw new Error(`Video was filtered due to ${reasons}`);
            }
            throw new Error('Gemini response did not include a video');
        }

        const video = generatedVideos[0].video;
        if ( ! video ) {
            throw new Error('Gemini response video entry was empty');
        }

        const resTier = is4K ? ':4k' : is1080p && selectedModel.costs?.['per-second-1080p'] ? ':1080p' : '';
        const usageKey = `gemini:${selectedModel.id}${resTier}`;
        await this.#meteringService.incrementUsage(actor, usageKey, durationSeconds, costInMicroCents);

        if ( video.uri ) {
            return video.uri;
        }

        if ( video.videoBytes ) {
            const mimeType = video.mimeType ?? 'video/mp4';
            return `data:${mimeType};base64,${video.videoBytes}`;
        }

        throw new Error('Gemini video response contained neither uri nor videoBytes');
    }

    async #pollUntilComplete (operation: GenerateVideosOperation): Promise<GenerateVideosOperation> {
        let op = operation;
        const start = Date.now();

        while ( !op.done ) {
            if ( Date.now() - start > DEFAULT_TIMEOUT_MS ) {
                throw new Error('Timed out waiting for Gemini video generation to complete');
            }

            await this.#delay(POLL_INTERVAL_MS);
            op = await this.#client.operations.getVideosOperation({ operation: op });
        }

        if ( op.error ) {
            const msg = (op.error as Record<string, unknown>).message ?? JSON.stringify(op.error);
            throw new Error(`Gemini video generation failed: ${msg}`);
        }

        return op;
    }

    #parseImageInput (input: string): { imageBytes: string; mimeType: string } {
        if ( input.startsWith('data:') ) {
            const commaIdx = input.indexOf(',');
            if ( commaIdx !== -1 ) {
                const header = input.substring(5, commaIdx);
                if ( header.endsWith(';base64') ) {
                    const mimeType = header.substring(0, header.length - 7);
                    if ( mimeType.length > 0 ) {
                        return { imageBytes: input.substring(commaIdx + 1), mimeType };
                    }
                }
            }
        }
        return { imageBytes: input, mimeType: 'image/png' };
    }

    #getModel (requestedModel?: string): IGeminiVideoModel {
        return GEMINI_VIDEO_GENERATION_MODELS.find(m => m.id === requestedModel)
            ?? GEMINI_VIDEO_GENERATION_MODELS[0];
    }

    #resolveAspectAndResolution (
        size: string | undefined,
        model: IGeminiVideoModel,
    ): { aspectRatio: string; videoResolution: string | undefined } {
        if ( size && DIMENSION_MAP[size] ) {
            return {
                aspectRatio: DIMENSION_MAP[size].aspectRatio,
                videoResolution: DIMENSION_MAP[size].resolution,
            };
        }

        return {
            aspectRatio: model.aspectRatios[0],
            videoResolution: model.resolutions[0],
        };
    }

    #coercePositiveInteger (value: unknown): number | undefined {
        if ( typeof value === 'number' && Number.isFinite(value) ) {
            const rounded = Math.round(value);
            return rounded > 0 ? rounded : undefined;
        }
        if ( typeof value === 'string' ) {
            const numeric = Number.parseInt(value, 10);
            return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
        }
        return undefined;
    }

    async #delay (ms: number): Promise<void> {
        return await new Promise(resolve => setTimeout(resolve, ms));
    }
}
