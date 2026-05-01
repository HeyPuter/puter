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
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatProvider, ICompleteArguments } from '../../types.js';
import * as OpenAIUtil from '../../utils/OpenAIUtil.js';
import { ZAI_MODELS } from './models.js';

type ZAIConfig = {
    apiBaseUrl?: string;
    apiKey: string;
};

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
    user_id?: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

export class ZAIProvider implements IChatProvider {
    #openai: OpenAI;

    #meteringService: MeteringService;

    #defaultModel = 'glm-5.1';

    constructor(config: ZAIConfig, meteringService: MeteringService) {
        this.#openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiBaseUrl ?? 'https://api.z.ai/api/paas/v4',
        });
        this.#meteringService = meteringService;
    }

    getDefaultModel() {
        return this.#defaultModel;
    }

    models() {
        return ZAI_MODELS;
    }

    list() {
        const modelIds: string[] = [];
        for (const model of this.models()) {
            modelIds.push(model.id);
            if (model.aliases) {
                modelIds.push(...model.aliases);
            }
        }
        return modelIds;
    }

    async complete(
        params: ICompleteArguments,
    ): ReturnType<IChatProvider['complete']> {
        const {
            custom,
            max_tokens,
            stream,
            temperature,
            tools,
            tool_choice,
            top_p,
        } = params;
        let { messages, model } = params;
        const actor = Context.get('actor');
        const availableModels = this.models();
        const modelUsed =
            availableModels.find((m) =>
                [m.id, ...(m.aliases || [])].includes(model),
            ) || availableModels.find((m) => m.id === this.getDefaultModel())!;

        messages = await OpenAIUtil.process_input_messages(messages);
        messages = messages.map((message) => {
            delete message.cache_control;
            return message;
        });

        const customParams = asRecord(custom) as ZAICustomParams;
        const userId =
            customParams.user_id ??
            (actor?.user?.id
                ? `puter-${actor.user.id}${actor.app?.uid ? `-${actor.app.uid}` : ''}`.slice(
                      0,
                      128,
                  )
                : undefined);

        const completionParams: ChatCompletionCreateParams = {
            messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(tool_choice !== undefined ? { tool_choice } : {}),
            ...(max_tokens !== undefined ? { max_tokens } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p } : {}),
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
            stream: !!stream,
            ...(stream
                ? {
                      stream_options: { include_usage: true },
                  }
                : {}),
        } as ChatCompletionCreateParams;

        const completion =
            await this.#openai.chat.completions.create(completionParams);

        const result = await OpenAIUtil.handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = usage
                    ? OpenAIUtil.extractMeteredUsage(usage)
                    : {
                          prompt_tokens: 0,
                          completion_tokens: 0,
                          cached_tokens: 0,
                      };
                const costsOverrideFromModel = Object.fromEntries(
                    Object.entries(trackedUsage).map(([key, value]) => {
                        return [key, value * Number(modelUsed.costs[key] ?? 0)];
                    }),
                );
                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor,
                    `zai:${modelUsed.id}`,
                    costsOverrideFromModel,
                );
                return trackedUsage;
            },
            stream,
            completion,
        });

        this.#normalizeReasoningContent(result);
        return result;
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }

    #normalizeReasoningContent(
        result: Awaited<ReturnType<IChatProvider['complete']>>,
    ) {
        if (!('message' in result) || !result.message) return;

        const message = result.message as Record<string, unknown>;
        if (
            message.reasoning === undefined &&
            message.reasoning_content !== undefined
        ) {
            message.reasoning = message.reasoning_content;
        }
        delete message.reasoning_content;

        if (!Array.isArray(message.content)) return;

        for (const contentPart of message.content) {
            const part = asRecord(contentPart);
            if (
                part.reasoning === undefined &&
                part.reasoning_content !== undefined
            ) {
                part.reasoning = part.reasoning_content;
            }
            delete part.reasoning_content;
        }
    }
}
