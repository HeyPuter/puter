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

// Most models go through Google's OpenAI-compatible endpoint with the openai
// SDK; only GEMINI_NATIVE_MODELS use the native generateContent API.
import {
    type GenerateContentResponseUsageMetadata,
    GoogleGenAI,
} from '@google/genai';
import { OpenAI } from 'openai';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type {
    IChatModel,
    ICompleteArguments,
    PuterMessage,
    UsageDetails,
} from '../../types.js';
import { toolChoiceToWire } from '../../utils/openaiParams.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatCompletionsClient,
    type ChatProviderConfig,
    OpenAICompatProvider,
    type UsageSource,
} from '../OpenAICompatProvider.js';
import { geminiNativeClient } from './geminiNative.js';
import {
    GEMINI_MODELS,
    GEMINI_NATIVE_MODELS,
    GEMINI_ARGON_NON_STREAM_MAX_TOKENS,
} from './models.js';

type GroundingContent = { grounding_metadata?: unknown };

/** Unary Argon uses a lower output cap than streaming. */
const nativeOutputCap = (
    args: ICompleteArguments,
    model: IChatModel,
): number | undefined =>
    model.id === 'gemini-4-argon' && !args.stream
        ? GEMINI_ARGON_NON_STREAM_MAX_TOKENS
        : undefined;

const COMPAT_BASE_URL =
    'https://generativelanguage.googleapis.com/v1beta/openai/';

/** The catalog without the native models, for a custom `apiBaseUrl`. */
const COMPAT_ONLY_MODELS = GEMINI_MODELS.filter(
    (m) => !GEMINI_NATIVE_MODELS.has(m.id),
);

export class GeminiChatProvider extends OpenAICompatProvider {
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        const compat = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.apiBaseUrl ?? COMPAT_BASE_URL,
            ...sdkClientOptions(),
        });
        // A custom base URL may be a proxy that only speaks the
        // OpenAI-compatible API, so native models are left out rather than
        // sent straight to Google.
        const native =
            config.apiBaseUrl === undefined ||
            config.apiBaseUrl.replace(/\/*$/, '/') === COMPAT_BASE_URL
                ? geminiNativeClient(new GoogleGenAI({ apiKey: config.apiKey }))
                : undefined;
        const client: ChatCompletionsClient = {
            chat: {
                completions: {
                    create: (params, options) => {
                        const { model } = params as { model: string };
                        if (!GEMINI_NATIVE_MODELS.has(model)) {
                            return compat.chat.completions.create(
                                params,
                                options,
                            );
                        }
                        if (!native) {
                            throw new HttpError(
                                400,
                                `Model not found: ${model}`,
                                { legacyCode: 'bad_request' },
                            );
                        }
                        return native.chat.completions.create(params, options);
                    },
                },
            },
        };
        const models = native ? GEMINI_MODELS : COMPAT_ONLY_MODELS;
        super(meteringService, {
            client,
            defaultModel: 'gemini-2.5-flash',
            models: () => models,
            meteringPrefix: 'gemini',
            maxTokensParam: 'max_completion_tokens',
            passthrough: ['temperature'],
            // Gemini 3.1+ rejects http(s) image URLs on Google's
            // OpenAI-compatible endpoint (bodiless 400) but accepts data URLs;
            // inline for every model rather than maintain a version list.
            inlineImages: 'always',
        });
    }

    /** Sizes the credit hold to the same output cap `vendorParams` sends. */
    requestPricing(
        args: ICompleteArguments,
        model: IChatModel,
    ): { maxTokens?: number } {
        const maxTokens = nativeOutputCap(args, model);
        return maxTokens === undefined ? {} : { maxTokens };
    }

    protected override prepareMessages(messages: PuterMessage[]) {
        for (const message of messages) delete message.cache_control;
        return messages;
    }

    protected override vendorParams(
        params: Record<string, unknown>,
        args: ICompleteArguments,
        model: IChatModel,
    ) {
        const native = GEMINI_NATIVE_MODELS.get(model.id);
        if (!native) return params;
        // Unset leaves the thinking level to Google's per-model default.
        const effort = args.reasoning_effort ?? args.reasoning?.effort;
        if (effort !== undefined && !native.reasoningEfforts.has(effort)) {
            throw new HttpError(
                400,
                `reasoning_effort must be one of ${[...native.reasoningEfforts].join(', ')} for ${model.id}`,
                { legacyCode: 'bad_request' },
            );
        }
        const { temperature, ...shared } = params;
        const hasTools = Array.isArray(params.tools) && params.tools.length > 0;
        const outputCap = nativeOutputCap(args, model);
        const requested = params.max_completion_tokens as number | undefined;
        return {
            ...shared,
            ...(native.temperature && temperature !== undefined
                ? { temperature }
                : {}),
            ...(outputCap !== undefined
                ? {
                      max_completion_tokens: Math.min(
                          requested ?? outputCap,
                          outputCap,
                      ),
                  }
                : {}),
            ...(effort ? { reasoning_effort: effort } : {}),
            ...(hasTools && args.tool_choice
                ? { tool_choice: toolChoiceToWire(args.tool_choice, 'chat') }
                : {}),
        };
    }

    protected override preservesToolCallOrder(model: IChatModel) {
        // Gemini expects parallel calls back in order, signature on the first.
        return GEMINI_NATIVE_MODELS.has(model.id);
    }

    protected override keepsToolCallExtraContent() {
        // Carries the thought signature Gemini needs replayed with each call.
        return true;
    }

    protected override meteredUsage(source: UsageSource, model: IChatModel) {
        if (GEMINI_NATIVE_MODELS.has(model.id)) {
            return nativeMeteredUsage(
                source.usage as unknown as
                    GenerateContentResponseUsageMetadata | undefined,
            );
        }
        // Non-stream grounding metadata lives in choices[0].message; a stream
        // hands over what its handler accumulated as `extra_content`.
        const { usage } = source;
        const choices = source.choices as
            | Array<{ message?: { extra_content?: GroundingContent } }>
            | undefined;
        const extraContent = source.extra_content as
            GroundingContent | undefined;

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

const count = (value: number | undefined): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Native `usageMetadata` as metered. Candidates and thoughts are separate
 * output counts; cached tokens are part of the prompt. Metadata with no counts
 * meters nothing, so the driver estimates the completion instead.
 */
const nativeMeteredUsage = (
    metadata: GenerateContentResponseUsageMetadata | undefined,
): { usage: Record<string, number>; usageDetails?: UsageDetails } => {
    const prompt = count(metadata?.promptTokenCount);
    const candidates = count(metadata?.candidatesTokenCount);
    const thoughts = count(metadata?.thoughtsTokenCount);
    const cached = count(metadata?.cachedContentTokenCount) ?? 0;
    // Server-tool prompt tokens; no server tool is ever enabled here.
    const toolUse = count(metadata?.toolUsePromptTokenCount) ?? 0;
    if (
        prompt === undefined &&
        candidates === undefined &&
        thoughts === undefined &&
        !cached &&
        !toolUse
    ) {
        return { usage: {} };
    }
    const inputTokens = Math.max(0, (prompt ?? 0) - cached);
    return {
        usage: {
            prompt_tokens: inputTokens,
            completion_tokens: candidates ?? 0,
            thinking_tokens: thoughts ?? 0,
            cached_tokens: cached,
            ...(toolUse ? { tool_use_prompt_tokens: toolUse } : {}),
        },
        usageDetails: {
            inputTokens: inputTokens + toolUse,
            outputTokens: (candidates ?? 0) + (thoughts ?? 0),
            reasoningTokens: thoughts ?? 0,
            ...(cached ? { cacheReadTokens: cached } : {}),
        },
    };
};
