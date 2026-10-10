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

import Groq from 'groq-sdk';
import type { CompletionUsage } from 'openai/resources';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { PuterMessage } from '../../types.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { GROQ_MODELS } from './models.js';

export class GroqAIProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new Groq({
                apiKey: config.apiKey,
                ...(config.apiBaseUrl ? { baseURL: config.apiBaseUrl } : {}),
                // groq-sdk's own default timeout.
                ...sdkClientOptions(60_000),
            }),
            defaultModel: 'openai/gpt-oss-20b',
            models: () => GROQ_MODELS,
            meteringPrefix: 'groq',
            maxTokensParam: 'max_completion_tokens',
            passthrough: ['temperature'],
            // Streamed usage arrives on `x_groq`.
            streamUsage: false,
            usageFromStreamChunk: (chunk: {
                x_groq?: { usage?: CompletionUsage };
            }) => chunk.x_groq?.usage,
        });
    }

    protected override prepareMessages(messages: PuterMessage[]) {
        for (const message of messages) {
            if (message.tool_calls && Array.isArray(message.content)) {
                message.content = '';
            }
        }
        return messages;
    }
}
