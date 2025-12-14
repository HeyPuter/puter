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

import { OpenAI } from 'openai';
import APIError from '../../../../../api/APIError.js';
import { ErrorService } from '../../../../../modules/core/ErrorService.js';
import { Context } from '../../../../../util/context.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { IGenerateParams, IImageModel, IImageProvider } from '../types.js';
import { XAI_IMAGE_GENERATION_MODELS } from './models.js';

const DEFAULT_MODEL = 'grok-2-image';
const PRICE_KEY = 'output';

export class XAIImageGenerationProvider implements IImageProvider {
    #client: OpenAI;
    #meteringService: MeteringService;
    #errors: ErrorService;

    constructor (config: { apiKey: string }, meteringService: MeteringService, errorService: ErrorService) {
        if ( ! config.apiKey ) {
            throw new Error('xAI image generation requires an API key');
        }

        this.#meteringService = meteringService;
        this.#errors = errorService;
        this.#client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://api.x.ai/v1',
        });
    }

    models (): IImageModel[] {
        return XAI_IMAGE_GENERATION_MODELS;
    }

    getDefaultModel (): string {
        return DEFAULT_MODEL;
    }

    async generate (params: IGenerateParams): Promise<string> {
        const { prompt, test_mode } = params;
        let { model } = params;

        const selectedModel = this.#getModel(model);

        if ( test_mode ) {
            return 'https://puter-sample-data.puter.site/image_example.png';
        }

        if ( typeof prompt !== 'string' || prompt.trim().length === 0 ) {
            throw new Error('`prompt` must be a non-empty string');
        }

        const actor = Context.get('actor');
        const user_private_uid = actor?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.#errors.report('xai-image-generation:unknown-user', {
                message: 'failed to get a user ID for an xAI request',
                alarm: true,
                trace: true,
            });
        }

        const priceInCents = selectedModel.costs[PRICE_KEY];
        const costInMicroCents = priceInCents * 1_000_000;
        const usageAllowed = await this.#meteringService.hasEnoughCredits(actor, costInMicroCents);

        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const response = await this.#client.images.generate({
            model: selectedModel.id,
            prompt,
            user: user_private_uid,
        });

        const first = response.data?.[0] as { url?: string; b64_json?: string } | undefined;
        const url = first?.url || (first?.b64_json ? `data:image/png;base64,${ first.b64_json}` : undefined);

        if ( ! url ) {
            throw new Error('Failed to extract image URL from xAI response');
        }

        this.#meteringService.incrementUsage(actor, `xai:${selectedModel.id}:${PRICE_KEY}`, 1, costInMicroCents);

        return url;
    }

    #getModel (model?: string) {
        const models = this.models();
        const found = models.find(m => m.id === model || m.aliases?.includes(model ?? ''));
        return found || models.find(m => m.id === DEFAULT_MODEL)!;
    }
}
