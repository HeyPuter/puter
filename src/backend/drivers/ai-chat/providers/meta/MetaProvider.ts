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
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import { upstreamUserIdentifier } from '../../../util/upstreamIdentifier.js';
import type { IChatModel, ICompleteArguments } from '../../types.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { META_MODELS, MUSE_SPARK_DEFAULT_MODEL } from './models.js';

const DEFAULT_API_BASE_URL = 'https://api.meta.ai/v1';

/**
 * Chat Completions params Muse Spark accepts that Puter has no first-class
 * argument for. Passed through `custom`.
 */
type MetaCustomParams = {
    frequency_penalty?: number;
    presence_penalty?: number;
    response_format?: unknown;
    seed?: number;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/**
 * Meta's Model API — the Muse Spark family, served OpenAI-compatible from
 * `https://api.meta.ai/v1`.
 *
 * Only the Chat Completions protocol is used here; Meta also fronts the same
 * models behind Responses- and Anthropic-Messages-shaped endpoints.
 */
export class MetaProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL: config.apiBaseUrl ?? DEFAULT_API_BASE_URL,
                ...sdkClientOptions(),
            }),
            defaultModel: MUSE_SPARK_DEFAULT_MODEL,
            models: () => META_MODELS,
            meteringPrefix: 'meta',
            // Reasoning tokens come out of this same budget, so a tight cap
            // returns `content: null` with `finish_reason: 'length'`.
            maxTokensParam: 'max_completion_tokens',
            passthrough: ['temperature', 'top_p'],
            // Anthropic-shaped cache hints don't belong on this wire; Meta
            // caches via `prompt_cache_key` / `prompt_cache_retention`.
            stripAnthropicShape: true,
            compatParams: { toolChoiceAutoOnly: true },
        });
    }

    override async complete(args: ICompleteArguments, resolved?: IChatModel) {
        if (!Array.isArray(args.messages)) {
            throw new HttpError(400, '`messages` must be an array', {
                legacyCode: 'bad_request',
            });
        }
        return super.complete(args, resolved);
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
        _model: IChatModel,
        actor: Actor | undefined,
    ) {
        const customParams = asRecord(args.custom) as MetaCustomParams;

        // Reasoning is always on for Muse Spark — `reasoning_effort: 'none'`
        // is a 400 — so a request to switch it off is dropped, not forwarded.
        const requestedEffort = (args.reasoning_effort ??
            args.reasoning?.effort) as string | undefined;
        const effort =
            requestedEffort && requestedEffort !== 'none'
                ? requestedEffort
                : undefined;

        // Puter spells the in-memory retention with a hyphen; Meta's enum
        // uses an underscore.
        const cacheRetention =
            args.prompt_cache_retention === 'in-memory'
                ? 'in_memory'
                : args.prompt_cache_retention;

        // The identifier is Puter's abuse attribution, so `custom` can't
        // override it. Cache key defaults to it; see upstreamUserIdentifier.
        const userIdentifier = upstreamUserIdentifier(actor);
        const cacheKey = args.prompt_cache_key ?? userIdentifier;

        const { reasoning_effort: _mapped, ...shared } = params;
        return {
            ...shared,
            ...(effort ? { reasoning_effort: effort } : {}),
            ...(cacheKey !== undefined ? { prompt_cache_key: cacheKey } : {}),
            ...(cacheRetention !== undefined
                ? { prompt_cache_retention: cacheRetention }
                : {}),
            ...(userIdentifier ? { safety_identifier: userIdentifier } : {}),
            ...(customParams.response_format
                ? { response_format: customParams.response_format }
                : {}),
            ...(customParams.frequency_penalty !== undefined
                ? { frequency_penalty: customParams.frequency_penalty }
                : {}),
            ...(customParams.presence_penalty !== undefined
                ? { presence_penalty: customParams.presence_penalty }
                : {}),
            ...(customParams.seed !== undefined
                ? { seed: customParams.seed }
                : {}),
        };
    }
}
