import { HttpError } from '../../core/http/HttpError.js';
import { Context } from '../../core/context.js';
import { PuterDriver } from '../types.js';
import type { IChatProvider, IChatModel, ICompleteArguments, IChatCompleteResult } from './types.js';
import { normalize_messages, normalize_single_message, extract_text } from './utils/Messages.js';
import { normalize_tools_object } from './utils/FunctionCalling.js';
import { ClaudeProvider } from './providers/claude/ClaudeProvider.js';

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

    override onServerStart () {
        this.#registerProviders();
        this.#buildModelMap();
    }

    // ── Interface methods ───────────────────────────────────────────

    async models () {
        const seen = new Set<string>();
        return Object.values(this.#modelIdMap)
            .flat()
            .filter(model => {
                if ( seen.has(model.id) ) return false;
                seen.add(model.id);
                return true;
            })
            .sort((a, b) => {
                if ( a.provider === b.provider ) return a.id.localeCompare(b.id);
                return a.provider!.localeCompare(b.provider!);
            });
    }

    async list () {
        return (await this.models()).map(m => m.puterId || m.id).sort();
    }

    async complete (args: ICompleteArguments): Promise<IChatCompleteResult> {
        const actor = Context.get('actor');
        if ( ! actor ) throw new HttpError(401, 'Authentication required');

        let intendedProvider = args.provider || '';
        if ( !args.model && !intendedProvider ) {
            intendedProvider = 'claude'; // default provider
        }
        if ( !args.model && intendedProvider && this.#providers[intendedProvider] ) {
            args.model = this.#providers[intendedProvider].getDefaultModel();
        }

        let model = this.#resolveModel(args.model, intendedProvider);
        if ( ! model ) {
            throw new HttpError(400, `Model not found: ${args.model}`);
        }

        if ( args.messages ) {
            args.messages = normalize_messages(args.messages);
        }
        if ( args.tools ) {
            normalize_tools_object(args.tools);
        }

        // First attempt
        const provider = this.#providers[model.provider!];
        if ( ! provider ) {
            throw new HttpError(500, `No provider found for model ${model.id}`);
        }

        const attempts: { model: string; provider: string; error: string }[] = [];
        let res: IChatCompleteResult | undefined;

        try {
            res = await provider.complete({ ...args, model: model.id, provider: model.provider });
        } catch (e) {
            const error = e as Error;
            attempts.push({ model: model.id, provider: model.provider!, error: error?.message ?? String(e) });

            // Fallback loop
            const tried = [model.id];
            const triedProviders = [model.provider!];
            let lastError: Error | null = error;

            while ( lastError && tried.length < MAX_FALLBACKS ) {
                const fallback = this.#findFallback(model.id, tried, triedProviders);
                if ( ! fallback ) break;

                const fbProvider = this.#providers[fallback.provider!];
                if ( ! fbProvider ) break;

                tried.push(fallback.id);
                triedProviders.push(fallback.provider!);

                try {
                    res = await fbProvider.complete({ ...args, model: fallback.id, provider: fallback.provider });
                    model = fallback;
                    lastError = null;
                } catch (fbErr) {
                    lastError = fbErr as Error;
                    attempts.push({ model: fallback.id, provider: fallback.provider!, error: lastError?.message ?? String(fbErr) });
                }
            }
        }

        if ( ! res ) {
            throw new HttpError(502, 'All providers failed', { attempts });
        }

        if ( args.response?.normalize && 'message' in res && res.message ) {
            return { ...res, message: normalize_single_message(res.message), normalized: true };
        }

        return res;
    }

    // ── Provider registration ───────────────────────────────────────

    #registerProviders () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfg = this.config as any;
        const providers = cfg?.providers ?? cfg?.services ?? {};

        const claudeConfig = providers['claude'];
        if ( claudeConfig?.apiKey ) {
            this.#providers['claude'] = new ClaudeProvider(claudeConfig);
        }

        // TODO: register additional providers (OpenAI, Gemini, Groq, etc.)
        // Each follows the same pattern:
        //   const config = providers['openai-completion'];
        //   if ( config?.apiKey ) this.#providers['openai-completion'] = new OpenAiChatProvider(config);
    }

    // ── Model map ───────────────────────────────────────────────────

    async #buildModelMap () {
        for ( const providerName in this.#providers ) {
            const provider = this.#providers[providerName];
            for ( const model of await provider.models() ) {
                model.id = model.id.trim().toLowerCase();
                if ( ! this.#modelIdMap[model.id] ) {
                    this.#modelIdMap[model.id] = [];
                }
                this.#modelIdMap[model.id].push({ ...model, provider: providerName });

                if ( model.puterId ) {
                    if ( model.aliases ) {
                        model.aliases.push(model.puterId);
                    } else {
                        model.aliases = [model.puterId];
                    }
                }

                if ( model.aliases ) {
                    for ( let alias of model.aliases ) {
                        alias = alias.trim().toLowerCase();
                        if ( ! this.#modelIdMap[alias] ) {
                            this.#modelIdMap[alias] = this.#modelIdMap[model.id];
                        } else if ( this.#modelIdMap[alias] !== this.#modelIdMap[model.id] ) {
                            this.#modelIdMap[alias].push({ ...model, provider: providerName });
                            this.#modelIdMap[model.id] = this.#modelIdMap[alias];
                        }
                    }
                }

                // Sort: cheapest first
                this.#modelIdMap[model.id].sort((a, b) => {
                    return (a.costs[a.input_cost_key as string || 'input_tokens'] as number)
                        - (b.costs[b.input_cost_key as string || 'input_tokens'] as number);
                });
            }
        }
    }

    #resolveModel (modelId: string, provider?: string): IChatModel | null {
        const models = this.#modelIdMap[modelId?.trim().toLowerCase()];
        if ( ! models || models.length === 0 ) return null;
        if ( ! provider ) return models[0];
        return models.find(m => m.provider === provider) ?? models[0];
    }

    #findFallback (modelId: string, tried: string[], triedProviders: string[]): IChatModel | null {
        const models = this.#modelIdMap[modelId];
        if ( ! models ) return null;
        return models.find(m => !tried.includes(m.id) || !triedProviders.includes(m.provider!)) ?? null;
    }
}
