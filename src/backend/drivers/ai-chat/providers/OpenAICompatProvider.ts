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

import type { CompletionUsage } from 'openai/resources/completions.mjs';
import type { Actor } from '../../../core/actor.js';
import { Context } from '../../../core/context.js';
import { HttpError } from '../../../core/http/HttpError.js';
import type { MeteringService } from '../../../services/metering/MeteringService.js';
import type {
    IChatCompleteResult,
    IChatModel,
    IChatProvider,
    ICompleteArguments,
    PuterMessage,
} from '../types.js';
import {
    contextLengthRetryParams,
    isContextLengthError,
} from '../utils/contextLimit.js';
import { make_openai_tools } from '../utils/FunctionCalling.js';
import { inlineHttpImageUrls } from '../utils/inlineImages.js';
import { modelSupportsVision } from '../utils/mediaParts.js';
import {
    meterChatUsage,
    type MeterChatUsageOptions,
} from '../utils/meterChatUsage.js';
import { normalizeModelKey } from '../utils/modelRouting.js';
import * as OpenAIUtil from '../utils/OpenAIUtil.js';
import {
    openAICompatParams,
    type OpenAIDialect,
} from '../utils/openaiParams.js';

/** What the driver hands every keyed provider. */
export interface ChatProviderConfig {
    apiKey: string;
    apiBaseUrl?: string;
}

/**
 * The part of an OpenAI-compatible SDK client (openai, groq-sdk, together-ai)
 * used here.
 */
export interface ChatCompletionsClient {
    chat: {
        completions: {
            create(
                params: never,
                options: { signal?: AbortSignal },
            ): Promise<unknown>;
        };
    };
}

/** A completion's usage plus whatever else the upstream returned beside it. */
export type UsageSource = {
    usage: CompletionUsage;
    setUsageCosts: (costs: Record<string, number>) => void;
} & Record<string, unknown>;

/**
 * The data that sets one vendor apart; behaviour lives in the overridable
 * hooks.
 */
export interface OpenAICompatOptions {
    client: ChatCompletionsClient;
    defaultModel: string;
    /** A static catalog; a gateway overrides `models()` instead. */
    models?: () => IChatModel[];
    /** Usage is recorded under `<prefix>:<id>`; the bare id when omitted. */
    meteringPrefix?: string;
    /** Stripped from the catalog id to get the model name on the wire. */
    idPrefix?: string;
    /** Wire name of the output cap; `max_tokens` when omitted. */
    maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
    /** Sent when the caller set no output cap. */
    defaultMaxTokens?: number;
    /** Request fields forwarded as-is when set. */
    passthrough?: ('temperature' | 'top_p')[];
    /**
     * `openAICompatParams` options for `tool_choice`, `stop`, `response_format`
     * and the rest of the fields it maps. Omitted, none of them are sent.
     */
    compatParams?: {
        dialect?: OpenAIDialect;
        only?: string[];
        toolChoiceAutoOnly?: boolean;
    };
    /** Strip Anthropic-only message shape first (`toOpenAIChatMessages`). */
    stripAnthropicShape?: boolean | 'keepCacheControl';
    /** Inline http(s) image URLs for every model, or only vision models. */
    inlineImages?: 'always' | 'vision';
    /** Off for an upstream that reports stream usage its own way. */
    streamUsage?: boolean;
    /** Where a stream chunk carries usage, when not at `chunk.usage`. */
    usageFromStreamChunk?: (chunk: never) => unknown;
    /** Retry a context-length rejection under the room the window leaves. */
    retryOnContextLength?: boolean;
}

/**
 * One provider for every vendor speaking the OpenAI Chat Completions dialect. A
 * vendor is an `OpenAICompatOptions` entry plus whichever hooks below its API
 * needs.
 */
export class OpenAICompatProvider implements IChatProvider {
    readonly #metering: MeteringService;

    readonly #options: OpenAICompatOptions;

    /** Lookup by id or alias, built once per catalog array. */
    #index = new WeakMap<readonly IChatModel[], Map<string, IChatModel>>();

    constructor(metering: MeteringService, options: OpenAICompatOptions) {
        this.#metering = metering;
        this.#options = options;
    }

    getDefaultModel() {
        return this.#options.defaultModel;
    }

    models(): IChatModel[] | Promise<IChatModel[]> {
        return this.#options.models?.() ?? [];
    }

    /** The model key this provider records usage under. */
    meteringModelKey(modelId: string): string {
        const prefix = this.#options.meteringPrefix;
        return prefix ? `${prefix}:${modelId}` : modelId;
    }

    checkModeration(
        _text: string,
    ): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('Method not implemented.');
    }

    async complete(
        args: ICompleteArguments,
        resolved?: IChatModel,
    ): Promise<IChatCompleteResult> {
        const options = this.#options;
        const model = resolved ?? (await this.resolveModel(args.model));
        const actor = Context.get('actor');
        const signal = Context.get('abortSignal');

        let messages = args.messages;
        if (
            options.inlineImages === 'always' ||
            (options.inlineImages === 'vision' && modelSupportsVision(model))
        ) {
            await inlineHttpImageUrls(messages);
        }
        if (options.stripAnthropicShape) {
            messages = OpenAIUtil.toOpenAIChatMessages(messages, {
                keepCacheControl:
                    options.stripAnthropicShape === 'keepCacheControl',
            });
        }
        messages = this.prepareMessages(
            await OpenAIUtil.process_input_messages(messages),
        );

        const tools = args.tools
            ? make_openai_tools(args.tools, { dialect: 'chat' })
            : undefined;
        const maxTokens = args.max_tokens ?? options.defaultMaxTokens;
        const streamUsage = options.streamUsage ?? true;
        const shared: Record<string, unknown> = {
            messages,
            model: model.id.slice(
                options.idPrefix && model.id.startsWith(options.idPrefix)
                    ? options.idPrefix.length
                    : 0,
            ),
            ...(tools?.length ? { tools } : {}),
            ...(maxTokens !== undefined
                ? { [options.maxTokensParam ?? 'max_tokens']: maxTokens }
                : {}),
            ...Object.fromEntries(
                (options.passthrough ?? [])
                    .filter((field) => args[field] !== undefined)
                    .map((field) => [field, args[field]]),
            ),
            stream: !!args.stream,
            ...(args.stream && streamUsage
                ? { stream_options: { include_usage: true } }
                : {}),
            ...(options.compatParams
                ? openAICompatParams(
                      { ...args, tools },
                      options.compatParams.dialect ?? 'chat',
                      options.compatParams,
                  )
                : {}),
        };
        const params = this.vendorParams(shared, args, model, actor);

        let completion;
        try {
            completion = await options.client.chat.completions.create(
                params as never,
                { signal },
            );
        } catch (e) {
            const retryParams =
                options.retryOnContextLength && isContextLengthError(e)
                    ? contextLengthRetryParams(
                          params as { max_tokens?: number; messages: unknown },
                          { error: e, contextWindow: model.context },
                      )
                    : undefined;
            if (!retryParams) throw e;
            completion = await options.client.chat.completions.create(
                retryParams as never,
                { signal },
            );
        }

        return OpenAIUtil.handle_completion_output({
            ...(options.usageFromStreamChunk
                ? {
                      deviations: {
                          index_usage_from_stream_chunk:
                              options.usageFromStreamChunk,
                      },
                  }
                : {}),
            usage_calculator: (source: UsageSource) => {
                const { usage, meterOptions } = this.meteredUsage(
                    source,
                    model,
                );
                const metered = meterChatUsage(
                    this.#metering,
                    actor,
                    this.meteringModelKey(model.id),
                    model,
                    usage,
                    meterOptions,
                );
                source.setUsageCosts(metered.costs);
                return this.reportedUsage(metered.usage);
            },
            stream: args.stream,
            completion,
        });
    }

    /**
     * The catalog entry for a requested id or alias, case-insensitively, for a
     * caller that didn't pass the one the driver resolved.
     */
    protected async resolveModel(requested: string): Promise<IChatModel> {
        const models = await this.models();
        let index = this.#index.get(models);
        if (!index) {
            index = new Map();
            for (const entry of models) {
                for (const name of [entry.id, ...(entry.aliases ?? [])]) {
                    const key = normalizeModelKey(name);
                    if (!index.has(key)) index.set(key, entry);
                }
            }
            this.#index.set(models, index);
        }
        const model = index.get(normalizeModelKey(requested ?? ''));
        if (!model) {
            throw new HttpError(400, `Model not found: ${requested}`, {
                legacyCode: 'bad_request',
            });
        }
        return model;
    }

    // -- Vendor hooks ---------------------------------------------------

    /** Last pass over the messages, after `process_input_messages`. */
    protected prepareMessages(messages: PuterMessage[]): PuterMessage[] {
        return messages;
    }

    /** The request as sent: the shared params plus whatever the vendor adds. */
    protected vendorParams(
        params: Record<string, unknown>,
        _args: ICompleteArguments,
        _model: IChatModel,
        _actor: Actor | undefined,
    ): Record<string, unknown> {
        return params;
    }

    /** The usage a completion meters as, and how it's billed. */
    protected meteredUsage(
        source: UsageSource,
        _model: IChatModel,
    ): { usage: Record<string, number>; meterOptions?: MeterChatUsageOptions } {
        return { usage: OpenAIUtil.splitCachedPrompt(source.usage) };
    }

    /** The usage reported to the caller once it's metered. */
    protected reportedUsage(
        usage: Record<string, number>,
    ): Record<string, unknown> {
        return usage;
    }
}
