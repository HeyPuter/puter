import { HttpError } from '../../core/http/HttpError.js';
import { Context } from '../../core/context.js';
import { PuterDriver } from '../types.js';
import type { DriverStreamResult } from '../DriverRegistry.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import type { ITTSProvider, ITTSVoice, ITTSEngine, ISynthesizeArgs } from './types.js';
import { OpenAITTSProvider } from './providers/openai/OpenAITTSProvider.js';
import { ElevenLabsTTSProvider } from './providers/elevenlabs/ElevenLabsTTSProvider.js';
import { AWSPollyTTSProvider } from './providers/awsPolly/AWSPollyTTSProvider.js';

/**
 * Driver implementing the `puter-tts` interface.
 *
 * Manages multiple upstream TTS providers (OpenAI, ElevenLabs, AWS Polly)
 * and handles provider routing, voice/engine aggregation, and speech
 * synthesis. Each provider is an `ITTSProvider` instantiated from config
 * on boot.
 */
export class TTSDriver extends PuterDriver {
    readonly driverInterface = 'puter-tts';
    readonly driverName = 'ai-tts';
    readonly isDefault = true;

    #providers: Record<string, ITTSProvider> = {};

    private get metering (): MeteringService {
        return this.services.metering as unknown as MeteringService;
    }

    override onServerStart () {
        this.#registerProviders();
    }

    // ── Interface methods ───────────────────────────────────────────

    /**
     * List all available voices across all configured providers.
     */
    async list_voices (args?: Record<string, unknown>): Promise<ITTSVoice[]> {
        const provider = args?.provider as string | undefined;

        if ( provider ) {
            const p = this.#providers[provider];
            if ( ! p ) return [];
            return p.listVoices(args);
        }

        const allVoices: ITTSVoice[] = [];
        for ( const p of Object.values(this.#providers) ) {
            const voices = await p.listVoices(args);
            allVoices.push(...voices);
        }
        return allVoices;
    }

    /**
     * List all available engines/models across all configured providers.
     */
    async list_engines (args?: Record<string, unknown>): Promise<ITTSEngine[]> {
        const provider = args?.provider as string | undefined;

        if ( provider ) {
            const p = this.#providers[provider];
            if ( ! p ) return [];
            return p.listEngines();
        }

        const allEngines: ITTSEngine[] = [];
        for ( const p of Object.values(this.#providers) ) {
            const engines = await p.listEngines();
            allEngines.push(...engines);
        }
        return allEngines;
    }

    /**
     * List provider names that are currently configured.
     */
    async list (): Promise<string[]> {
        return Object.keys(this.#providers);
    }

    /**
     * Synthesize speech from text. Routes to the appropriate provider
     * based on the `provider` argument, or falls back to the first
     * available provider.
     */
    async synthesize (args: ISynthesizeArgs): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const actor = Context.get('actor');
        if ( ! actor ) throw new HttpError(401, 'Authentication required');

        const providerName = args.provider || this.#getDefaultProviderName();
        if ( ! providerName ) {
            throw new HttpError(500, 'No TTS providers configured');
        }

        const provider = this.#providers[providerName];
        if ( ! provider ) {
            throw new HttpError(400, `TTS provider not found: ${providerName}. Available: ${Object.keys(this.#providers).join(', ')}`);
        }

        return provider.synthesize(args) as Promise<DriverStreamResult | { url: string; content_type: string }>;
    }

    // ── Provider registration ───────────────────────────────────────

    #registerProviders () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfg = this.config as any;
        const providers = cfg?.providers ?? cfg?.services ?? {};
        const m = this.metering;

        // OpenAI
        const openAiConfig = providers['openai'] ?? cfg?.openai;
        if ( openAiConfig?.apiKey || openAiConfig?.secret_key ) {
            try {
                this.#providers['openai'] = new OpenAITTSProvider(m, openAiConfig);
            } catch (e) {
                console.warn('[TTSDriver] Failed to init OpenAI TTS provider:', (e as Error).message);
            }
        }

        // ElevenLabs
        const elevenLabsConfig = providers['elevenlabs'] ?? cfg?.elevenlabs;
        if ( elevenLabsConfig?.apiKey || elevenLabsConfig?.api_key || elevenLabsConfig?.key ) {
            try {
                this.#providers['elevenlabs'] = new ElevenLabsTTSProvider(m, elevenLabsConfig);
            } catch (e) {
                console.warn('[TTSDriver] Failed to init ElevenLabs TTS provider:', (e as Error).message);
            }
        }

        // AWS Polly
        const awsConfig = providers['aws-polly'] ?? cfg?.aws ? { aws: cfg.aws } : undefined;
        if ( awsConfig?.aws?.access_key && awsConfig?.aws?.secret_key ) {
            try {
                this.#providers['aws-polly'] = new AWSPollyTTSProvider(m, awsConfig);
            } catch (e) {
                console.warn('[TTSDriver] Failed to init AWS Polly TTS provider:', (e as Error).message);
            }
        }
    }

    #getDefaultProviderName (): string | null {
        const names = Object.keys(this.#providers);
        if ( names.length === 0 ) return null;
        // Prefer openai, then elevenlabs, then aws-polly
        if ( this.#providers['openai'] ) return 'openai';
        if ( this.#providers['elevenlabs'] ) return 'elevenlabs';
        return names[0];
    }
}
