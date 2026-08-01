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
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../util/aiLimits.js';
import {
    DEFAULT_SPEECH_TO_TEXT_PROVIDER,
    normalizeSpeechToTextProvider,
    SPEECH_TO_TEXT_DRIVER_ALIASES,
    SPEECH_TO_TEXT_PROVIDERS,
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

/** Opt-in value that widens `list_models` out to every provider. */
const ALL_PROVIDERS = 'all';

const isAllProviders = (value: unknown): boolean =>
    typeof value === 'string' && value.trim().toLowerCase() === ALL_PROVIDERS;

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

    #providers: Record<string, ISpeechToTextProvider> = {};

    override onServerStart() {
        this.#registerProviders();
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.values(this.#providers).flatMap((p) =>
            p.getReportedCosts(),
        );
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
        if (isAllProviders(requested)) {
            const all: ISpeechToTextModel[] = [];
            for (const p of Object.values(this.#providers)) {
                all.push(
                    ...(await p.listModels()).map((m) => ({
                        ...m,
                        provider: p.providerName,
                    })),
                );
            }
            return all;
        }

        const p =
            this.#providers[this.#resolveProvider({ provider: requested })];
        if (!p) return [];
        return p.listModels();
    }

    /** List provider names that are currently configured. */
    async list(): Promise<string[]> {
        return Object.keys(this.#providers);
    }

    async transcribe(args: ITranscribeArgs) {
        return this.#provider(args).transcribe(this.#providerArgs(args));
    }

    async translate(args: ITranscribeArgs) {
        return this.#provider(args).translate(this.#providerArgs(args));
    }

    // -- Provider routing --------------------------------------------

    #provider(args: ITranscribeArgs): ISpeechToTextProvider {
        const providerName = this.#resolveProvider(args);
        const provider = this.#providers[providerName];
        if (!provider) {
            throw new HttpError(
                500,
                `Speech-to-text provider not configured: ${providerName}`,
                { legacyCode: 'internal_error' },
            );
        }
        return provider;
    }

    /**
     * Decide which provider handles a call: an explicit `provider` wins, then
     * the legacy driver alias the caller dispatched through, then the default.
     */
    #resolveProvider(args: { provider?: unknown }): string {
        if (
            args.provider !== undefined &&
            args.provider !== null &&
            args.provider !== ''
        ) {
            const named = normalizeSpeechToTextProvider(args.provider);
            if (!named) {
                throw new HttpError(
                    400,
                    `Speech-to-text provider not found: ${String(args.provider)}. Available: ${SPEECH_TO_TEXT_PROVIDERS.join(', ')}`,
                    { legacyCode: 'bad_request' },
                );
            }
            return named;
        }

        return (
            normalizeSpeechToTextProvider(Context.get('driverName')) ??
            this.#defaultProvider()
        );
    }

    /** Providers read their own options; `provider` is the driver's business. */
    #providerArgs(args: ITranscribeArgs): ITranscribeArgs {
        const { provider: _provider, ...rest } = args;
        return rest;
    }

    /**
     * The documented default, falling back to whatever is configured so a
     * deployment without OpenAI credentials still serves transcription.
     */
    #defaultProvider(): string {
        for (const name of [
            DEFAULT_SPEECH_TO_TEXT_PROVIDER,
            ...SPEECH_TO_TEXT_PROVIDERS,
        ]) {
            if (this.#providers[name]) return name;
        }
        return (
            Object.keys(this.#providers)[0] ?? DEFAULT_SPEECH_TO_TEXT_PROVIDER
        );
    }

    // -- Provider registration ---------------------------------------

    // Providers register whether or not credentials are present, so their
    // model catalogues stay listable on a deployment that only configures
    // some of them. A provider without a key rejects at call time.
    #registerProviders() {
        const providers = (this.config.providers ?? {}) as Record<
            string,
            Record<string, unknown> | undefined
        >;
        const deps: ISpeechToTextDeps = {
            stores: this.stores,
            fs: this.services.fs,
            metering: this.services.metering,
        };

        this.#providers['openai'] = new OpenAISpeechToTextProvider(deps, {
            apiKey: readKey(
                providers['openai-speech-to-text'],
                providers['openai-completion'],
                providers['openai'],
            ),
        });

        this.#providers['xai'] = new XAISpeechToTextProvider(deps, {
            apiKey: readKey(providers['xai']),
        });
    }
}

/** First API key found across the config shapes providers are declared with. */
function readKey(
    ...cfgs: Array<Record<string, unknown> | undefined>
): string | undefined {
    for (const cfg of cfgs) {
        if (!cfg) continue;
        const k =
            (cfg.apiKey as string | undefined) ??
            (cfg.secret_key as string | undefined) ??
            (cfg.api_key as string | undefined) ??
            (cfg.key as string | undefined);
        if (k) return k;
    }
    return undefined;
}
