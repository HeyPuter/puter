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
import {
    type AiMeteringService,
    withAiCostFactor,
} from '../util/aiCostFactor.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import { ProviderRegistry, readProviderKey } from '../util/providerRegistry.js';
import { TTS_CATALOG, TTS_DRIVER_ALIASES } from './providerAliases.js';
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

    #providers = new ProviderRegistry<ITTSProvider>(TTS_CATALOG);

    /** Metering scoped to this driver. Lazy: services wire up after drivers. */
    get #aiMetering(): AiMeteringService {
        return withAiCostFactor(
            this.services.metering,
            this.clients.event,
            this.driverName,
        );
    }

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
        if (ProviderRegistry.isAll(requested)) {
            return this.#providers.collect((p) => p.listVoices(rest));
        }
        const p = this.#providers.get(
            this.#resolveProvider({ provider: requested }),
        );
        return p ? p.listVoices(rest) : [];
    }

    /**
     * List available engines/models. Defaults to the default provider; pass
     * `provider: 'all'` to aggregate across every configured provider.
     */
    async list_engines(args?: Record<string, unknown>): Promise<ITTSEngine[]> {
        const requested = args?.provider;
        if (ProviderRegistry.isAll(requested)) {
            return this.#providers.collect((p) => p.listEngines());
        }
        const p = this.#providers.get(
            this.#resolveProvider({ provider: requested }),
        );
        return p ? p.listEngines() : [];
    }

    /** List provider names that are currently configured. */
    async list(): Promise<string[]> {
        return this.#providers.names();
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return this.#providers
            .names()
            .flatMap((name) => this.#providers.get(name)!.getReportedCosts());
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
        const provider = this.#providers.get(providerName);
        if (!provider) {
            throw new HttpError(
                400,
                `TTS provider not configured: ${providerName}. Available: ${this.#providers.names().join(', ')}`,
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
        return this.#providers.resolve(
            args.provider,
            args.engine,
            Context.get('driverName'),
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
            !this.#providers.normalize(engine)
        ) {
            rest.model = engine;
        }
        return { ...rest, provider: providerName };
    }

    // -- Provider registration ---------------------------------------

    #registerProviders() {
        const providers = this.config.providers ?? {};
        const m = this.#aiMetering;
        const register = (id: string, make: () => ITTSProvider | undefined) => {
            try {
                const provider = make();
                if (provider) this.#providers.register(id, provider);
            } catch (e) {
                console.warn(
                    `[TTSDriver] Failed to init ${id} TTS provider:`,
                    (e as Error).message,
                );
            }
        };
        const keyed = (
            make: (apiKey: string) => ITTSProvider,
            ...cfgs: Array<Record<string, unknown> | undefined>
        ) => {
            const apiKey = readProviderKey(...cfgs);
            return apiKey ? make(apiKey) : undefined;
        };

        register('openai', () =>
            keyed(
                (apiKey) => new OpenAITTSProvider(m, { apiKey }),
                providers['openai-tts'],
                providers['openai'],
            ),
        );

        const elevenlabs = providers['elevenlabs'];
        register('elevenlabs', () =>
            keyed(
                (apiKey) =>
                    new ElevenLabsTTSProvider(m, {
                        apiKey,
                        apiBaseUrl: elevenlabs?.apiBaseUrl,
                        defaultVoiceId: elevenlabs?.defaultVoiceId,
                    }),
                elevenlabs,
            ),
        );

        const polly = providers['aws-polly'];
        const pollyAws = (polly?.aws ?? polly) as
            | Record<string, unknown>
            | undefined;
        const pollyAccessKey = pollyAws?.access_key as string | undefined;
        const pollySecretKey = pollyAws?.secret_key as string | undefined;
        if (pollyAccessKey && pollySecretKey) {
            register(
                'aws-polly',
                () =>
                    new AWSPollyTTSProvider(m, {
                        access_key: pollyAccessKey,
                        secret_key: pollySecretKey,
                        region: (pollyAws?.region ?? polly?.region) as
                            | string
                            | undefined,
                    }),
            );
        }

        register('gemini', () =>
            keyed(
                (apiKey) => new GeminiTTSProvider(m, { apiKey }),
                providers['gemini'],
                providers['gemini-tts'],
            ),
        );
        register('xai', () =>
            keyed(
                (apiKey) => new XAITTSProvider(m, { apiKey }),
                providers['xai'],
                providers['xai-tts'],
            ),
        );
        register('speechify', () =>
            keyed(
                (apiKey) => new SpeechifyTTSProvider(m, { apiKey }),
                providers['speechify'],
                providers['speechify-tts'],
            ),
        );
    }
}
