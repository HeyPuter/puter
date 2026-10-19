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

import {
    PollyClient,
    SynthesizeSpeechCommand,
    DescribeVoicesCommand,
    type Engine,
    type LanguageCode,
    type VoiceId,
} from '@aws-sdk/client-polly';
import { HttpError } from '../../../../core/http/HttpError.js';
import { Context } from '../../../../core/context.js';
import type { AiMeteringService } from '../../../util/aiCostFactor.js';
import type { DriverStreamResult } from '../../../meta.js';
import { SAMPLE_AUDIO_URL } from '../../../util/testMode.js';
import type {
    ITTSVoice,
    ITTSEngine,
    ISynthesizeArgs,
    ITTSProvider,
} from '../../types.js';
import { cachedRemoteCatalog } from '../../../ai-chat/utils/cachedRemoteCatalog.js';
import { characterCostReport, meterPerCharacter } from '../common.js';
import { AWS_POLLY_COSTS } from './costs.js';
import {
    fetchPollyPriceList,
    isPollyPriceRegion,
    type PollyRates,
} from './pricing.js';

const VALID_ENGINES = ['standard', 'neural', 'long-form', 'generative'];

// Voices tried, in order, when the caller names none. The head of each list
// is the provider's advertised default.
const PREFERRED_VOICES: Record<string, string[]> = {
    standard: ['Joanna', 'Salli', 'Matthew'],
    neural: ['Joanna', 'Matthew', 'Salli'],
    'long-form': ['Joanna', 'Matthew'],
    generative: ['Joanna', 'Matthew', 'Salli'],
};

interface PollyVoicesResponse {
    Voices: any[];
}

/**
 * AWS Polly TTS provider. Wraps the AWS Polly speech synthesis API and returns
 * audio as a DriverStreamResult. Includes voice caching and engine-aware voice
 * selection.
 */
export class AWSPollyTTSProvider implements ITTSProvider {
    readonly providerName = 'aws-polly';

    private clients: Record<string, PollyClient> = {};
    private voicesCache: { data: PollyVoicesResponse; expires: number } | null =
        null;

    /** The region every synthesis call goes to, and so the one it's priced in. */
    private readonly region: string;

    /** The rates the latest price-list load produced, for the sync cost report. */
    private currentRates: PollyRates = AWS_POLLY_COSTS;

    private readonly rates: () => Promise<PollyRates>;

    constructor(
        private readonly meteringService: AiMeteringService,
        private readonly config: {
            access_key: string;
            secret_key: string;
            region?: string;
        },
    ) {
        this.region = config.region ?? 'us-west-2';
        const region = this.region;
        // Rates the feed omits or can't vouch for keep their last known value.
        this.rates = isPollyPriceRegion(region)
            ? cachedRemoteCatalog<PollyRates>({
                  name: `AWS Polly ${region} price list`,
                  fallback: AWS_POLLY_COSTS,
                  fetch: async (signal, previous) => {
                      this.currentRates = {
                          ...(previous ?? AWS_POLLY_COSTS),
                          ...(await fetchPollyPriceList(region, signal)),
                      };
                      return this.currentRates;
                  },
              })
            : async () => AWS_POLLY_COSTS;
    }

    private getClient(region?: string): PollyClient {
        const cfg = this.config;
        const resolvedRegion = region ?? this.region;

        if (this.clients[resolvedRegion]) {
            return this.clients[resolvedRegion];
        }

        this.clients[resolvedRegion] = new PollyClient({
            credentials: {
                accessKeyId: cfg.access_key,
                secretAccessKey: cfg.secret_key,
            },
            region: resolvedRegion,
        });

        return this.clients[resolvedRegion];
    }

    private async describeVoices(): Promise<PollyVoicesResponse> {
        // Simple in-memory cache with 10-minute TTL
        if (this.voicesCache && Date.now() < this.voicesCache.expires) {
            return this.voicesCache.data;
        }

        const client = this.getClient();
        const command = new DescribeVoicesCommand({});
        const response = await client.send(command);

        this.voicesCache = {
            data: response as PollyVoicesResponse,
            expires: Date.now() + 10 * 60 * 1000,
        };

        return response as PollyVoicesResponse;
    }

    private async getLanguageAppropriateVoice(
        language: string,
        engine: string,
    ): Promise<string | null> {
        const voices = await this.describeVoices();

        const candidates = voices.Voices.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v: any) =>
                v.LanguageCode === language &&
                v.SupportedEngines?.includes(engine),
        );
        if (candidates.length === 0) return null;

        // Keep the engine's default voice when it speaks the requested
        // language, so naming a language doesn't silently change the voice
        // for callers who only wanted the default.
        for (const voiceName of PREFERRED_VOICES[engine] ?? []) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const match = candidates.find((v: any) => v.Id === voiceName);
            if (match) return match.Id;
        }
        return candidates[0].Id;
    }

    private async getDefaultVoiceForEngine(engine: string): Promise<string> {
        const voices = await this.describeVoices();

        const preferred = PREFERRED_VOICES[engine] ?? ['Salli'];

        for (const voiceName of preferred) {
            const voice = voices.Voices.find(
                (v: any) =>
                    v.Id === voiceName && v.SupportedEngines?.includes(engine),
            );
            if (voice) return voice.Id;
        }

        // Fallback: any voice that supports the engine
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fallback = voices.Voices.find((v: any) =>
            v.SupportedEngines?.includes(engine),
        );
        return fallback ? fallback.Id : 'Salli';
    }

    async listVoices(args?: Record<string, unknown>): Promise<ITTSVoice[]> {
        const engine = args?.engine as string | undefined;
        const pollyVoices = await this.describeVoices();

        let voices = pollyVoices.Voices;

        if (engine) {
            if (VALID_ENGINES.includes(engine)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                voices = voices.filter((voice: any) =>
                    voice.SupportedEngines?.includes(engine),
                );
            } else {
                throw new HttpError(
                    400,
                    `Invalid engine: ${engine}. Valid engines: ${VALID_ENGINES.join(', ')}`,
                    {
                        legacyCode: 'invalid_engine',
                        fields: { engine, valid_engines: VALID_ENGINES },
                    },
                );
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return voices.map((voice: any) => ({
            id: voice.Id,
            name: voice.Name,
            language: {
                name: voice.LanguageName,
                code: voice.LanguageCode,
            },
            provider: 'aws-polly',
            supported_engines: voice.SupportedEngines || ['standard'],
        }));
    }

    async listEngines(): Promise<ITTSEngine[]> {
        const rates = await this.rates();
        return VALID_ENGINES.map((engine) => ({
            id: engine,
            name: engine.charAt(0).toUpperCase() + engine.slice(1),
            provider: 'aws-polly',
            pricing_per_million_chars: rates[engine] / 100, // microcents to dollars
        }));
    }

    getReportedCosts(): Record<string, unknown>[] {
        return characterCostReport('aws-polly', this.currentRates);
    }

    async synthesize(
        args: ISynthesizeArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const {
            text,
            voice: voiceArg,
            ssml,
            language,
            engine = 'standard',
            test_mode,
        } = args;

        if (test_mode) {
            return { url: SAMPLE_AUDIO_URL, content_type: 'audio' };
        }

        if (!VALID_ENGINES.includes(engine)) {
            throw new HttpError(
                400,
                `Invalid engine: ${engine}. Valid engines: ${VALID_ENGINES.join(', ')}`,
                {
                    legacyCode: 'invalid_engine',
                    fields: { engine, valid_engines: VALID_ENGINES },
                },
            );
        }

        if (typeof text !== 'string' || text.trim() === '') {
            throw new HttpError(400, 'Missing required field: text', {
                legacyCode: 'field_required',
                fields: { key: 'text' },
            });
        }

        // One rate per request: the hold and the charge both use it even if
        // the price list refreshes mid-synthesis.
        const ucentsPerChar = (await this.rates())[engine];

        return meterPerCharacter(
            this.meteringService,
            Context.get('actor')!,
            `aws-polly:${engine}:character`,
            ucentsPerChar,
            text,
            async () => {
                // Resolve voice
                let voice = voiceArg ?? undefined;

                if (!voice && language) {
                    voice =
                        (await this.getLanguageAppropriateVoice(
                            language,
                            engine,
                        )) ?? undefined;
                }

                if (!voice) {
                    voice = await this.getDefaultVoiceForEngine(engine);
                }

                const client = this.getClient();

                const params = {
                    Engine: engine as Engine,
                    OutputFormat: 'mp3' as const,
                    Text: text,
                    VoiceId: voice as VoiceId,
                    LanguageCode: (language ?? 'en-US') as LanguageCode,
                    TextType: (ssml ? 'ssml' : 'text') as 'ssml' | 'text',
                };

                const command = new SynthesizeSpeechCommand(params);
                const response = await client.send(command);

                return {
                    dataType: 'stream',
                    content_type: 'audio/mpeg',
                    chunked: true,
                    stream: response.AudioStream as unknown as import('node:stream').Readable,
                };
            },
        );
    }
}
