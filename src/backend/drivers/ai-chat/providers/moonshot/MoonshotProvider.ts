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
import type {
    ChatCompletion,
    ChatCompletionChunk,
} from 'openai/resources/chat/completions.js';
import type { Stream } from 'openai/streaming.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type {
    IChatModel,
    ICompleteArguments,
    PuterMessage,
} from '../../types.js';
import { CompletionAccountingError } from '../../utils/meterChatUsage.js';
import { openAICompatParams } from '../../utils/openaiParams.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    type ChatCompletionsClient,
    type UsageSource,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { MOONSHOT_MODELS } from './models.js';

const isK31 = (id: unknown) =>
    id === 'kimi-k3.1-pro' || id === 'kimi-k3.1-pro-highspeed';

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

    requestPricing(_args: ICompleteArguments, model: IChatModel) {
        // Appended prefixes can inherit a one-hour cache entry's write rate.
        return isK31(model.id) ? { inputKey: 'cache_write_1h_tokens' } : {};
    }

    protected override preservesToolCallOrder(model: IChatModel) {
        return isK31(model.id);
    }

    protected override preservesAssistantContent(model: IChatModel) {
        return isK31(model.id);
    }

    protected override prepareMessages(
        messages: PuterMessage[],
        model: IChatModel,
    ) {
        if (!isK31(model.id)) return messages;
        return messages.map((message) => {
            if (message.role !== 'assistant') return message;
            const { reasoning, normalized: _normalized, ...rest } = message;
            return {
                ...rest,
                ...(rest.reasoning_content === undefined &&
                reasoning !== undefined
                    ? { reasoning_content: reasoning }
                    : {}),
            };
        });
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
        model: IChatModel,
    ) {
        if (!isK31(model.id)) return params;
        if (
            args.reasoning_effort &&
            !['low', 'high', 'max'].includes(args.reasoning_effort)
        ) {
            throw new HttpError(
                400,
                'Kimi K3.1 Pro reasoning_effort must be low, high, or max',
                {
                    legacyCode: 'bad_request',
                },
            );
        }
        const { max_tokens, ...rest } = params;
        return {
            ...rest,
            ...openAICompatParams(args, 'chat', {
                only: ['tool_choice', 'response_format', 'reasoning_effort'],
            }),
            max_completion_tokens: max_tokens ?? 131_072,
        };
    }

    protected override async createCompletion(
        client: ChatCompletionsClient,
        params: Record<string, unknown>,
        signal?: AbortSignal,
    ): Promise<unknown> {
        if (!isK31(params.model))
            return super.createCompletion(client, params, signal);
        // TTL is locked by the cached prefix, so bill the response's TTL breakdown.
        const { data, response } = await (client as OpenAI).chat.completions
            .create(params as never, { signal })
            .withResponse();
        const fiveMinuteWrites = response.headers.get(
            'Msh-Usage-Cache-Write-Tokens-5m',
        );
        const oneHourWrites = response.headers.get(
            'Msh-Usage-Cache-Write-Tokens-1h',
        );
        const addWriteUsage = (
            completion: ChatCompletion | ChatCompletionChunk,
        ) => {
            if (completion.usage) {
                Object.assign(completion.usage, {
                    moonshotCacheWrite1hTokens: oneHourWrites,
                    moonshotCacheWrite5mTokens: fiveMinuteWrites,
                });
            }
            return completion;
        };
        if (!params.stream) return addWriteUsage(data as ChatCompletion);
        return (async function* () {
            for await (const chunk of data as Stream<ChatCompletionChunk>) {
                yield addWriteUsage(chunk);
            }
        })();
    }

    protected override meteredUsage(source: UsageSource, model: IChatModel) {
        if (!isK31(model.id)) return super.meteredUsage(source, model);
        const usage = source.usage as typeof source.usage & {
            moonshotCacheWrite1hTokens?: string | null;
            moonshotCacheWrite5mTokens?: string | null;
            prompt_tokens_details?: {
                cached_tokens?: number;
                cache_write_tokens?: number;
            };
        };
        const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
        const written = usage.prompt_tokens_details?.cache_write_tokens ?? 0;
        const fiveMinuteHeader = usage.moonshotCacheWrite5mTokens;
        const oneHourHeader = usage.moonshotCacheWrite1hTokens;
        const oneHour =
            oneHourHeader != null
                ? Number(oneHourHeader)
                : fiveMinuteHeader != null
                  ? written - Number(fiveMinuteHeader)
                  : 0;
        if (
            (written > 0 &&
                oneHourHeader == null &&
                fiveMinuteHeader == null) ||
            !Number.isSafeInteger(oneHour) ||
            oneHour < 0 ||
            oneHour > written ||
            (fiveMinuteHeader != null &&
                Number(fiveMinuteHeader) !== written - oneHour) ||
            fiveMinuteHeader === '' ||
            oneHourHeader === ''
        ) {
            throw new CompletionAccountingError();
        }
        return {
            usage: {
                prompt_tokens: usage.prompt_tokens - cached - written,
                completion_tokens: usage.completion_tokens,
                cached_tokens: cached,
                cache_write_tokens: written - oneHour,
                cache_write_1h_tokens: oneHour,
            },
            usageDetails: {
                inputTokens: usage.prompt_tokens - cached - written,
                outputTokens: usage.completion_tokens,
                cacheReadTokens: cached,
                cacheWrite5mTokens: written - oneHour,
                cacheWrite1hTokens: oneHour,
            },
        };
    }
}
