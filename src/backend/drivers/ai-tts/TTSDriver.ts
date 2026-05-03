/**
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
import { AWSPollyTTSProvider } from './providers/awsPolly/AWSPollyTTSProvider.js';
import { ElevenLabsTTSProvider } from './providers/elevenlabs/ElevenLabsTTSProvider.js';
import { GeminiTTSProvider } from './providers/gemini/GeminiTTSProvider.js';
import { OpenAITTSProvider } from './providers/openai/OpenAITTSProvider.js';
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
 * Manages multiple upstream TTS providers (OpenAI, ElevenLabs, AWS Polly)
 * and handles provider routing, voice/engine aggregation, and speech
 * synthesis. Each provider is an `ITTSProvider` instantiated from config
 * on boot.
 */
// puter-js still routes TTS via legacy per-provider driver names rather
// than passing `{ provider }` in args, so alias the unified driver under
// the names the client expects. `#providerFromAlias` normalizes those
// aliases to the internal provider keys used by `#providers`.
const TTS_ALIASES = [
    'aws-polly',
    'openai-tts',
    'elevenlabs-tts',
    'gemini-tts',
    'xai-tts',
] as const;
type TTSAlias = (typeof TTS_ALIASES)[number];
const ALIAS_TO_PROVIDER: Record<TTSAlias, string> = {
    'aws-polly': 'aws-polly',
    'openai-tts': 'openai',
    'elevenlabs-tts': 'elevenlabs',
    'gemini-tts': 'gemini',
    'xai-tts': 'xai',
};

export class TTSDriver extends PuterDriver {
    readonly driverInterface = 'puter-tts';
    readonly driverName = 'ai-tts';
    readonly driverAliases = [...TTS_ALIASES];
    readonly isDefault = true;

    #providers: Record<string, ITTSProvider> = {};

    /** Resolve a provider name from the alias the caller used, if any. */
    #providerFromAlias(): string | undefined {
        const alias = Context.get('driverName') as string | undefined;
        if (!alias) return undefined;
        return ALIAS_TO_PROVIDER[alias as TTSAlias];
    }

    override onServerStart() {
        this.#registerProviders();
    }

    // ── Interface methods ───────────────────────────────────────────

    /**
     * List all available voices across all configured providers.
     */
    async list_voices(args?: Record<string, unknown>): Promise<ITTSVoice[]> {
        const provider =
            (args?.provider as string | undefined) ?? this.#providerFromAlias();

        if (provider) {
            const p = this.#providers[provider];
            if (!p) return [];
            return p.listVoices(args);
        }

        const allVoices: ITTSVoice[] = [];
        for (const p of Object.values(this.#providers)) {
            const voices = await p.listVoices(args);
            allVoices.push(...voices);
        }
        return allVoices;
    }

    /**
     * List all available engines/models across all configured providers.
     */
    async list_engines(args?: Record<string, unknown>): Promise<ITTSEngine[]> {
        const provider =
            (args?.provider as string | undefined) ?? this.#providerFromAlias();

        if (provider) {
            const p = this.#providers[provider];
            if (!p) return [];
            return p.listEngines();
        }

        const allEngines: ITTSEngine[] = [];
        for (const p of Object.values(this.#providers)) {
            const engines = await p.listEngines();
            allEngines.push(...engines);
        }
        return allEngines;
    }

    /**
     * List provider names that are currently configured.
     */
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
     * Synthesize speech from text. Routes to the appropriate provider
     * based on the `provider` argument, or falls back to the first
     * available provider.
     */
    async synthesize(
        args: ISynthesizeArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const actor = Context.get('actor');
        if (!actor) throw new HttpError(401, 'Authentication required');

        const providerName =
            args.provider ||
            this.#providerFromAlias() ||
            this.#getDefaultProviderName();
        if (!providerName) {
            throw new HttpError(500, 'No TTS providers configured');
        }

        const provider = this.#providers[providerName];
        if (!provider) {
            throw new HttpError(
                400,
                `TTS provider not found: ${providerName}. Available: ${Object.keys(this.#providers).join(', ')}`,
            );
        }

        return provider.synthesize(args) as Promise<
            DriverStreamResult | { url: string; content_type: string }
        >;
    }

    // ── Provider registration ───────────────────────────────────────

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

    #getDefaultProviderName(): string | null {
        const names = Object.keys(this.#providers);
        if (names.length === 0) return null;
        // Prefer openai, then elevenlabs, then gemini, then aws-polly
        if (this.#providers['openai']) return 'openai';
        if (this.#providers['elevenlabs']) return 'elevenlabs';
        if (this.#providers['gemini']) return 'gemini';
        return names[0];
    }
}
