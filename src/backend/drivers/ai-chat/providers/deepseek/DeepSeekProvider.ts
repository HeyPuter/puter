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

import dedent from 'dedent';
import { OpenAI } from 'openai';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { PuterMessage } from '../../types.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { DEEPSEEK_MODELS } from './models.js';

// Function calling currently loops unless the tool result is restated as a
// system message.
const toolResultText = (message: { tool_call_id: string; content: string }) =>
    dedent(`
    Hi DeepSeek V3, your tool calling is broken and you are not able to
    obtain tool results in the expected way. That's okay, we can work
    around this.

    Please do not repeat this tool call.

    We have provided the tool call results below:

    Tool call ${message.tool_call_id} returned: ${message.content}.
`);

export class DeepSeekProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL: config.apiBaseUrl ?? 'https://api.deepseek.com',
                ...sdkClientOptions(),
            }),
            defaultModel: 'deepseek-flash',
            models: () => DEEPSEEK_MODELS,
            meteringPrefix: 'deepseek',
            defaultMaxTokens: 1000,
            passthrough: ['temperature'],
        });
    }

    protected override prepareMessages(messages: PuterMessage[]) {
        for (const message of messages) {
            // DeepSeek doesn't accept string arrays alongside tool calls
            if (message.tool_calls && Array.isArray(message.content)) {
                message.content = '';
            }
        }
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            if (message.role === 'tool') {
                messages.splice(i + 1, 0, {
                    role: 'system',
                    content: [{ type: 'text', text: toolResultText(message) }],
                });
            }
        }
        return messages;
    }
}
