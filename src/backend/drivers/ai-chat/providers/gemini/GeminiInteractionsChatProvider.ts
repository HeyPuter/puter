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

import { GoogleGenAI, type Interactions } from '@google/genai';
import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import {
    interactionStreamToChunks,
    interactionToCompletion,
    messagesToInteractionsInput,
    toGenerationConfig,
    toolsToInteractionsTools,
    type IOpenAIUsage,
} from '../../../util/interactions/index.js';
import type {
    IChatModel,
    IChatProvider,
    ICompleteArguments,
} from '../../types.js';
import {
    handle_completion_output,
    process_input_messages,
} from '../../utils/OpenAIUtil.js';
import { buildCostsOverride } from '../../utils/pricing.js';
import { GEMINI_MODELS } from './models.js';

/**
 * Gemini over the Interactions API.
 *
 * Serves the same catalog as [[GeminiChatProvider]], which reaches Gemini
 * through Google's OpenAI-compatible shim. Two routes to one model is the shape
 * the driver's model map already expects, so this registers as its own
 * provider: callers pin it with `provider: 'gemini-interactions'`, everyone
 * else keeps the shim, and either can cover for the other when a route fails.
 *
 * The translation lives in `drivers/util/interactions`; this class is the thin
 * part — metering and the request/response handoff.
 */
export class GeminiInteractionsChatProvider implements IChatProvider {
    #client: GoogleGenAI;
    #meteringService: MeteringService;

    // Matches the OpenAI-compat route's default: swapping transports must not
    // also swap which model an unspecified request lands on.
    defaultModel = 'gemini-2.5-flash';

    constructor(meteringService: MeteringService, config: { apiKey: string }) {
        this.#meteringService = meteringService;
        this.#client = new GoogleGenAI({ apiKey: config.apiKey });
    }

    getDefaultModel() {
        return this.defaultModel;
    }

    async models(): Promise<IChatModel[]> {
        // Copied, not shared: the driver's model map appends `puterId` onto
        // `aliases` in place, and the shim provider hands out these same
        // entries.
        return GEMINI_MODELS.map((model) => ({
            ...model,
            aliases: [...(model.aliases ?? [])],
        }));
    }

    async list() {
        return (await this.models())
            .map((m) => [m.id, ...(m.aliases || [])])
            .flat();
    }

    async complete(
        args: ICompleteArguments,
    ): ReturnType<IChatProvider['complete']> {
        const {
            messages,
            stream,
            model,
            tools,
            tool_choice,
            max_tokens,
            temperature,
            top_p,
            reasoning,
            reasoning_effort,
            previous_response_id,
        } = args;

        if (previous_response_id) {
            // Interactions ids are scoped to our API key, not to the caller, so
            // honouring a caller-supplied one would let any app pull another
            // user's stored turn into its context. Server-side state needs an
            // ownership record before it can be exposed; until then this path
            // stays closed rather than half-open.
            throw new HttpError(
                400,
                'previous_response_id is not supported on gemini-interactions; resend the conversation in `messages`',
                { legacyCode: 'bad_request' },
            );
        }

        const actor = Context.get('actor');
        const normalized = await process_input_messages(messages);
        for (const message of normalized) {
            delete message.cache_control;
        }

        const catalog = await this.models();
        const modelUsed =
            catalog.find((m) => [m.id, ...(m.aliases || [])].includes(model)) ??
            catalog.find((m) => m.id === this.getDefaultModel())!;

        const { input, system_instruction } =
            messagesToInteractionsInput(normalized);
        const generation_config = toGenerationConfig({
            max_tokens,
            temperature,
            top_p,
            tool_choice,
            reasoning_effort,
            reasoning,
        });

        const interactionsTools = toolsToInteractionsTools(tools);
        const params = {
            model: modelUsed.id,
            input,
            ...(system_instruction ? { system_instruction } : {}),
            ...(interactionsTools ? { tools: interactionsTools } : {}),
            ...(generation_config ? { generation_config } : {}),
            // Puter's chat API is stateless — the caller resends history every
            // turn — so there is nothing here worth Google retaining for 55
            // days on our behalf.
            store: false,
            stream,
        };

        let completion;
        try {
            if (stream) {
                const events = await this.#client.interactions.create({
                    ...params,
                    stream: true,
                } as Interactions.CreateModelInteractionParamsStreaming);
                completion = interactionStreamToChunks(events, {
                    model: modelUsed.id,
                });
            } else {
                const interaction = await this.#client.interactions.create({
                    ...params,
                    stream: false,
                } as Interactions.CreateModelInteractionParamsNonStreaming);
                completion = interactionToCompletion(interaction, {
                    model: modelUsed.id,
                });
            }
        } catch (e) {
            console.error('Gemini interactions error: ', e);
            throw e;
        }

        return handle_completion_output({
            stream,
            completion,
            usage_calculator: (calculatorArgs) => {
                const usage = calculatorArgs.usage as unknown as IOpenAIUsage;

                const cached_tokens =
                    usage?.prompt_tokens_details?.cached_tokens ?? 0;
                const thinking_tokens =
                    usage?.completion_tokens_details?.reasoning_tokens ?? 0;

                const trackedUsage = {
                    prompt_tokens: (usage?.prompt_tokens ?? 0) - cached_tokens,
                    completion_tokens: Math.max(
                        0,
                        (usage?.completion_tokens ?? 0) - thinking_tokens,
                    ),
                    cached_tokens,
                    thinking_tokens,
                    tool_use_tokens: usage?.tool_use_tokens ?? 0,
                    // A real count, where the shim provider can only infer that
                    // grounding happened at all and bill it as one request.
                    grounding_requests: usage?.grounding_requests ?? 0,
                };

                this.#meteringService.utilRecordUsageObject(
                    trackedUsage,
                    actor!,
                    // Same ledger key as the shim route: same vendor, same
                    // model, same price — only the transport differs.
                    `gemini:${modelUsed.id}`,
                    buildCostsOverride(trackedUsage, modelUsed),
                );

                return trackedUsage;
            },
        });
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('No moderation logic.');
    }
}
