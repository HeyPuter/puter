import { Together } from 'together-ai';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IGenerateVideoParams, IVideoModel } from '../../types.js';
import { VideoProvider } from '../VideoProvider.js';
import { TOGETHER_VIDEO_GENERATION_MODELS } from './models.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MODEL = 'minimax/video-01-director';
const DEFAULT_DURATION_SECONDS = 6;

export class TogetherVideoProvider extends VideoProvider {
    #client: Together;
    #meteringService: MeteringService;

    constructor(config: { apiKey: string }, meteringService: MeteringService) {
        super();
        if (!config.apiKey) {
            throw new Error('Together AI video generation requires an API key');
        }
        this.#client = new Together({ apiKey: config.apiKey });
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
            width,
            height,
            fps,
            steps,
            guidance_scale: guidanceScale,
            seed,
            output_format: outputFormat,
            output_quality: outputQuality,
            negative_prompt: negativePrompt,
            reference_images: referenceImages,
            frame_images: frameImages,
            metadata,
            test_mode: testMode,
        } = params ?? {};

        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw new HttpError(400, 'prompt must be a non-empty string');
        }

        const selectedModel = await this.#getModel(requestedModel);
        const model =
            selectedModel?.model ??
            this.#stripTogetherPrefix(requestedModel ?? DEFAULT_MODEL);

        if (testMode) {
            return DEFAULT_TEST_VIDEO_URL;
        }

        const costPerVideoCents = selectedModel?.costs?.['per-video'];
        if (!costPerVideoCents) {
            throw new Error(`No pricing configured for video model ${model}`);
        }
        const costInMicroCents = costPerVideoCents * 1_000_000;

        let normalizedSeconds = this.#coercePositiveInteger(
            seconds ?? duration,
        );

        if (!no_extra_params) {
            normalizedSeconds ??= DEFAULT_DURATION_SECONDS;
        }

        const actor = Context.get('actor');
        if (!actor) {
            throw new HttpError(401, 'Authentication required');
        }

        const usageAllowed = await this.#meteringService.hasEnoughCredits(
            actor,
            costInMicroCents,
        );
        if (!usageAllowed) {
            throw new HttpError(402, 'Insufficient funds');
        }

        const createPayload: Together.VideoCreateParams & {
            metadata?: object;
        } = {
            prompt,
            model,
        };

        if (normalizedSeconds) {
            createPayload.seconds = String(normalizedSeconds);
        }
        if (this.#isFiniteNumber(width)) {
            createPayload.width = Number(width);
        }
        if (this.#isFiniteNumber(height)) {
            createPayload.height = Number(height);
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
        }
        if (metadata && typeof metadata === 'object') {
            createPayload.metadata = metadata;
        }

        const job = await this.#client.videos.create(createPayload);
        const finalJob = await this.#pollUntilComplete(job.id);

        if (finalJob.status === 'failed') {
            const errorMessage =
                finalJob?.info?.errors?.[0]?.message ??
                finalJob?.info?.errors?.message ??
                finalJob?.info?.errors ??
                'Video generation failed';
            throw new Error(errorMessage);
        }

        if (finalJob.status === 'cancelled') {
            throw new Error('Video generation was cancelled');
        }

        const usageKey = `together-video:${model}`;
        await this.#meteringService.incrementUsage(
            actor,
            usageKey,
            1,
            costInMicroCents,
        );

        const videoUrl = finalJob?.outputs?.video_url;
        if (typeof videoUrl === 'string' && videoUrl.trim()) {
            return videoUrl;
        }

        throw new Error('Together AI response did not include a video URL');
    }

    async #pollUntilComplete(jobId: string): Promise<any> {
        // any here because sdk types are wrong https://docs.together.ai/docs/videos-overview -> "Job Status Reference"
        let job = await (this.#client as any).videos.retrieve(jobId);
        const start = Date.now();

        while (job.status === 'queued' || job.status === 'in_progress') {
            if (Date.now() - start > DEFAULT_TIMEOUT_MS) {
                throw new Error(
                    'Timed out waiting for Together AI video generation to complete',
                );
            }

            await this.#delay(POLL_INTERVAL_MS);
            job = await (this.#client as any).videos.retrieve(jobId);
        }

        return job;
    }

    async #delay(ms: number): Promise<void> {
        return await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async #getModel(requestedModel?: string): Promise<IVideoModel | undefined> {
        const bareModel = this.#stripTogetherPrefix(
            requestedModel ?? DEFAULT_MODEL,
        );
        const allModels = await this.models();
        return allModels.find(
            (m) => m.model?.toLowerCase() === bareModel.toLowerCase(),
        );
    }

    #stripTogetherPrefix(model: string): string {
        if (typeof model === 'string' && model.startsWith('togetherai:')) {
            return model.slice('togetherai:'.length);
        }
        return model;
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
