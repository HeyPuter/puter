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
import { MINIMAX_MODELS } from './models.js';

export class MiniMaxProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL: config.apiBaseUrl ?? 'https://api.minimax.io/v1',
                ...sdkClientOptions(),
            }),
            defaultModel: 'minimax-m2.7',
            models: () => MINIMAX_MODELS,
            meteringPrefix: 'minimax',
            passthrough: ['temperature', 'top_p'],
            stripAnthropicShape: true,
            compatParams: { only: ['tool_choice'] },
        });
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
        model: IChatModel,
    ) {
        return {
            ...params,
            // MiniMax names its models in mixed case on the wire.
            model: model.apiModel,
            max_tokens: Math.min(args.max_tokens ?? 1000, model.max_tokens),
        };
    }
}
