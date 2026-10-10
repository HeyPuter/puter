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

// Preamble: Before this we used Gemini's SDK directly and as we found out
// its actually kind of terrible. So we use the openai sdk now
import { OpenAI } from 'openai';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { PuterMessage } from '../../types.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
    type UsageSource,
} from '../OpenAICompatProvider.js';
import { GEMINI_MODELS } from './models.js';

type GroundingContent = { grounding_metadata?: unknown };

export class GeminiChatProvider extends OpenAICompatProvider {
    constructor(meteringService: MeteringService, config: ChatProviderConfig) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL:
                    config.apiBaseUrl ??
                    'https://generativelanguage.googleapis.com/v1beta/openai/',
                ...sdkClientOptions(),
            }),
            defaultModel: 'gemini-2.5-flash',
            models: () => GEMINI_MODELS,
            meteringPrefix: 'gemini',
            maxTokensParam: 'max_completion_tokens',
            passthrough: ['temperature'],
            // Gemini 3.1+ rejects http(s) image URLs on Google's
            // OpenAI-compatible endpoint (bodiless 400) but accepts data URLs;
            // inline for every model rather than maintain a version list.
            inlineImages: 'always',
        });
    }

    protected override prepareMessages(messages: PuterMessage[]) {
        for (const message of messages) delete message.cache_control;
        return messages;
    }

    protected override meteredUsage(source: UsageSource) {
        // Non-stream grounding metadata lives in choices[0].message; a stream
        // hands over what its handler accumulated as `extra_content`.
        const { usage } = source;
        const choices = source.choices as
            | Array<{ message?: { extra_content?: GroundingContent } }>
            | undefined;
        const extraContent = source.extra_content as
            | GroundingContent
            | undefined;

        const cached_tokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
        // Thinking tokens are a subset of completion_tokens billed at a different rate
        const thinking_tokens =
            usage?.completion_tokens_details?.reasoning_tokens ?? 0;

        return {
            usage: {
                prompt_tokens: (usage?.prompt_tokens ?? 0) - cached_tokens,
                completion_tokens: Math.max(
                    0,
                    (usage?.completion_tokens ?? 0) - thinking_tokens,
                ),
                cached_tokens,
                thinking_tokens,
                // Grounding search is a per-request fee not reflected in token counts
                grounding_requests:
                    (choices?.[0]?.message?.extra_content?.grounding_metadata ??
                    extraContent?.grounding_metadata)
                        ? 1
                        : 0,
            },
        };
    }
}
