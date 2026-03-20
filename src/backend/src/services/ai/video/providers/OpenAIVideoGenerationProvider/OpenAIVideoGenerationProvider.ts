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

import OpenAI from 'openai';
import APIError from '../../../../../api/APIError.js';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { IGenerateVideoParams, IVideoModel, IVideoProvider } from '../types.js';
import { TypedValue } from '../../../../drivers/meta/Runtime.js';
import { Readable } from 'stream';
import { OPENAI_VIDEO_MODELS, OPENAI_VIDEO_ALLOWED_SECONDS } from './models.js';

const DEFAULT_TEST_VIDEO_URL = 'https://assets.puter.site/txt2vid.mp4';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_DURATION_SECONDS = 4;

export class OpenAIVideoGenerationProvider implements IVideoProvider {
    #openai: OpenAI;
    #meteringService: MeteringService;

    constructor (config: { apiKey: string }, meteringService: MeteringService) {
        if ( ! config.apiKey ) {
            throw new Error('OpenAI video generation requires an API key');
        }
        this.#openai = new OpenAI({ apiKey: config.apiKey });
        this.#meteringService = meteringService;
    }

    getDefaultModel (): string {
        return OPENAI_VIDEO_MODELS[0].id;
    }

    async models (): Promise<IVideoModel[]> {
        const costMapModule = await import('../../../../MeteringService/costMaps/openaiVideoCostMap.js');
        const OPENAI_VIDEO_COST_MAP = costMapModule.OPENAI_VIDEO_COST_MAP;
        const microCentsToCents = (microCents: number) => microCents / 1_000_000;

        return OPENAI_VIDEO_MODELS.map(model => {
            const result: IVideoModel = { ...model };

            const defaultCostMicroCents = OPENAI_VIDEO_COST_MAP[model.defaultUsageKey!];
            if ( defaultCostMicroCents !== undefined ) {
                const perSecondCost = microCentsToCents(defaultCostMicroCents);
                result.costs_currency = 'usd-cents';
                result.costs = {
                    'per-second': perSecondCost,
                    'default-duration-per-video': perSecondCost * DEFAULT_DURATION_SECONDS,
                };
                result.output_cost_key = 'default-duration-per-video';
            }

            if ( model.id === 'sora-2-pro' ) {
                const xlCostMicroCents = OPENAI_VIDEO_COST_MAP['openai:sora-2-pro:xl'];
                if ( xlCostMicroCents !== undefined ) {
                    if ( ! result.costs ) {
                        result.costs = {};
                        result.costs_currency = 'usd-cents';
                    }
                    const perSecondXlCost = microCentsToCents(xlCostMicroCents);
                    result.costs['per-second-xl'] = perSecondXlCost;
                    result.costs['default-duration-per-video-xl'] = perSecondXlCost * DEFAULT_DURATION_SECONDS;
                }

                const xxlCostMicroCents = OPENAI_VIDEO_COST_MAP['openai:sora-2-pro:xxl'];
                if ( xxlCostMicroCents !== undefined ) {
                    if ( ! result.costs ) {
                        result.costs = {};
                        result.costs_currency = 'usd-cents';
                    }
                    const perSecondXxlCost = microCentsToCents(xxlCostMicroCents);
                    result.costs['per-second-xxl'] = perSecondXxlCost;
                    result.costs['default-duration-per-video-xxl'] = perSecondXxlCost * DEFAULT_DURATION_SECONDS;
                }
            }

            return result;
        });
    }

    async generate (params: IGenerateVideoParams): Promise<unknown> {
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

        if ( typeof prompt !== 'string' || !prompt.trim() ) {
            throw APIError.create('field_invalid', null, {
                key: 'prompt',
                expected: 'a non-empty string',
                got: prompt,
            });
        }

        const selectedModel = this.#selectModel(requestedModel);

        if ( testMode ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'video',
            }, DEFAULT_TEST_VIDEO_URL);
        }

        const defaultSize = selectedModel.allowedResolutions?.[0] ?? '720x1280';
        const normalizedSize = this.#normalizeSize(size ?? resolution, selectedModel) ?? defaultSize;
        const normalizedSeconds = this.#normalizeSeconds(seconds ?? duration) ?? String(DEFAULT_DURATION_SECONDS);

        const usageKey = this.#determineUsageKey(selectedModel, normalizedSize);
        if ( ! usageKey ) {
            throw new Error(`Unsupported pricing tier for model ${selectedModel.id}`);
        }

        const estimatedUnits = this.#parseSeconds(normalizedSeconds) ?? DEFAULT_DURATION_SECONDS;
        const actor = Context.get('actor');
        const usageAllowed = await this.#meteringService.hasEnoughCreditsFor(actor, usageKey as any, estimatedUnits);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const createParams: Record<string, unknown> = {
            model: selectedModel.id,
            prompt,
            seconds: normalizedSeconds,
            size: normalizedSize,
        };

        if ( inputReference ) {
            createParams.input_reference = inputReference;
        }

        const createResponse = await (this.#openai as any).videos.create(createParams);
        const finalJob = await this.#pollUntilComplete(createResponse);

        if ( finalJob.status === 'failed' ) {
            const errorMessage = finalJob.error?.message ?? 'Video generation failed';
            throw new Error(errorMessage);
        }

        const finalResolution = this.#normalizeSize(finalJob.size, selectedModel) ?? normalizedSize;
        const finalUsageKey = this.#determineUsageKey(selectedModel, finalResolution);
        if ( ! finalUsageKey ) {
            throw new Error(`Unsupported pricing tier for model ${selectedModel.id}`);
        }

        const actualSeconds = this.#parseSeconds(finalJob.seconds) ?? estimatedUnits;

        const downloadResponse = await (this.#openai as any).videos.downloadContent(finalJob.id);
        const contentType = downloadResponse.headers.get('content-type') ?? 'video/mp4';

        let stream = downloadResponse.body;
        if ( stream && typeof stream.getReader === 'function' ) {
            stream = Readable.fromWeb(stream);
        }

        if ( ! stream ) {
            const arrayBuffer = await downloadResponse.arrayBuffer();
            stream = Readable.from(Buffer.from(arrayBuffer));
        }

        this.#meteringService.incrementUsage(actor, finalUsageKey as any, actualSeconds);

        return new TypedValue({
            $: 'stream',
            content_type: contentType,
        }, stream);
    }

    #selectModel (requestedModel?: string): IVideoModel {
        return OPENAI_VIDEO_MODELS.find(m => m.id === requestedModel) ?? OPENAI_VIDEO_MODELS[0];
    }

    async #pollUntilComplete (initialJob: any): Promise<any> {
        let job = initialJob;
        const start = Date.now();

        while ( job.status === 'queued' || job.status === 'in_progress' ) {
            if ( Date.now() - start > DEFAULT_TIMEOUT_MS ) {
                throw new Error('Timed out waiting for Sora video generation to complete');
            }

            await this.#delay(POLL_INTERVAL_MS);
            job = await (this.#openai as any).videos.retrieve(job.id);
        }

        return job;
    }

    async #delay (ms: number): Promise<void> {
        return await new Promise(resolve => setTimeout(resolve, ms));
    }

    #normalizeSize (candidate: unknown, model: IVideoModel): string | undefined {
        if ( ! candidate ) return undefined;
        const normalized = this.#normalizeResolution(candidate);
        if ( normalized && model.allowedResolutions?.includes(normalized) ) {
            return normalized;
        }
        return undefined;
    }

    #normalizeSeconds (value: unknown): string | undefined {
        if ( value === null || value === undefined ) {
            return undefined;
        }
        const parsed = typeof value === 'number' ? String(Math.round(value)) : typeof value === 'string' ? value.trim() : undefined;
        if ( parsed && OPENAI_VIDEO_ALLOWED_SECONDS.includes(Number(parsed) as typeof OPENAI_VIDEO_ALLOWED_SECONDS[number]) ) {
            return parsed;
        }
        return undefined;
    }

    #determineUsageKey (model: IVideoModel, size: string): string | null {
        if ( model.id === 'sora-2-pro' ) {
            if ( size === '1080x1920' || size === '1920x1080' ) {
                return 'openai:sora-2-pro:xxl';
            }
            if ( size === '1024x1792' || size === '1792x1024' ) {
                return 'openai:sora-2-pro:xl';
            }
        }
        return model.defaultUsageKey ?? null;
    }

    #normalizeResolution (value: unknown): string | undefined {
        if ( ! value ) return undefined;
        if ( typeof value === 'string' ) {
            const match = value.match(/(\d+)\s*x\s*(\d+)/i);
            if ( match ) {
                const w = Number.parseInt(match[1], 10);
                const h = Number.parseInt(match[2], 10);
                if ( Number.isFinite(w) && Number.isFinite(h) ) {
                    return `${w}x${h}`;
                }
            }
        }
        return undefined;
    }

    #parseSeconds (value: unknown): number | undefined {
        if ( value === null || value === undefined ) return undefined;
        if ( typeof value === 'number' && Number.isFinite(value) ) {
            return Math.round(value);
        }
        if ( typeof value === 'string' ) {
            const numeric = Number.parseInt(value, 10);
            return Number.isFinite(numeric) ? numeric : undefined;
        }
        return undefined;
    }
}