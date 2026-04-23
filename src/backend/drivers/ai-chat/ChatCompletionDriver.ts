import { PassThrough } from 'node:stream';
import crypto from 'node:crypto';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import type { DriverStreamResult } from '../meta.js';
import { PuterDriver } from '../types.js';
import { ClaudeProvider } from './providers/claude/ClaudeProvider.js';
import { DeepSeekProvider } from './providers/deepseek/DeepSeekProvider.js';
import { FakeChatProvider } from './providers/FakeChatProvider.js';
import { GeminiChatProvider } from './providers/gemini/GeminiChatProvider.js';
import { GroqAIProvider } from './providers/groq/GroqAIProvider.js';
import { MistralAIProvider } from './providers/mistral/MistralAiProvider.js';
import { OllamaChatProvider } from './providers/ollama/OllamaProvider.js';
import { OpenAiChatProvider } from './providers/openai/OpenAiChatCompletionsProvider.js';
import { OpenAiResponsesChatProvider } from './providers/openai/OpenAiChatResponsesProvider.js';
import { OpenRouterProvider } from './providers/openrouter/OpenRouterProvider.js';
import { TogetherAIProvider } from './providers/together/TogetherAIProvider.js';
import { XAIProvider } from './providers/xai/XAIProvider.js';
import type {
    IChatCompleteResult,
    IChatModel,
    IChatProvider,
    ICompleteArguments,
} from './types.js';
import { normalize_tools_object } from './utils/FunctionCalling.js';
import {
    extract_text,
    normalize_messages,
    normalize_single_message,
} from './utils/Messages.js';
import { AIChatStream } from './utils/Streaming.js';

const MAX_FALLBACKS = 4; // includes first attempt

/**
 * Driver implementing the `puter-chat-completion` interface.
 *
 * Manages multiple upstream providers (Claude, OpenAI, …) and handles
 * model resolution, provider routing, fallback on failure, and message
 * normalisation. Each provider is a plain `IChatProvider` — the driver
 * instantiates them from config on boot.
 *
 * Providers handle their own metering internally.
 */
export class ChatCompletionDriver extends PuterDriver {
    readonly driverInterface = 'puter-chat-completion';
    readonly driverName = 'ai-chat';
    readonly isDefault = true;

    #providers: Record<string, IChatProvider> = {};
    #modelIdMap: Record<string, IChatModel[]> = {};

    override onServerStart() {
        this.#registerProviders();
        this.#buildModelMap();
    }

    // ── Interface methods ───────────────────────────────────────────

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
        if (!actor) throw new HttpError(401, 'Authentication required');

        let intendedProvider = args.provider || '';
        if (!args.model && !intendedProvider) {
            intendedProvider = 'claude'; // default provider
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
            throw new HttpError(400, `Model not found: ${args.model}`);
        }

        if (args.messages) {
            args.messages = normalize_messages(args.messages);
        }
        if (args.tools) {
            normalize_tools_object(args.tools);
        }

        const completionId = crypto.randomUUID();

        const validateEvent: Record<string, unknown> = {
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
        if (!validateEvent.allow) {
            const reason =
                typeof validateEvent.message === 'string'
                    ? validateEvent.message
                    : 'Prompt blocked by policy';
            throw new HttpError(403, reason);
        }

        // ── Credit / subscription gates (metering) ────────────────────
        // Cheap pre-flight: reject when the user can't afford even the
        // approximate input cost, keep subscriber-only models gated, and
        // cap `max_tokens` so output can't exceed remaining credits.
        const metering = this.services.metering;
        const inputCostKey =
            (model.input_cost_key as string | undefined) ?? 'input_tokens';
        const outputCostKey =
            (model.output_cost_key as string | undefined) ?? 'output_tokens';
        const inputTokenCost = Number(model.costs?.[inputCostKey] ?? 0);
        const outputTokenCost = Number(model.costs?.[outputCostKey] ?? 0);
        const text = extract_text(args.messages ?? []);
        // Rough estimator from v1 — avg of char/4 and word*(4/3), halved.
        // See https://help.openai.com/en/articles/4936856
        const approximateTokenCount = Math.floor(
            (text.length / 4 + text.split(/\s+/).length * (4 / 3)) / 2,
        );
        const approximateInputCost = approximateTokenCount * inputTokenCost;
        const minimumCredits = Number(model.minimumCredits ?? 0);

        const usageAllowed = await metering.hasEnoughCredits(
            actor,
            Math.max(approximateInputCost, minimumCredits),
        );
        if (!usageAllowed) {
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
            const remainingCredits = await metering.getRemainingUsage(actor);
            const maxAllowedOutputUcents =
                remainingCredits - approximateInputCost;
            const maxAllowedOutputTokens =
                maxAllowedOutputUcents / outputTokenCost;
            if (maxAllowedOutputTokens) {
                const cap = Math.floor(
                    Math.min(
                        args.max_tokens ?? Number.POSITIVE_INFINITY,
                        maxAllowedOutputTokens,
                        model.max_tokens - approximateTokenCount,
                    ),
                );
                args.max_tokens = cap < 1 ? undefined : cap;
            }
        }

        // First attempt
        const provider = this.#providers[model.provider!];
        if (!provider) {
            throw new HttpError(500, `No provider found for model ${model.id}`);
        }

        const attempts: { model: string; provider: string; error: string }[] =
            [];
        let res: IChatCompleteResult | undefined;

        try {
            res = await provider.complete({
                ...args,
                model: model.id,
                provider: model.provider,
            });
        } catch (e) {
            const error = e as Error;
            attempts.push({
                model: model.id,
                provider: model.provider!,
                error: error?.message ?? String(e),
            });

            // Fallback loop
            const tried = [model.id];
            const triedProviders = [model.provider!];
            let lastError: Error | null = error;

            while (lastError && tried.length < MAX_FALLBACKS) {
                const fallback = this.#findFallback(
                    model.id,
                    tried,
                    triedProviders,
                );
                if (!fallback) break;

                const fbProvider = this.#providers[fallback.provider!];
                if (!fbProvider) break;

                // Credits can be exhausted mid-fallback by parallel requests;
                // re-check before another upstream hit. Same bail as the
                // pre-flight above.
                const fallbackUsageAllowed = await metering.hasEnoughCredits(
                    actor,
                    1,
                );
                if (!fallbackUsageAllowed) {
                    throw new HttpError(402, 'No usage left for request.', {
                        legacyCode: 'insufficient_funds',
                    });
                }

                tried.push(fallback.id);
                triedProviders.push(fallback.provider!);

                try {
                    res = await fbProvider.complete({
                        ...args,
                        model: fallback.id,
                        provider: fallback.provider,
                    });
                    model = fallback;
                    lastError = null;
                } catch (fbErr) {
                    lastError = fbErr as Error;
                    attempts.push({
                        model: fallback.id,
                        provider: fallback.provider!,
                        error: lastError?.message ?? String(fbErr),
                    });
                }
            }
        }

        if (!res) {
            throw new HttpError(502, 'All providers failed', {
                fields: { attempts },
            });
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

            // Intercept `chatStream.end(usage)` so we can fire the same
            // complete + cost-calculated events the non-streaming branch
            // emits. Providers always terminate streams via `.end(usage)`;
            // if they skip it, we just lose the cost event (no worse than
            // not emitting).
            const originalEnd = chatStream.end.bind(chatStream);
            chatStream.end = (usage?: Record<string, number>) => {
                this.clients.event.emit(
                    'ai.prompt.complete',
                    {
                        username,
                        completionId,
                        intended_service: intendedProvider,
                        parameters: args,
                        result: { usage, stream: true },
                        model_used: model.id,
                        service_used: model.provider,
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
                return originalEnd(usage!);
            };

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

        // ── Post-completion audit event ──────────────────────────────
        // Only for non-streaming results (streaming emits from the
        // `chatStream.end` wrapper above). Extensions like prompt_block /
        // prodMeteringAndBilling listen for this to log completions.
        this.clients.event.emit(
            'ai.prompt.complete',
            {
                username,
                completionId,
                intended_service: intendedProvider,
                parameters: args,
                result: res,
                model_used: model.id,
                service_used: model.provider,
            },
            {},
        );

        if ('usage' in res && res.usage) {
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

        const inputKey =
            (model.input_cost_key as string | undefined) ?? 'input_tokens';
        const outputKey =
            (model.output_cost_key as string | undefined) ?? 'output_tokens';
        const inputCostPer = Number(model.costs?.[inputKey] ?? 0);
        const outputCostPer = Number(model.costs?.[outputKey] ?? 0);
        const inputTokens = Number(
            usage[inputKey] ?? usage.prompt_tokens ?? usage.input_tokens ?? 0,
        );
        const outputTokens = Number(
            usage[outputKey] ??
                usage.completion_tokens ??
                usage.output_tokens ??
                0,
        );
        const inputUcents = Math.round(inputTokens * inputCostPer);
        const outputUcents = Math.round(outputTokens * outputCostPer);

        this.clients.event.emit(
            'ai.prompt.cost-calculated',
            {
                completionId,
                username,
                usage,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                input_ucents: inputUcents,
                output_ucents: outputUcents,
                total_ucents: inputUcents + outputUcents,
                costs_currency: model.costs_currency,
                model_used: model.id,
                service_used: model.provider,
                intended_service: intendedProvider,
                model_details: {
                    id: model.id,
                    provider: model.provider,
                    input_cost_key: inputKey,
                    output_cost_key: outputKey,
                    costs: model.costs,
                    costs_currency: model.costs_currency,
                },
            },
            {},
        );
    }

    // ── Provider registration ───────────────────────────────────────

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
                { apiKey: claudeKey },
            );
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
                {
                    apiKey: openaiKey,
                },
            );
            const openaiResponses = new OpenAiResponsesChatProvider(
                metering,
                openaiStores,
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

        // Fake provider — always available for testing
        this.#providers['fake-chat'] = new FakeChatProvider();
    }

    // ── Model map ───────────────────────────────────────────────────

    async #buildModelMap() {
        const AGGREGATORS = new Set(['together-ai', 'openrouter']);

        for (const providerName in this.#providers) {
            const provider = this.#providers[providerName];
            const isAggregator = AGGREGATORS.has(providerName);

            for (const model of await provider.models()) {
                model.id = model.id.trim().toLowerCase();
                if (!this.#modelIdMap[model.id]) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({
                    ...model,
                    provider: providerName,
                });

                if (model.puterId) {
                    if (model.aliases) {
                        model.aliases.push(model.puterId);
                    } else {
                        model.aliases = [model.puterId];
                    }
                }

                if (isAggregator && model.aliases) {
                    let skip = false;
                    for (const rawAlias of model.aliases) {
                        const alias = rawAlias.trim().toLowerCase();
                        const existing = this.#modelIdMap[alias];
                        if (
                            existing &&
                            existing !== this.#modelIdMap[model.id]
                        ) {
                            if (existing.some((m) => m.provider === 'gemini')) {
                                // Gemini exception — let the aggregator
                                // entry through.
                                continue;
                            }
                            skip = true;
                            break;
                        }
                    }
                    if (skip) {
                        // Remove the entry we just pushed; leave the bucket
                        // intact for other providers.
                        const bucket = this.#modelIdMap[model.id];
                        bucket.pop();
                        if (bucket.length === 0) {
                            delete this.#modelIdMap[model.id];
                        }
                        continue;
                    }
                }

                if (model.aliases) {
                    for (let alias of model.aliases) {
                        alias = alias.trim().toLowerCase();
                        if (!this.#modelIdMap[alias]) {
                            this.#modelIdMap[alias] =
                                this.#modelIdMap[model.id];
                        } else if (
                            this.#modelIdMap[alias] !==
                            this.#modelIdMap[model.id]
                        ) {
                            this.#modelIdMap[alias].push({
                                ...model,
                                provider: providerName,
                            });
                            this.#modelIdMap[model.id] =
                                this.#modelIdMap[alias];
                        }
                    }
                }

                // Sort: together-ai always last; then cheapest input-cost
                // first; ties break by shorter id (usually the official
                // name over a long aggregator-qualified one).
                this.#modelIdMap[model.id].sort((a, b) => {
                    const aAgg = a.provider === 'together-ai';
                    const bAgg = b.provider === 'together-ai';
                    if (aAgg !== bAgg) return aAgg ? 1 : -1;
                    const aCost = a.costs[
                        (a.input_cost_key as string) || 'input_tokens'
                    ] as number;
                    const bCost = b.costs[
                        (b.input_cost_key as string) || 'input_tokens'
                    ] as number;
                    if (aCost === bCost) return a.id.length - b.id.length;
                    return aCost - bCost;
                });
            }
        }
    }

    #resolveModel(modelId: string, provider?: string): IChatModel | null {
        const models = this.#modelIdMap[modelId?.trim().toLowerCase()];
        if (!models || models.length === 0) return null;
        if (!provider) return models[0];
        return models.find((m) => m.provider === provider) ?? models[0];
    }

    #findFallback(
        modelId: string,
        tried: string[],
        triedProviders: string[],
    ): IChatModel | null {
        const models = this.#modelIdMap[modelId];
        if (!models) return null;
        return (
            models.find(
                (m) =>
                    !tried.includes(m.id) ||
                    !triedProviders.includes(m.provider!),
            ) ?? null
        );
    }
}
