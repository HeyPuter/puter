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
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatModel, ICompleteArguments } from '../../types.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { HOONIFY_MODELS } from './models.js';

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/**
 * Chat provider for Hoonify (https://hoonify.ai) — open-weights inference
 * behind an OpenAI-compatible API at https://api.hoonify.ai/v1.
 */
export class HoonifyProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL: config.apiBaseUrl ?? 'https://api.hoonify.ai/v1',
                ...sdkClientOptions(),
            }),
            defaultModel: 'hoonify:google/gemma-4-31b-it',
            models: () => HOONIFY_MODELS,
            passthrough: ['temperature', 'top_p'],
            // Anthropic-style shape is not part of Hoonify's surface; drop it
            // rather than risk a 400.
            stripAnthropicShape: true,
            compatParams: { only: ['tool_choice'] },
        });
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
        model: IChatModel,
    ) {
        const topK = asRecord(args.custom).top_k;
        return {
            ...params,
            // The catalog id is lowercased; the wire wants Hoonify's casing.
            model: model.wireId,
            // Hoonify extension: sample from the top-k logits.
            ...(topK !== undefined ? { top_k: topK } : {}),
        };
    }
}
