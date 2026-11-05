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
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type {
    IChatModel,
    ICompleteArguments,
    PuterMessage,
} from '../../types.js';
import { openAICompatParams } from '../../utils/openaiParams.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import { estimateTextTokens } from '../../utils/usageEstimate.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { MOONSHOT_MODELS } from './models.js';

/**
 * The K3-series request shape: reasoning always on, capped by
 * `max_completion_tokens`.
 */
const K31_MODEL_IDS = new Set(['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed']);
const K31_REASONING_EFFORTS = ['low', 'high', 'max'];
/** Moonshot's own output cap when the request names none. */
const K31_DEFAULT_MAX_COMPLETION_TOKENS = 131_072;

const isK31 = (model: IChatModel) => K31_MODEL_IDS.has(model.id);

/** A replayed assistant turn's reasoning, under the wire key or Puter's. */
const replayedReasoning = (message: PuterMessage): string | undefined => {
    const reasoning = message.reasoning_content ?? message.reasoning;
    return typeof reasoning === 'string' ? reasoning : undefined;
};

export class MoonshotProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL: config.apiBaseUrl ?? 'https://api.moonshot.ai/v1',
                ...sdkClientOptions(),
            }),
            defaultModel: 'kimi-k2.6',
            models: () => MOONSHOT_MODELS,
            meteringPrefix: 'moonshotai',
            // Moonshot's vision API doesn't fetch http(s) URLs.
            inlineImages: 'vision',
        });
    }

    /**
     * K3.1 Pro reads replayed reasoning back as prompt, which the message
     * estimate the credit gate works from doesn't count.
     */
    requestPricing(args: ICompleteArguments, model: IChatModel) {
        if (!isK31(model)) return {};
        const additionalPromptTokens = (args.messages ?? []).reduce(
            (tokens, message) => {
                if (message.role !== 'assistant') return tokens;
                const reasoning = replayedReasoning(message);
                return tokens + (reasoning ? estimateTextTokens(reasoning) : 0);
            },
            0,
        );
        return { additionalPromptTokens };
    }

    protected override preservesToolCallOrder(model: IChatModel) {
        return isK31(model);
    }

    protected override preservesAssistantContent(model: IChatModel) {
        return isK31(model);
    }

    /** K3.1 Pro wants a turn's reasoning back under `reasoning_content`, once. */
    protected override prepareMessages(
        messages: PuterMessage[],
        model: IChatModel,
    ) {
        if (!isK31(model)) return messages;
        return messages.map((message) => {
            if (message.role !== 'assistant') return message;
            const { reasoning, normalized: _normalized, ...rest } = message;
            const replayed = replayedReasoning(message);
            return replayed === undefined
                ? rest
                : { ...rest, reasoning_content: replayed };
        });
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
        model: IChatModel,
    ) {
        if (!isK31(model)) return params;
        const effort = args.reasoning_effort ?? args.reasoning?.effort;
        if (effort !== undefined && !K31_REASONING_EFFORTS.includes(effort)) {
            throw new HttpError(
                400,
                `reasoning_effort must be one of ${K31_REASONING_EFFORTS.join(', ')} for ${model.id}`,
                { legacyCode: 'bad_request' },
            );
        }
        // The K3 series deprecates `max_tokens` in favour of `max_completion_tokens`.
        const { max_tokens, ...rest } = params;
        return {
            ...rest,
            ...openAICompatParams(
                { ...args, reasoning_effort: effort },
                'chat',
                {
                    only: [
                        'tool_choice',
                        'response_format',
                        'reasoning_effort',
                    ],
                },
            ),
            max_completion_tokens:
                max_tokens ?? K31_DEFAULT_MAX_COMPLETION_TOKENS,
        };
    }
}
