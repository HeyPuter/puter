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

import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import { EventMap } from '../../clients/event/types.js';
import type { Actor } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import type { CreditHold } from '../../services/metering/types.js';
import { NO_CREDIT_HOLD } from '../../services/metering/types.js';
import type { DriverStreamResult } from '../meta.js';
import { PuterDriver } from '../types.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import { AlibabaProvider } from './providers/alibaba/AlibabaProvider.js';
import { AzureChatProvider } from './providers/azure/AzureChatProvider.js';
import { AzureResponsesProvider } from './providers/azure/AzureResponsesProvider.js';
import { BytePlusProvider } from './providers/byteplus/BytePlusProvider.js';
import { ClaudeProvider } from './providers/claude/ClaudeProvider.js';
import { DeepSeekProvider } from './providers/deepseek/DeepSeekProvider.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import { GeminiChatProvider } from './providers/gemini/GeminiChatProvider.js';
import { GroqAIProvider } from './providers/groq/GroqAIProvider.js';
import { InfronProvider } from './providers/infron/InfronProvider.js';
import { MiniMaxProvider } from './providers/minimax/MiniMaxProvider.js';
import { MistralAIProvider } from './providers/mistral/MistralAiProvider.js';
import { MoonshotProvider } from './providers/moonshot/MoonshotProvider.js';
import { NeuralwattProvider } from './providers/neuralwatt/NeuralwattProvider.js';
import { OllamaChatProvider } from './providers/ollama/OllamaProvider.js';
import { OpenAiChatProvider } from './providers/openai/OpenAiChatCompletionsProvider.js';
import { OpenAiResponsesChatProvider } from './providers/openai/OpenAiChatResponsesProvider.js';
import { OpenRouterProvider } from './providers/openrouter/OpenRouterProvider.js';
import { TogetherAIProvider } from './providers/together/TogetherAIProvider.js';
import { XAIProvider } from './providers/xai/XAIProvider.js';
import { ZAIProvider } from './providers/zai/ZAIProvider.js';
import type {
    IChatCompleteResult,
    IChatModel,
    IChatProvider,
    ICompleteArguments,
} from './types.js';
import { normalize_tools_object } from './utils/FunctionCalling.js';
import {
    normalize_messages,
    normalize_single_message,
} from './utils/Messages.js';
import {
    compareModelPreference,
    isIdentityKey,
    normalizeModelKey,
} from './utils/modelRouting.js';
import { costKeys, isFreeModel } from './utils/pricing.js';
import {
    isRouteUnhealthy,
    markRouteUnhealthy,
} from './utils/providerHealth.js';
import { AIChatStream } from './utils/Streaming.js';
import {
    estimateOutputTokens,
    estimatePromptTokens,
} from './utils/usageEstimate.js';

const MAX_ATTEMPTS = 3; // the first attempt plus two fallbacks

/**
 * How often a streaming completion renews its credit hold. Holds default to a
 * 10-minute TTL; a long generation (a reasoning model with a large
 * `max_tokens`) can stream past that, and a hold that expires mid-stream
 * reopens the overspend window it exists to close.
 */
const HOLD_RENEW_INTERVAL_MS = 5 * 60 * 1000;

/**
 * A moderation refusal is a completion that was produced and charged, then
 * withheld — not a route failure. Retrying it on a fallback provider would bill
 * the account again for another completion the user will never see.
 */
const isModerationRefusal = (e: unknown): boolean =>
    isHttpError(e) && e.code === 'moderation_flagged';

type ProviderAttempt = {
    model: string;
    provider: string;
    status?: number;
    code?: string;
    error: string;
};

/**
 * Capture what an upstream provider gave us so the classifier downstream can
 * decide a user-facing status code instead of always returning 500.
 *
 * OpenAI-SDK-based providers throw `APIError` with `.status` and a structured
 * `.error` body — pull both. For arbitrary errors we fall back to the message
 * and a status sniff so providers that throw plain `Error("... 503 ...")`
 * strings still classify correctly.
 */
const toAttempt = (
    modelId: string,
    providerId: string,
    err: unknown,
): ProviderAttempt => {
    const e = err as {
        status?: number;
        statusCode?: number;
        code?: string;
        error?: { code?: string; type?: string; message?: string };
        message?: string;
    };
    const message = e?.message ?? (typeof err === 'string' ? err : String(err));
    let status = e?.status ?? e?.statusCode;
    if (status === undefined) {
        const m = message.match(/\b(4\d\d|5\d\d)\b/);
        if (m) status = Number(m[1]);
    }
    return {
        model: modelId,
        provider: providerId,
        status,
        code: e?.error?.code ?? e?.code,
        error: message,
    };
};

const isRateLimit = (a: ProviderAttempt) =>
    a.status === 429 ||
    /rate[\s_-]?limit|too many requests|quota/i.test(a.error);

const isAuthFailure = (a: ProviderAttempt) =>
    a.status === 401 ||
    a.status === 403 ||
    /unauthorized|forbidden|invalid api key/i.test(a.error);

const isUpstream5xx = (a: ProviderAttempt) =>
    (a.status !== undefined && a.status >= 500) ||
    /provider returned error|internal server error|service unavailable|bad gateway/i.test(
        a.error,
    );

/**
 * Whether a failure indicts the route rather than the request.
 *
 * Outages, rate limits and bad credentials will hit the next caller too, so the
 * route is worth marking. A 4xx the upstream returned on the request's own
 * merits (malformed tools, oversized prompt) says nothing about the route and
 * must not take it out of rotation for everyone else. Attempts with no status
 * at all are transport failures — treat them as route problems.
 */
const isRouteLevelFailure = (a: ProviderAttempt) =>
    a.status === undefined ||
    isRateLimit(a) ||
    isAuthFailure(a) ||
    isUpstream5xx(a);

// One bucket can hold the same model id under several providers *and* several
// ids under one provider, so only the pair identifies an attempt.
const routeId = (provider: string, modelId: string) => `${provider}:${modelId}`;

/**
 * Map an exhausted fallback chain to a single user-facing HttpError.
 *
 * Per-class rules (see also alarm gate in server.ts):
 *
 * - All rate-limited → 429 `upstream_rate_limited` (alerted, unless every attempt
 *   was on a free model — see `allModelsFree`)
 * - All auth failures → 500 `upstream_auth_failed` (paged: our config)
 * - All upstream 5xx → 400 `upstream_provider_unavailable` (no page)
 * - All upstream 4xx (other) → 400 `upstream_bad_request` (no page)
 * - Mixed → 400 `upstream_failed` (no page)
 */
const classifyAttempts = (
    attempts: ProviderAttempt[],
    { allModelsFree = false } = {},
): HttpError => {
    const fields = { attempts };
    if (attempts.length === 0) {
        return new HttpError(500, 'No providers attempted', {
            legacyCode: 'internal_error',
            fields,
        });
    }

    if (attempts.every(isRateLimit)) {
        return new HttpError(429, 'AI provider rate limit exceeded', {
            legacyCode: 'upstream_rate_limited',
            fields,
            // A free model getting throttled upstream is the deal we took
            // when we picked it up for nothing: there's no billing at stake
            // and nothing to act on, and the volume tracks traffic. The
            // caller still gets the 429; we just don't record it.
            noAlarm: allModelsFree,
        });
    }
    if (attempts.every(isAuthFailure)) {
        return new HttpError(500, 'AI provider authentication failed', {
            legacyCode: 'upstream_auth_failed',
            fields,
        });
    }
    if (attempts.every(isUpstream5xx)) {
        return new HttpError(400, 'AI provider unavailable', {
            legacyCode: 'upstream_provider_unavailable',
            fields,
        });
    }
    if (
        attempts.every(
            (a) => a.status !== undefined && a.status >= 400 && a.status < 500,
        )
    ) {
        return new HttpError(400, attempts[0].error, {
            legacyCode: 'upstream_bad_request',
            fields,
        });
    }

    // Mixed failures where at least one attempt is clearly upstream
    // (had an HTTP status from the SDK) means "AI providers couldn't
    // satisfy the request" — expose, don't page.
    const isUpstreamSignal = (a: ProviderAttempt) =>
        a.status !== undefined ||
        isRateLimit(a) ||
        isAuthFailure(a) ||
        isUpstream5xx(a);
    if (attempts.some(isUpstreamSignal)) {
        return new HttpError(400, 'All AI providers failed', {
            legacyCode: 'upstream_failed',
            fields,
        });
    }

    // Nothing identifiable as an upstream issue — treat as our bug
    // and let the global alarm fire so we actually find out.
    return new HttpError(500, 'All providers failed', {
        legacyCode: 'internal_error',
        fields,
    });
};

/**
 * Driver implementing the `puter-chat-completion` interface.
 *
 * Manages multiple upstream providers (Claude, OpenAI, …) and handles model
 * resolution, provider routing, fallback on failure, and message normalisation.
 * Each provider is a plain `IChatProvider` — the driver instantiates them from
 * config on boot.
 *
 * Providers handle their own metering internally.
 */
export class ChatCompletionDriver extends PuterDriver {
    readonly driverInterface = 'puter-chat-completion';
    readonly driverName = 'ai-chat';
    readonly isDefault = true;

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    #providers: Record<string, IChatProvider> = {};
    #modelIdMap: Record<string, IChatModel[]> = {};

    override onServerStart() {
        this.#registerProviders();
        this.#buildModelMap();
    }

    // -- Interface methods -------------------------------------------

    async models() {
        const seen = new Set<string>();
        return Object.values(this.#modelIdMap)
            .flat()
            .filter((model) => {
                if (seen.has(model.id)) return false;
                seen.add(model.id);
                return true;
            })
            .sort((a, b) => {
                if (a.provider === b.provider) return a.id.localeCompare(b.id);
                return a.provider!.localeCompare(b.provider!);
            });
    }

    async list() {
        return (await this.models()).map((m) => m.puterId || m.id).sort();
    }

    override getReportedCosts(): Record<string, unknown>[] {
        const out: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        for (const bucket of Object.values(this.#modelIdMap)) {
            for (const model of bucket) {
                const key = `${model.provider}:${model.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                for (const [costKey, raw] of Object.entries(
                    model.costs ?? {},
                )) {
                    // `tokens` is a scale descriptor ("costs expressed per N
                    // tokens"), not a real per-operation cost — skip it.
                    if (costKey === 'tokens') continue;
                    if (typeof raw !== 'number' || !Number.isFinite(raw))
                        continue;
                    out.push({
                        usageType: `${model.provider}:${model.id}:${costKey}`,
                        ucentsPerUnit: raw,
                        unit: 'token',
                        source: `driver:aiChat/${model.provider}`,
                        costs_currency: model.costs_currency,
                    });
                }
            }
        }
        return out;
    }

    async complete(args: ICompleteArguments): Promise<IChatCompleteResult> {
        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        let intendedProvider = args.provider || '';
        if (!args.model && !intendedProvider) {
            intendedProvider = 'azure-openai'; // default provider
        }
        if (
            !args.model &&
            intendedProvider &&
            this.#providers[intendedProvider]
        ) {
            args.model = this.#providers[intendedProvider].getDefaultModel();
        }

        let model = this.#resolveModel(args.model, intendedProvider);
        if (!model) {
            throw new HttpError(400, `Model not found: ${args.model}`, {
                legacyCode: 'bad_request',
            });
        }

        if (args.messages) {
            args.messages = normalize_messages(args.messages);
        }
        if (args.tools) {
            normalize_tools_object(args.tools);
        }

        // Both estimated once, before any attempt: providers rewrite
        // `args.messages` in place (tool_use blocks move out of `content`), so
        // an estimate taken after a failed attempt would undercount the same
        // prompt — and the gate writes each attempt's output cap into
        // `args.max_tokens`, so the user's requested value has to be kept
        // apart from what the previous attempt was capped to.
        const promptTokenEstimate = estimatePromptTokens(args.messages ?? []);
        const requestedMaxTokens = args.max_tokens;

        const completionId = crypto
            .randomUUID()
            .replaceAll('-', '')
            .slice(0, 25);

        const validateEvent: EventMap['ai.prompt.validate'] = {
            username: actor.user?.username || '',
            actor,
            completionId,
            allow: true,
            intended_service: intendedProvider,
            parameters: args,
        };

        await this.clients.event.emitAndWait(
            'ai.prompt.validate',
            validateEvent,
            {},
        );

        // Blocked prompts get rerouted to fake-chat. With `event.abuse` we
        // pick the `abuse` model, which embeds `event.custom` (phone-home
        // script for bots, etc.) in its response so the bot's renderer
        // executes it. Without `abuse`, we silently route to the default
        // `fake` model (lorem-ipsum response). Mirrors v1 AIChatService.
        let blocked = false;
        if (!validateEvent.allow) {
            const fakeModelId = validateEvent.abuse ? 'abuse' : 'fake';
            const fakeModel = this.#resolveModel(fakeModelId, 'fake-chat');
            if (!fakeModel) {
                throw new HttpError(403, 'Prompt blocked by policy', {
                    legacyCode: 'forbidden',
                });
            }
            blocked = true;
            model = fakeModel;
            intendedProvider = 'fake-chat';
            if (typeof validateEvent.custom !== 'undefined') {
                args.custom = validateEvent.custom;
            }
        }

        // Skipped for blocked requests since fake-chat is free and the user
        // shouldn't see a billing error in place of the abuse page.
        //
        // The gate hands back a hold on what this attempt could cost, which
        // stands in for its usage until the real numbers land. It is released
        // on every way out of this method — including the streaming path,
        // where "done" is the stream draining rather than this method
        // returning.
        let hold: CreditHold = NO_CREDIT_HOLD;
        if (!blocked) {
            hold = await this.#applyCreditGate(actor, model, args, {
                promptTokenEstimate,
                requestedMaxTokens,
            });
        }

        // First attempt
        const provider = this.#providers[model.provider!];
        if (!provider) {
            throw new HttpError(
                500,
                `No provider found for model ${model.id}`,
                { legacyCode: 'internal_error' },
            );
        }

        const attempts: ProviderAttempt[] = [];
        let res: IChatCompleteResult | undefined;
        // Tracked across the chain so the classifier can tell a chain that
        // only ever touched free models from one that cost the user something.
        let allModelsFree = true;

        // A failed route is remembered briefly so the next request skips it
        // rather than paying its timeout again.
        const recordFailure = (failed: IChatModel, err: unknown) => {
            const attempt = toAttempt(failed.id, failed.provider!, err);
            attempts.push(attempt);
            if (!isFreeModel(failed)) allModelsFree = false;
            if (isRouteLevelFailure(attempt)) {
                markRouteUnhealthy(failed.provider!, failed.id);
            }
        };

        try {
            res = await provider.complete({
                ...args,
                model: model.id,
                provider: model.provider,
            });
        } catch (e) {
            // This attempt is over and cost whatever it cost; the next one
            // takes a hold of its own.
            await hold.release();
            hold = NO_CREDIT_HOLD;

            // A withheld completion was still a completion — charged, final,
            // not a route failure worth another (billed) attempt elsewhere.
            if (isModerationRefusal(e)) throw e;
            recordFailure(model, e);

            // Fallback loop — the bucket holds every provider that serves this
            // model, ranked by `compareModelPreference`, so each miss walks one
            // step down that order.
            const bucketKey = model.id;
            const tried = new Set([routeId(model.provider!, model.id)]);
            let lastError: Error | null = e as Error;

            while (lastError && attempts.length < MAX_ATTEMPTS) {
                const fallback = this.#findFallback(bucketKey, tried);
                if (!fallback) break;

                const fbProvider = this.#providers[fallback.provider!];
                if (!fbProvider) break;

                // Every attempt is a whole completion the account pays for, so
                // each one goes through the full gate again rather than a
                // token "do they have anything left" check: the balance may
                // have been spent by a parallel request, and the fallback is
                // a different model at a different price, whose output has to
                // be capped against what is actually left.
                // The previous attempt released its hold when it failed, so
                // this one starts from nothing held.
                if (!blocked) {
                    hold = await this.#applyCreditGate(actor, fallback, args, {
                        promptTokenEstimate,
                        requestedMaxTokens,
                    });
                }

                tried.add(routeId(fallback.provider!, fallback.id));

                try {
                    res = await fbProvider.complete({
                        ...args,
                        model: fallback.id,
                        provider: fallback.provider,
                    });
                    model = fallback;
                    lastError = null;
                } catch (fbErr) {
                    await hold.release();
                    hold = NO_CREDIT_HOLD;
                    if (isModerationRefusal(fbErr)) throw fbErr;
                    lastError = fbErr as Error;
                    recordFailure(fallback, fbErr);
                }
            }
        }

        if (!res) {
            await hold.release();
            throw classifyAttempts(attempts, { allModelsFree });
        }

        const username = actor.user?.username;

        // Streaming result — create a PassThrough, kick off the provider's
        // stream populator, and return a DriverStreamResult so the route
        // handler pipes it to the HTTP response as chunked NDJSON.
        if ('init_chat_stream' in res && res.init_chat_stream) {
            const passthrough = new PassThrough();
            const chatStream = new AIChatStream({ stream: passthrough });
            const init = res.init_chat_stream;
            const cleanup = res.finally_fn;

            // Intercept `chatStream.end(usage)` to fire complete + cost events
            // (mirrors the non-streaming branch). Clone usage so providers that
            // meter after this call (e.g. Claude) don't pick up `usd_cents`.
            const originalEnd = chatStream.end.bind(chatStream);
            chatStream.end = (usage?: Record<string, number>) => {
                const enrichedUsage = usage ? { ...usage } : usage;
                if (enrichedUsage) {
                    this.#injectUsdCents(enrichedUsage, model);
                }
                this.clients.event.emit(
                    'ai.prompt.complete',
                    {
                        username: username!,
                        completionId,
                        intended_service: intendedProvider,
                        parameters: args,
                        result: { usage: enrichedUsage, stream: true },
                        model_used: model.id,
                        service_used: model.provider!,
                    },
                    {},
                );
                if (usage) {
                    this.#emitCostCalculated({
                        completionId,
                        username,
                        usage,
                        model,
                        intendedProvider,
                    });
                }
                return originalEnd(enrichedUsage!);
            };

            // The hold lives for the whole stream, which can outlast its TTL —
            // keep pushing the deadline out until the pump is done.
            const renewHold = setInterval(() => {
                void hold.extend?.();
            }, HOLD_RENEW_INTERVAL_MS);
            renewHold.unref?.();

            // Fire-and-forget — the stream writes happen async while the
            // response is being piped to the client.
            (async () => {
                try {
                    await init({ chatStream });
                } catch (e) {
                    passthrough.write(
                        `${JSON.stringify({
                            type: 'error',
                            message: (e as Error).message,
                        })}\n`,
                    );
                    passthrough.end();
                } finally {
                    clearInterval(renewHold);
                    // Providers report usage the moment they meter it (see
                    // `AIChatStream.reportUsage`); a stream that never got
                    // there was never charged for.
                    if (!blocked && !chatStream.reportedUsage) {
                        this.#meterUnreportedStream({
                            actor,
                            chatStream,
                            model,
                            promptTokenEstimate,
                            completionId,
                            username,
                            intendedProvider,
                        });
                    }
                    // Held until the generation is actually over: for a
                    // stream, the provider returns as soon as it has a
                    // populator, and everything the account pays for happens
                    // after that.
                    await hold.release();
                    if (cleanup) await cleanup();
                }
            })();

            const streamResult: DriverStreamResult = {
                dataType: 'stream',
                content_type: 'application/x-ndjson',
                chunked: true,
                stream: passthrough,
            };
            return streamResult as unknown as IChatCompleteResult;
        }

        // The provider recorded this completion's usage before returning it,
        // so the hold has served its purpose.
        await hold.release();

        // -- Post-completion audit event ------------------------------
        // Only for non-streaming results (streaming emits from the
        // `chatStream.end` wrapper above). Extensions like prompt_block /
        // prodMeteringAndBilling listen for this to log completions.
        this.clients.event.emit(
            'ai.prompt.complete',
            {
                username: username!,
                completionId,
                intended_service: intendedProvider,
                parameters: args,
                result: res,
                model_used: model.id,
                service_used: model.provider!,
            },
            {},
        );

        if ('usage' in res && res.usage) {
            this.#injectUsdCents(res.usage, model);
            this.#emitCostCalculated({
                completionId,
                username,
                usage: res.usage,
                model,
                intendedProvider,
            });
        }

        Context.set('driverMetadata', {
            service_used: model.provider,
            providerUsed: model.id,
        });

        if (args.response?.normalize && 'message' in res && res.message) {
            return {
                ...res,
                message: normalize_single_message(res.message),
                normalized: true,
                via_ai_chat_service: true,
            };
        }

        return { ...res, via_ai_chat_service: true };
    }

    // Compute per-token cost in microcents (1 cent = 1_000_000 microCents).
    // Shape-agnostic: multiplies every usage key by its matching rate in
    // `model.costs`. Returns `null` when cost data is unavailable.
    #computeCost(
        usage: Record<string, number>,
        model: IChatModel,
    ): {
        inputKey: string;
        outputKey: string;
        inputTokens: number;
        outputTokens: number;
        inputMicroCents: number;
        outputMicroCents: number;
        totalMicroCents: number;
    } | null {
        const { inputKey, outputKey } = costKeys(model);

        const costs = model.costs;
        if (!costs) return null;

        const outputRateRaw = costs[outputKey];
        const outputRate =
            typeof outputRateRaw === 'number' && Number.isFinite(outputRateRaw)
                ? outputRateRaw
                : undefined;

        const isOutputKey = (key: string) =>
            key === outputKey ||
            key === 'output_tokens' ||
            key === 'completion_tokens' ||
            key === 'thinking_tokens';

        let inputMicroCents = 0;
        let outputMicroCents = 0;
        let sawAnyRate = false;

        for (const [key, rawAmount] of Object.entries(usage)) {
            if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount)) {
                continue;
            }

            if (key === 'usd_cents') continue;
            if (key === 'tokens') continue;

            // thinking_tokens → output rate fallback
            let rate = costs[key];
            if (typeof rate !== 'number' || !Number.isFinite(rate)) {
                if (isOutputKey(key) && outputRate !== undefined) {
                    rate = outputRate;
                } else if (!isOutputKey(key)) {
                    const inputRateRaw = costs[inputKey];
                    if (
                        typeof inputRateRaw === 'number' &&
                        Number.isFinite(inputRateRaw)
                    ) {
                        rate = inputRateRaw;
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            }

            const sub = rawAmount * rate;
            sawAnyRate = true;
            if (isOutputKey(key)) {
                outputMicroCents += sub;
            } else {
                inputMicroCents += sub;
            }
        }

        if (!sawAnyRate) return null;

        inputMicroCents = Math.max(0, Math.round(inputMicroCents));
        outputMicroCents = Math.max(0, Math.round(outputMicroCents));

        const inputTokens = Number(
            usage[inputKey] ?? usage.prompt_tokens ?? usage.input_tokens ?? 0,
        );
        const outputTokens = Number(
            usage[outputKey] ??
                usage.completion_tokens ??
                usage.output_tokens ??
                0,
        );

        return {
            inputKey,
            outputKey,
            inputTokens,
            outputTokens,
            inputMicroCents,
            outputMicroCents,
            totalMicroCents: inputMicroCents + outputMicroCents,
        };
    }

    /**
     * The credit and subscription gate for one upstream attempt.
     *
     * Runs before every attempt, not once per request: each attempt is a whole
     * completion the account pays for, at that model's prices, against whatever
     * balance is left by the time it starts.
     *
     * Rejects when the account can't afford the approximate input cost, keeps
     * subscriber-only models gated, and tightens `args.max_tokens` so the
     * output this attempt can produce is bounded by the remaining balance.
     *
     * Returns a hold on what the attempt can cost at worst, so requests this
     * account is running in parallel see the spend before it is recorded. The
     * caller releases it once the attempt is done.
     */
    async #applyCreditGate(
        actor: Actor,
        model: IChatModel,
        args: ICompleteArguments,
        estimates: {
            /**
             * Prompt tokens, estimated once before any attempt — counts
             * attachments as well as text, and predates any in-place message
             * rewriting a previous attempt's provider did.
             */
            promptTokenEstimate: number;
            /**
             * What the user asked for, kept apart from `args.max_tokens`, which
             * carries the previous attempt's cap: a cheap fallback must not
             * inherit the ceiling computed at an expensive model's price.
             */
            requestedMaxTokens: number | undefined;
        },
    ): Promise<CreditHold> {
        const metering = this.services.metering;
        const { promptTokenEstimate, requestedMaxTokens } = estimates;
        const { inputKey, outputKey } = costKeys(model);
        // `|| 0` also catches NaN from a malformed cost table.
        const inputTokenCost = Number(model.costs?.[inputKey] ?? 0) || 0;
        const outputTokenCost = Number(model.costs?.[outputKey] ?? 0) || 0;
        const approximateInputCost = promptTokenEstimate * inputTokenCost;
        const minimumCredits = Number(model.minimumCredits || 1);

        // One balance read serves the whole gate: the affordability check
        // here and the output cap below.
        const remainingCredits = await metering.getRemainingUsage(actor);
        if (remainingCredits < Math.max(approximateInputCost, minimumCredits)) {
            throw new HttpError(402, 'No usage left for request.', {
                legacyCode: 'insufficient_funds',
            });
        }

        if (model.subscriberOnly) {
            const subscription = await metering.getActorSubscription(actor);
            const isDefaultPolicy =
                subscription.id === DEFAULT_FREE_SUBSCRIPTION ||
                subscription.id === DEFAULT_TEMP_SUBSCRIPTION;
            if (isDefaultPolicy) {
                throw new HttpError(
                    403,
                    `The model ${model.id} is only available to subscribers. Please subscribe to access this model.`,
                    { legacyCode: 'permission_denied' },
                );
            }
        }

        if (outputTokenCost > 0) {
            const maxAllowedOutputUcents =
                remainingCredits - approximateInputCost;
            const maxAllowedOutputTokens =
                maxAllowedOutputUcents / outputTokenCost;
            // A provider may not know a model's output ceiling. Drop the term
            // rather than let a missing value drive the cap: `null` coerces to
            // 0, so the subtraction goes negative instead of NaN and the user
            // is told they're out of credits.
            const modelOutputCeiling =
                Number.isFinite(model.max_tokens) && model.max_tokens > 0
                    ? model.max_tokens - promptTokenEstimate
                    : Number.POSITIVE_INFINITY;
            const cap = Math.floor(
                Math.min(
                    requestedMaxTokens ?? Number.POSITIVE_INFINITY,
                    maxAllowedOutputTokens,
                    modelOutputCeiling,
                ),
            );
            // `cap` is the credit-bounded ceiling on output tokens. When it
            // drops below 1 the user can't afford even a single output token,
            // so reject the request. Crucially we must NOT leave `max_tokens`
            // unset here: an undefined max_tokens lets the provider run to the
            // model's full output limit (e.g. 128k for Claude), billing far
            // past the user's remaining balance.
            if (cap < 1) {
                throw new HttpError(402, 'No usage left for request.', {
                    legacyCode: 'insufficient_funds',
                });
            }
            args.max_tokens = cap;
        } else {
            // No output price, nothing to bound — but a previous attempt may
            // have written its cap here; give this one the user's own value.
            args.max_tokens = requestedMaxTokens;
        }

        // What this attempt can cost at worst: the prompt, plus output run to
        // the cap just set. Capped output is what makes the number finite —
        // for a model with no output price the output term is zero and the
        // prompt estimate stands alone.
        const worstCaseCost =
            approximateInputCost + (args.max_tokens ?? 0) * outputTokenCost;
        return this.services.metering.reserveCredits(
            actor,
            Math.max(worstCaseCost, minimumCredits),
        );
    }

    /**
     * Charge a stream that produced output but never reported usage.
     *
     * Providers meter from the usage they hand to `chatStream.end`, at the very
     * end of the stream — so anything that stops the stream short of that point
     * (an upstream error mid-response, a malformed tool-call payload, a
     * provider that never sends a usage chunk) leaves a completion the upstream
     * has already billed us for and the account has paid nothing for. This is
     * the backstop: what the stream actually emitted, priced off the model's
     * own cost table.
     *
     * Only when there was output. A stream that failed before producing
     * anything cost the user nothing, and charging an estimated prompt to
     * someone whose request we failed to serve is worse than the leak.
     *
     * Recorded under `estimated_*` usage keys so the numbers stay separable
     * from provider-reported ones in the usage breakdown.
     */
    #meterUnreportedStream(params: {
        actor: Actor;
        chatStream: AIChatStream;
        model: IChatModel;
        /** Estimated before any provider rewrote `args.messages` in place. */
        promptTokenEstimate: number;
        completionId: string;
        username?: string;
        intendedProvider: string;
    }): void {
        const {
            actor,
            chatStream,
            model,
            promptTokenEstimate,
            completionId,
            username,
            intendedProvider,
        } = params;

        const outputTokens = estimateOutputTokens(chatStream.outputChars ?? 0);
        if (outputTokens <= 0) return;

        const { inputKey, outputKey } = costKeys(model);
        const inputTokens = promptTokenEstimate;
        const usage = {
            [inputKey]: inputTokens,
            [outputKey]: outputTokens,
        };

        const cost = this.#computeCost(usage, model);
        this.services.metering.utilRecordUsageObject(
            {
                [`estimated_${inputKey}`]: inputTokens,
                [`estimated_${outputKey}`]: outputTokens,
            },
            actor,
            `${model.provider}:${model.id}`,
            {
                // Undefined when the model has no cost table: the entry is
                // recorded unpriced rather than free.
                [`estimated_${inputKey}`]: cost?.inputMicroCents,
                [`estimated_${outputKey}`]: cost?.outputMicroCents,
            },
        );

        console.warn(
            `[ai-chat] stream ended without usage; charged an estimate (${completionId}, ${model.provider}:${model.id}, ~${inputTokens} in / ~${outputTokens} out)`,
        );

        this.#emitCostCalculated({
            completionId,
            username,
            usage,
            model,
            intendedProvider,
        });
    }

    // Add `usd_cents` to the usage object. Skips if the provider already
    // set an authoritative value (e.g. OpenRouter's `usage.cost`).
    // Sets `null` when cost data is unavailable for the model.
    #injectUsdCents(usage: Record<string, number>, model: IChatModel): void {
        if (
            typeof usage.usd_cents === 'number' &&
            Number.isFinite(usage.usd_cents)
        ) {
            return;
        }
        const cost = this.#computeCost(usage, model);
        if (!cost) {
            (usage as Record<string, number | null>).usd_cents = null;
            return;
        }
        usage.usd_cents = cost.totalMicroCents / 1_000_000;
    }

    // Compute per-token cost in microcents using the model's cost map,
    // then emit `ai.prompt.cost-calculated` for listeners that persist
    // billing/abuse rows keyed on the completion id.
    #emitCostCalculated(params: {
        completionId: string;
        username?: string;
        usage: Record<string, number>;
        model: IChatModel;
        intendedProvider: string;
    }) {
        const { completionId, username, usage, model, intendedProvider } =
            params;

        const cost = this.#computeCost(usage, model);
        const { inputKey, outputKey } = costKeys(model);
        const inputTokens = cost?.inputTokens ?? 0;
        const outputTokens = cost?.outputTokens ?? 0;
        const inputMicroCents = cost?.inputMicroCents ?? 0;
        const outputMicroCents = cost?.outputMicroCents ?? 0;

        this.clients.event.emit(
            'ai.prompt.cost-calculated',
            {
                completionId,
                username: username!,
                usage,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                input_ucents: inputMicroCents,
                output_ucents: outputMicroCents,
                total_ucents: inputMicroCents + outputMicroCents,
                costs_currency: model.costs_currency,
                model_used: model.id,
                service_used: model.provider!,
                intended_service: intendedProvider,
                model_details: {
                    id: model.id,
                    provider: model.provider!,
                    input_cost_key: inputKey,
                    output_cost_key: outputKey,
                    costs: model.costs,
                    costs_currency: model.costs_currency,
                },
            },
            {},
        );
    }

    // -- Provider registration ---------------------------------------

    #registerProviders() {
        const providers = this.config.providers ?? {};
        const metering = this.services.metering;

        const readKey = (cfg: Record<string, unknown> | undefined) =>
            (cfg?.apiKey as string | undefined) ??
            (cfg?.secret_key as string | undefined);

        const claudeKey = readKey(providers['claude']);
        if (claudeKey) {
            this.#providers['claude'] = new ClaudeProvider(
                metering,
                {
                    fsEntry: this.stores.fsEntry,
                    s3Object: this.stores.s3Object,
                },
                this.services.fs,
                { apiKey: claudeKey },
            );
        }

        // Azure AI Foundry (OpenAI + xAI Grok). Registered before the regular
        // OpenAI/xAI providers so that since its costs mirror theirs but
        // Azure is preferred for us, it takes precedence in the per-model
        // bucket
        const azureOpenai = providers['azure-openai'];
        const azureOpenaiKey = readKey(azureOpenai);
        const azureOpenaiURL = azureOpenai?.apiURL as string | undefined;
        if (azureOpenaiKey && azureOpenaiURL) {
            const azureStores = {
                fsEntry: this.stores.fsEntry,
                s3Object: this.stores.s3Object,
            };
            const azureConfig = {
                apiKey: azureOpenaiKey,
                apiURL: azureOpenaiURL,
            };
            const azureCompletions = new AzureChatProvider(
                metering,
                azureStores,
                this.services.fs,
                azureConfig,
            );
            // Codex / Responses-API-only models can't use Chat Completions, so
            // they route through a sibling Responses provider pointed at the
            // same Azure endpoint. web_search (also Responses-only) delegates
            // here too.
            const azureResponses = new AzureResponsesProvider(
                metering,
                azureStores,
                this.services.fs,
                azureConfig,
            );
            azureCompletions.setResponsesProvider(azureResponses);
            this.#providers['azure-openai'] = azureCompletions;
            this.#providers['azure-openai-responses'] = azureResponses;
        }

        const openaiKey = readKey(providers['openai-completion']);
        if (openaiKey) {
            const openaiStores = {
                fsEntry: this.stores.fsEntry,
                s3Object: this.stores.s3Object,
            };
            const openaiCompletions = new OpenAiChatProvider(
                metering,
                openaiStores,
                this.services.fs,
                {
                    apiKey: openaiKey,
                },
            );
            const openaiResponses = new OpenAiResponsesChatProvider(
                metering,
                openaiStores,
                this.services.fs,
                { apiKey: openaiKey },
            );
            // web_search is Responses-only; let the Completions path delegate
            // to its sibling when users request it.
            openaiCompletions.setResponsesProvider(openaiResponses);
            this.#providers['openai-completion'] = openaiCompletions;
            this.#providers['openai-responses'] = openaiResponses;
        }

        const geminiKey = readKey(providers['gemini']);
        if (geminiKey) {
            this.#providers['gemini'] = new GeminiChatProvider(metering, {
                apiKey: geminiKey,
            });
        }

        const groqKey = readKey(providers['groq']);
        if (groqKey) {
            this.#providers['groq'] = new GroqAIProvider(
                { apiKey: groqKey },
                metering,
            );
        }

        const deepseekKey = readKey(providers['deepseek']);
        if (deepseekKey) {
            this.#providers['deepseek'] = new DeepSeekProvider(
                { apiKey: deepseekKey },
                metering,
            );
        }

        const mistralKey = readKey(providers['mistral']);
        if (mistralKey) {
            this.#providers['mistral'] = new MistralAIProvider(
                { apiKey: mistralKey },
                metering,
            );
        }

        const xaiKey = readKey(providers['xai']);
        if (xaiKey) {
            this.#providers['xai'] = new XAIProvider(
                { apiKey: xaiKey },
                metering,
            );
        }

        const moonshotKey = readKey(providers['moonshot']);
        if (moonshotKey) {
            this.#providers['moonshotai'] = new MoonshotProvider(
                { apiKey: moonshotKey },
                metering,
            );
        }

        const minimax = providers['minimax'];
        const minimaxKey = readKey(minimax);
        if (minimaxKey) {
            this.#providers['minimax'] = new MiniMaxProvider(
                {
                    apiKey: minimaxKey,
                    apiBaseUrl: minimax?.apiBaseUrl as string | undefined,
                },
                metering,
            );
        }

        const zai = providers['zai'];
        const zaiKey = readKey(zai);
        if (zaiKey) {
            this.#providers['zai'] = new ZAIProvider(
                {
                    apiKey: zaiKey,
                    apiBaseUrl: zai?.apiBaseUrl as string | undefined,
                },
                metering,
            );
        }

        const alibaba = providers['alibaba'];
        const alibabaKey = readKey(alibaba);
        if (alibabaKey) {
            this.#providers['alibaba'] = new AlibabaProvider(
                {
                    apiKey: alibabaKey,
                    apiBaseUrl: alibaba?.apiBaseUrl as string | undefined,
                },
                metering,
            );
        }

        const togetherKey = readKey(providers['together-ai']);
        if (togetherKey) {
            this.#providers['together-ai'] = new TogetherAIProvider(
                { apiKey: togetherKey },
                metering,
            );
        }

        // Ollama — auto-discover local instance unless `enabled: false`.
        const ollama = providers['ollama'];
        if (ollama?.enabled !== false) {
            this.#providers['ollama'] = new OllamaChatProvider(
                {
                    apiBaseUrl: ollama?.apiBaseUrl,
                },
                metering,
            );
        }

        const openrouter = providers['openrouter'];
        const openrouterKey = readKey(openrouter);
        if (openrouterKey) {
            this.#providers['openrouter'] = new OpenRouterProvider(
                {
                    apiKey: openrouterKey,
                    apiBaseUrl: openrouter?.apiBaseUrl as string | undefined,
                },
                metering,
            );
        }

        const infron = providers['infron'];
        const infronKey = readKey(infron);
        if (infronKey) {
            this.#providers['infron'] = new InfronProvider(
                {
                    apiKey: infronKey,
                    apiBaseUrl: infron?.apiBaseUrl as string | undefined,
                },
                metering,
            );
        }

        const byteplus = providers['byteplus'];
        const byteplusKey = readKey(byteplus);
        if (byteplusKey) {
            this.#providers['byteplus'] = new BytePlusProvider(
                {
                    apiKey: byteplusKey,
                    apiBaseUrl: byteplus?.apiBaseUrl as string | undefined,
                },
                metering,
            );
        }

        const neuralwatt = providers['neuralwatt'];
        const neuralwattKey = readKey(neuralwatt);
        if (neuralwattKey) {
            this.#providers['neuralwatt'] = new NeuralwattProvider(
                {
                    apiKey: neuralwattKey,
                    apiBaseUrl: neuralwatt?.apiBaseUrl as string | undefined,
                },
                metering,
            );
        }

        // Fake provider — always available for testing
        this.#providers['fake-chat'] = new FakeChatProvider();
    }

    // -- Model map ---------------------------------------------------

    /**
     * Group every provider's catalog into per-model buckets.
     *
     * A bucket is the set of routes to one model: the vendor we integrate with
     * directly plus every reseller carrying it. They are deliberately _not_
     * deduplicated — the duplicates are what the fallback loop walks when a
     * route fails. `compareModelPreference` decides who serves first, so a
     * reseller only takes traffic once the vendor has actually failed.
     *
     * Entries join a bucket by identity key (see `isIdentityKey`); display
     * names remain addressable but never merge two providers' entries.
     */
    async #buildModelMap() {
        for (const providerName in this.#providers) {
            const provider = this.#providers[providerName];

            for (const model of await provider.models()) {
                model.id = normalizeModelKey(model.id);
                if (model.puterId) {
                    model.aliases = model.aliases
                        ? [...model.aliases, model.puterId]
                        : [model.puterId];
                }

                // Catalogs derive an alias by stripping the vendor org off the
                // id, which yields '' for ids that carry no org. Drop those —
                // an empty key would pool unrelated models together.
                const keys = [model.id, ...(model.aliases ?? [])]
                    .map(normalizeModelKey)
                    .filter((key) => key.length > 0);

                const bucket =
                    keys
                        .filter(isIdentityKey)
                        .map((key) => this.#modelIdMap[key])
                        .find(Boolean) ?? [];
                bucket.push({ ...model, provider: providerName });

                // First registration owns a key: a name already claimed by
                // another model keeps pointing where it did.
                for (const key of keys) {
                    this.#modelIdMap[key] ??= bucket;
                }

                bucket.sort(compareModelPreference);
            }
        }
    }

    #resolveModel(modelId: string, provider?: string): IChatModel | null {
        const models = this.#modelIdMap[normalizeModelKey(modelId ?? '')];
        if (!models || models.length === 0) return null;
        // An explicitly requested provider is honoured even if its route is
        // marked — the caller asked for that one, not for the cheapest hop.
        if (provider) {
            const pinned = models.find((m) => m.provider === provider);
            if (pinned) return pinned;
        }
        return this.#preferHealthy(models) ?? models[0];
    }

    #findFallback(modelId: string, tried: Set<string>): IChatModel | null {
        const models = this.#modelIdMap[modelId];
        if (!models) return null;
        const untried = models.filter(
            (m) => !tried.has(routeId(m.provider!, m.id)),
        );
        // Degrade to a marked route rather than to no route at all: the marks
        // are a hint about recent failures, not a quota.
        return this.#preferHealthy(untried) ?? untried[0] ?? null;
    }

    #preferHealthy(models: IChatModel[]): IChatModel | undefined {
        return models.find((m) => !isRouteUnhealthy(m.provider!, m.id));
    }
}
