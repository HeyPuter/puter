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
import type { ICompleteArguments } from '../../types.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { BYTEPLUS_MODELS } from './models.js';

type BytePlusCustomParams = {
    response_format?: unknown;
    stop?: string[];
    // Ark-specific toggle for deep reasoning; the seed models reason by
    // default and route those tokens to `reasoning_content`.
    thinking?: {
        type?: 'enabled' | 'disabled' | 'auto';
    };
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/**
 * BytePlus ModelArk provider — an OpenAI-compatible endpoint serving
 * ByteDance's Seed models plus hosted third-party models (GLM, DeepSeek,
 * GPT-OSS). https://docs.byteplus.com/en/docs/ModelArk/1330626
 */
export class BytePlusProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL:
                    config.apiBaseUrl ??
                    'https://ark.ap-southeast.bytepluses.com/api/v3',
                ...sdkClientOptions(),
            }),
            defaultModel: 'seed-2-0-lite-260428',
            models: () => BYTEPLUS_MODELS,
            meteringPrefix: 'byteplus',
            passthrough: ['temperature', 'top_p'],
            stripAnthropicShape: true,
            compatParams: {},
        });
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
    ) {
        const customParams = asRecord(args.custom) as BytePlusCustomParams;
        // A normalized `stopSequences`/`outputFormat` wins over `custom`.
        return {
            ...(customParams.response_format
                ? { response_format: customParams.response_format }
                : {}),
            ...(customParams.stop ? { stop: customParams.stop } : {}),
            ...(customParams.thinking
                ? { thinking: customParams.thinking }
                : {}),
            ...params,
        };
    }
}
