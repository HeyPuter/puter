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
import type { Actor } from '../../../../core/actor.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { upstreamUserIdentifier } from '../../../util/upstreamIdentifier.js';
import type { IChatModel, ICompleteArguments } from '../../types.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { ZAI_MODELS } from './models.js';

// Z.AI documents `user_id` as 6-128 characters.
const USER_ID_MAX_LENGTH = 128;

type ZAICustomParams = {
    do_sample?: boolean;
    request_id?: string;
    response_format?: unknown;
    stop?: string[];
    thinking?: {
        type?: 'enabled' | 'disabled';
        clear_thinking?: boolean;
    };
    tool_stream?: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

export class ZAIProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL: config.apiBaseUrl ?? 'https://api.z.ai/api/paas/v4',
                ...sdkClientOptions(),
            }),
            defaultModel: 'glm-5.1',
            models: () => ZAI_MODELS,
            meteringPrefix: 'zai',
            passthrough: ['temperature', 'top_p'],
            stripAnthropicShape: true,
            compatParams: { only: ['tool_choice'], toolChoiceAutoOnly: true },
        });
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
        _model: IChatModel,
        actor: Actor | undefined,
    ) {
        const customParams = asRecord(args.custom) as ZAICustomParams;
        // Puter's abuse attribution; `custom` can't override it.
        const userId = upstreamUserIdentifier(actor, USER_ID_MAX_LENGTH);
        return {
            ...params,
            ...(customParams.do_sample !== undefined
                ? { do_sample: customParams.do_sample }
                : {}),
            ...(customParams.request_id
                ? { request_id: customParams.request_id }
                : {}),
            ...(customParams.response_format
                ? { response_format: customParams.response_format }
                : {}),
            ...(customParams.stop ? { stop: customParams.stop } : {}),
            ...(customParams.thinking
                ? { thinking: customParams.thinking }
                : {}),
            ...(customParams.tool_stream !== undefined
                ? { tool_stream: customParams.tool_stream }
                : {}),
            ...(userId ? { user_id: userId } : {}),
        };
    }
}
