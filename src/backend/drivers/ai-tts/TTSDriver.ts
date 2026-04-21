import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { DriverStreamResult } from '../meta.js';
import { PuterDriver } from '../types.js';
import { AWSPollyTTSProvider } from './providers/awsPolly/AWSPollyTTSProvider.js';
import { ElevenLabsTTSProvider } from './providers/elevenlabs/ElevenLabsTTSProvider.js';
import { OpenAITTSProvider } from './providers/openai/OpenAITTSProvider.js';
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
const TTS_ALIASES = ['aws-polly', 'openai-tts', 'elevenlabs-tts'] as const;
type TTSAlias = (typeof TTS_ALIASES)[number];
const ALIAS_TO_PROVIDER: Record<TTSAlias, string> = {
    'aws-polly': 'aws-polly',
    'openai-tts': 'openai',
    'elevenlabs-tts': 'elevenlabs',
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

        const openai = providers['openai'];
        if (openai?.apiKey) {
            try {
                this.#providers['openai'] = new OpenAITTSProvider(m, {
                    apiKey: openai.apiKey,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init OpenAI TTS provider:',
                    (e as Error).message,
                );
            }
        }

        const elevenlabs = providers['elevenlabs'];
        if (elevenlabs?.apiKey) {
            try {
                this.#providers['elevenlabs'] = new ElevenLabsTTSProvider(m, {
                    apiKey: elevenlabs.apiKey,
                    apiBaseUrl: elevenlabs.apiBaseUrl,
                    defaultVoiceId: elevenlabs.defaultVoiceId,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init ElevenLabs TTS provider:',
                    (e as Error).message,
                );
            }
        }

        // AWS Polly is configured under `providers['aws-polly']` with flat
        // `access_key`/`secret_key`/`region` fields (no `aws:` wrapper).
        const polly = providers['aws-polly'];
        if (polly?.access_key && polly?.secret_key) {
            try {
                this.#providers['aws-polly'] = new AWSPollyTTSProvider(m, {
                    access_key: polly.access_key as string,
                    secret_key: polly.secret_key as string,
                    region: polly.region as string | undefined,
                });
            } catch (e) {
                console.warn(
                    '[TTSDriver] Failed to init AWS Polly TTS provider:',
                    (e as Error).message,
                );
            }
        }
    }

    #getDefaultProviderName(): string | null {
        const names = Object.keys(this.#providers);
        if (names.length === 0) return null;
        // Prefer openai, then elevenlabs, then aws-polly
        if (this.#providers['openai']) return 'openai';
        if (this.#providers['elevenlabs']) return 'elevenlabs';
        return names[0];
    }
}
