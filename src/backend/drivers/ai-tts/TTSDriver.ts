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

import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { DriverStreamResult } from '../meta.js';
import { PuterDriver } from '../types.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import {
    DEFAULT_TTS_PROVIDER,
    normalizeTTSProvider,
    TTS_DRIVER_ALIASES,
    TTS_PROVIDERS,
} from './providerAliases.js';
import { AWSPollyTTSProvider } from './providers/awsPolly/AWSPollyTTSProvider.js';
import { ElevenLabsTTSProvider } from './providers/elevenlabs/ElevenLabsTTSProvider.js';
import { GeminiTTSProvider } from './providers/gemini/GeminiTTSProvider.js';
import { OpenAITTSProvider } from './providers/openai/OpenAITTSProvider.js';
import { SpeechifyTTSProvider } from './providers/speechify/SpeechifyTTSProvider.js';
import { XAITTSProvider } from './providers/xai/XAITTSProvider.js';
import type {
    ISynthesizeArgs,
    ITTSEngine,
    ITTSProvider,
    ITTSVoice,
} from './types.js';

/**
 * Driver implementing the `puter-tts` interface.
 *
 * Manages multiple upstream TTS providers and handles provider routing,
 * voice/engine aggregation, and speech synthesis. Each provider is an
 * `ITTSProvider` instantiated from config on boot.
 *
 * Provider selection, alias resolution and per-provider option naming all live
 * here, so a caller only has to name the provider it wants.
 */

/** Opt-in value that widens the list methods out to every provider. */
const ALL_PROVIDERS = 'all';

const isAllProviders = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().toLowerCase() === ALL_PROVIDERS;

export class TTSDriver extends PuterDriver {
    readonly driverInterface = 'puter-tts';
    readonly driverName = 'ai-tts';
    // Older SDK bundles name the provider in the driver slot instead of
    // passing `{ provider }`; `#resolveProvider` reads the requested alias
    // back off the Context.
    readonly driverAliases = [...TTS_DRIVER_ALIASES];
    readonly isDefault = true;

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    #providers: Record<string, ITTSProvider> = {};

    override onServerStart() {
        this.#registerProviders();
    }

    // -- Interface methods -------------------------------------------

    /**
     * List available voices. Defaults to the default provider; pass `provider:
     * 'all'` to aggregate across every configured provider.
     */
    async list_voices(args?: Record<string, unknown>): Promise<ITTSVoice[]> {
        const { provider: requested, ...rest } = args ?? {};
        if (isAllProviders(requested)) {
            const allVoices: ITTSVoice[] = [];
            for (const p of Object.values(this.#providers)) {
                allVoices.push(...(await p.listVoices(rest)));
            }
            return allVoices;
        }

        const p =
            this.#providers[this.#resolveProvider({ provider: requested })];
        if (!p) return [];
        return p.listVoices(rest);
    }

    /**
     * List available engines/models. Defaults to the default provider; pass
     * `provider: 'all'` to aggregate across every configured provider.
     */
    async list_engines(args?: Record<string, unknown>): Promise<ITTSEngine[]> {
        const requested = args?.provider;
        if (isAllProviders(requested)) {
            const allEngines: ITTSEngine[] = [];
            for (const p of Object.values(this.#providers)) {
                allEngines.push(...(await p.listEngines()));
            }
            return allEngines;
        }

        const p =
            this.#providers[this.#resolveProvider({ provider: requested })];
        if (!p) return [];
        return p.listEngines();
    }

    /** List provider names that are currently configured. */
    async list(): Promise<string[]> {
        return Object.keys(this.#providers);
    }

    override getReportedCosts(): Record<string, unknown>[] {
        const all: Record<string, unknown>[] = [];
        for (const p of Object.values(this.#providers)) {
            const fn = (
                p as unknown as {
                    getReportedCosts?: () => Record<string, unknown>[];
                }
            ).getReportedCosts;
            if (typeof fn === 'function') {
                try {
                    const entries = fn.call(p);
                    if (Array.isArray(entries)) all.push(...entries);
                } catch {
                    // ignore — cost reporting is best-effort
                }
            }
        }
        return all;
    }

    /**
     * Synthesize speech from text, routed to the provider named by `provider`
     * (or the default when none is given).
     */
    async synthesize(
        args: ISynthesizeArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        const providerName = this.#resolveProvider(args);
        const provider = this.#providers[providerName];
        if (!provider) {
            throw new HttpError(
                400,
                `TTS provider not configured: ${providerName}. Available: ${Object.keys(this.#providers).join(', ')}`,
                { legacyCode: 'bad_request' },
            );
        }

        return provider.synthesize(
            this.#providerArgs(providerName, args),
        ) as Promise<
            DriverStreamResult | { url: string; content_type: string }
        >;
    }

    // -- Provider routing --------------------------------------------

    /**
     * Decide which provider handles a call. An explicit `provider` wins, then
     * an `engine` that names a provider (a long-standing shorthand), then the
     * legacy driver alias the caller dispatched through, then the default.
     */
    #resolveProvider(args: { provider?: unknown; engine?: unknown }): string {
        if (
            args.provider !== undefined &&
            args.provider !== null &&
            args.provider !== ''
        ) {
            const named = normalizeTTSProvider(args.provider);
            if (!named) {
                throw new HttpError(
                    400,
                    `TTS provider not found: ${String(args.provider)}. Available: ${TTS_PROVIDERS.join(', ')}`,
                    { legacyCode: 'bad_request' },
                );
            }
            return named;
        }

        return (
            normalizeTTSProvider(args.engine) ??
            normalizeTTSProvider(Context.get('driverName')) ??
            this.#defaultProvider()
        );
    }

    /**
     * `engine` is AWS Polly's own concept; on the model-based providers it is
     * the legacy spelling of `model`.
     */
    #providerArgs(
        providerName: string,
        args: ISynthesizeArgs,
    ): ISynthesizeArgs {
        if (providerName === 'aws-polly') {
            return { ...args, provider: providerName };
        }
        const { engine, ...rest } = args;
        if (
            rest.model === undefined &&
            typeof engine === 'string' &&
            // An engine that named the provider selected it above; it is not
            // also a model id.
            !normalizeTTSProvider(engine)
        ) {
            rest.model = engine;
        }
        return { ...rest, provider: providerName };
    }

    /**
     * The documented default, falling back to whatever is configured so a
     * deployment without AWS Polly still serves TTS.
     */
    #defaultProvider(): string {
        for (const name of [DEFAULT_TTS_PROVIDER, ...TTS_PROVIDERS]) {
            if (this.#providers[name]) return name;
        }
        return Object.keys(this.#providers)[0] ?? DEFAULT_TTS_PROVIDER;
    }

    // -- Provider registration ---------------------------------------

    #registerProviders() {
        const providers = this.config.providers ?? {};
        const m = this.services.metering;

        const openaiConfig =
            (providers['openai-tts'] as Record<string, unknown> | undefined) ??
            (providers['openai'] as Record<string, unknown> | undefined);
        const openaiKey =
            (openaiConfig?.apiKey as string | undefined) ??
            (openaiConfig?.secret_key as string | undefined);
        if (openaiKey) {
            try {
                this.#providers['openai'] = new OpenAITTSProvider(m, {
                    apiKey: openaiKey,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init OpenAI TTS provider:',
                    (e as Error).message,
                );
            }
        }

        const elevenlabs = providers['elevenlabs'] as
            | Record<string, unknown>
            | undefined;
        const elevenKey =
            (elevenlabs?.apiKey as string | undefined) ??
            (elevenlabs?.api_key as string | undefined) ??
            (elevenlabs?.key as string | undefined);
        if (elevenKey) {
            try {
                this.#providers['elevenlabs'] = new ElevenLabsTTSProvider(m, {
                    apiKey: elevenKey,
                    apiBaseUrl: elevenlabs?.apiBaseUrl as string | undefined,
                    defaultVoiceId: elevenlabs?.defaultVoiceId as
                        | string
                        | undefined,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init ElevenLabs TTS provider:',
                    (e as Error).message,
                );
            }
        }

        const polly = providers['aws-polly'] as
            | Record<string, unknown>
            | undefined;
        const pollyAws = (polly?.aws ?? polly) as
            | Record<string, unknown>
            | undefined;
        const pollyAccessKey = pollyAws?.access_key as string | undefined;
        const pollySecretKey = pollyAws?.secret_key as string | undefined;
        const pollyRegion =
            (pollyAws?.region as string | undefined) ??
            (polly?.region as string | undefined);
        if (pollyAccessKey && pollySecretKey) {
            try {
                this.#providers['aws-polly'] = new AWSPollyTTSProvider(m, {
                    access_key: pollyAccessKey,
                    secret_key: pollySecretKey,
                    region: pollyRegion,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init AWS Polly TTS provider:',
                    (e as Error).message,
                );
            }
        }

        this.#registerGeminiProvider(providers);
        this.#registerXAIProvider(providers);
        this.#registerSpeechifyProvider(providers);
    }

    #registerGeminiProvider(providers: Record<string, unknown>) {
        const m = this.services.metering;
        const gemini = (providers['gemini'] ?? providers['gemini-tts']) as
            | Record<string, unknown>
            | undefined;
        const geminiKey =
            (gemini?.apiKey as string | undefined) ??
            (gemini?.api_key as string | undefined) ??
            (gemini?.key as string | undefined);
        if (geminiKey) {
            try {
                this.#providers['gemini'] = new GeminiTTSProvider(m, {
                    apiKey: geminiKey,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init Gemini TTS provider:',
                    (e as Error).message,
                );
            }
        }
    }

    #registerXAIProvider(providers: Record<string, unknown>) {
        const m = this.services.metering;
        const xai = (providers['xai'] ?? providers['xai-tts']) as
            | Record<string, unknown>
            | undefined;
        const xaiKey =
            (xai?.apiKey as string | undefined) ??
            (xai?.api_key as string | undefined) ??
            (xai?.key as string | undefined);
        if (xaiKey) {
            try {
                this.#providers['xai'] = new XAITTSProvider(m, {
                    apiKey: xaiKey,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init xAI TTS provider:',
                    (e as Error).message,
                );
            }
        }
    }

    #registerSpeechifyProvider(providers: Record<string, unknown>) {
        const m = this.services.metering;
        const speechify = (providers['speechify'] ??
            providers['speechify-tts']) as Record<string, unknown> | undefined;
        const speechifyKey =
            (speechify?.apiKey as string | undefined) ??
            (speechify?.api_key as string | undefined) ??
            (speechify?.key as string | undefined);
        if (speechifyKey) {
            try {
                this.#providers['speechify'] = new SpeechifyTTSProvider(m, {
                    apiKey: speechifyKey,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init Speechify TTS provider:',
                    (e as Error).message,
                );
            }
        }
    }
}
