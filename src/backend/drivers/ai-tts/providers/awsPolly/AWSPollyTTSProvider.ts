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
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { DriverStreamResult } from '../../../meta.js';
import type { ITTSVoice, ITTSEngine, ISynthesizeArgs } from '../../types.js';
import { TTSProvider } from '../TTSProvider.js';

const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';

const ENGINE_PRICING: Record<string, number> = {
    standard: 400, // $4.00 per 1M characters
    neural: 1600, // $16.00 per 1M characters
    'long-form': 10000, // $100.00 per 1M characters
    generative: 3000, // $30.00 per 1M characters
};

const VALID_ENGINES = ['standard', 'neural', 'long-form', 'generative'];

interface PollyVoicesResponse {
    Voices: any[];
}

/**
 * AWS Polly TTS provider. Wraps the AWS Polly speech synthesis API and
 * returns audio as a DriverStreamResult. Includes voice caching and
 * engine-aware voice selection.
 */
export class AWSPollyTTSProvider extends TTSProvider {
    readonly providerName = 'aws-polly';

    private clients: Record<string, PollyClient> = {};
    private voicesCache: { data: PollyVoicesResponse; expires: number } | null =
        null;

    constructor(
        meteringService: MeteringService,
        config: {
            access_key: string;
            secret_key: string;
            region?: string;
        },
    ) {
        super(meteringService, config);
    }

    private getClient(region?: string): PollyClient {
        const cfg = this.providerConfig as {
            access_key: string;
            secret_key: string;
            region?: string;
        };
        const resolvedRegion = region ?? cfg.region ?? 'us-west-2';

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

        const voice = voices.Voices.find(
            (v: any) =>
                v.LanguageCode === language &&
                v.SupportedEngines?.includes(engine),
        );
        return voice ? voice.Id : null;
    }

    private async getDefaultVoiceForEngine(engine: string): Promise<string> {
        const voices = await this.describeVoices();

        const defaultVoices: Record<string, string[]> = {
            standard: ['Salli', 'Joanna', 'Matthew'],
            neural: ['Joanna', 'Matthew', 'Salli'],
            'long-form': ['Joanna', 'Matthew'],
            generative: ['Joanna', 'Matthew', 'Salli'],
        };

        const preferred = defaultVoices[engine] || ['Salli'];

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
        return VALID_ENGINES.map((engine) => ({
            id: engine,
            name: engine.charAt(0).toUpperCase() + engine.slice(1),
            provider: 'aws-polly',
            pricing_per_million_chars: ENGINE_PRICING[engine] / 100, // microcents to dollars
        }));
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

        const actor = Context.get('actor')!;
        const usageType = `aws-polly:${engine}:character`;

        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(
            actor,
            usageType as any,
            text.length,
        );
        if (!usageAllowed) {
            throw new HttpError(402, 'Insufficient funds', {
                legacyCode: 'insufficient_funds',
            });
        }

        // Resolve voice
        let voice = voiceArg ?? undefined;

        if (!voice && language) {
            voice =
                (await this.getLanguageAppropriateVoice(language, engine)) ??
                undefined;
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

        this.meteringService.incrementUsage(actor, usageType, text.length);

        return {
            dataType: 'stream',
            content_type: 'audio/mpeg',
            chunked: true,
            stream: response.AudioStream as unknown as import('node:stream').Readable,
        };
    }
}
