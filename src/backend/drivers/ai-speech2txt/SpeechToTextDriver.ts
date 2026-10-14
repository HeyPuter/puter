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
import { PuterDriver } from '../types.js';
import {
    type AiMeteringService,
    withAiCostFactor,
} from '../util/aiCostFactor.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import { ProviderRegistry, readProviderKey } from '../util/providerRegistry.js';
import {
    SPEECH_TO_TEXT_CATALOG,
    SPEECH_TO_TEXT_DRIVER_ALIASES,
} from './providerAliases.js';
import { OpenAISpeechToTextProvider } from './providers/openai/OpenAISpeechToTextProvider.js';
import { XAISpeechToTextProvider } from './providers/xai/XAISpeechToTextProvider.js';
import type {
    ISpeechToTextDeps,
    ISpeechToTextModel,
    ISpeechToTextProvider,
    ITranscribeArgs,
} from './types.js';

/**
 * Driver implementing the `puter-speech2txt` interface.
 *
 * Manages the upstream transcription providers and routes each call to the one
 * the caller named. Each provider is an `ISpeechToTextProvider` instantiated
 * from config on boot.
 */
export class SpeechToTextDriver extends PuterDriver {
    readonly driverInterface = 'puter-speech2txt';
    readonly driverName = 'ai-speech2txt';
    // Older SDK bundles name the provider in the driver slot instead of
    // passing `{ provider }`; `#resolveProvider` reads the requested alias
    // back off the Context.
    readonly driverAliases = [...SPEECH_TO_TEXT_DRIVER_ALIASES];
    readonly isDefault = true;

    // Shared AI policy — see `drivers/util/aiLimits.ts` for the tier table.
    // One bucket covers every provider, keyed by interface+method+user.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    #providers = new ProviderRegistry<ISpeechToTextProvider>(
        SPEECH_TO_TEXT_CATALOG,
    );

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

    override getReportedCosts(): Record<string, unknown>[] {
        return this.#providers
            .names()
            .flatMap((name) => this.#providers.get(name)!.getReportedCosts());
    }

    // -- Interface methods -------------------------------------------

    /**
     * List available models. Defaults to the default provider; pass `provider:
     * 'all'` to aggregate across every configured provider.
     */
    async list_models(
        args?: Record<string, unknown>,
    ): Promise<ISpeechToTextModel[]> {
        const requested = args?.provider;
        if (ProviderRegistry.isAll(requested)) {
            return this.#providers.collect(async (p, provider) =>
                (await p.listModels()).map((m) => ({ ...m, provider })),
            );
        }
        const p = this.#providers.get(
            this.#providers.resolve(requested, Context.get('driverName')),
        );
        return p ? p.listModels() : [];
    }

    /** List provider names that are currently configured. */
    async list(): Promise<string[]> {
        return this.#providers.names();
    }

    async transcribe(args: ITranscribeArgs) {
        return this.#provider(args).transcribe(this.#providerArgs(args));
    }

    async translate(args: ITranscribeArgs) {
        return this.#provider(args).translate(this.#providerArgs(args));
    }

    // -- Provider routing --------------------------------------------

    /**
     * The provider a call names, then the legacy driver alias the caller
     * dispatched through, then the default.
     */
    #provider(args: ITranscribeArgs): ISpeechToTextProvider {
        const providerName = this.#providers.resolve(
            args.provider,
            Context.get('driverName'),
        );
        const provider = this.#providers.get(providerName);
        if (!provider) {
            throw new HttpError(
                500,
                `Speech-to-text provider not configured: ${providerName}`,
                { legacyCode: 'internal_error' },
            );
        }
        return provider;
    }

    /** Providers read their own options; `provider` is the driver's business. */
    #providerArgs(args: ITranscribeArgs): ITranscribeArgs {
        const { provider: _provider, ...rest } = args;
        return rest;
    }

    // -- Provider registration ---------------------------------------

    // Providers register whether or not credentials are present, so their
    // model catalogues stay listable on a deployment that only configures
    // some of them. A provider without a key rejects at call time.
    #registerProviders() {
        const providers = this.config.providers ?? {};
        const deps: ISpeechToTextDeps = {
            stores: this.stores,
            fs: this.services.fs,
            metering: this.#aiMetering,
        };

        this.#providers.register(
            'openai',
            new OpenAISpeechToTextProvider(deps, {
                apiKey: readProviderKey(
                    providers['openai-speech-to-text'],
                    providers['openai-completion'],
                    providers['openai'],
                ),
            }),
        );
        this.#providers.register(
            'xai',
            new XAISpeechToTextProvider(deps, {
                apiKey: readProviderKey(providers['xai']),
            }),
        );
    }
}
