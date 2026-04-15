import { Readable } from 'node:stream';
import { HttpError } from '../../core/http/HttpError.js';
import { Context } from '../../core/context.js';
import { PuterDriver } from '../types.js';
import type { DriverStreamResult } from '../meta.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';
import type { FSEntryService } from '../../services/fs/FSEntryService.js';
import { loadFileInput } from '../util/fileInput.js';

/**
 * Driver implementing `puter-speech2speech` — voice changer. Currently a
 * single provider (ElevenLabs). Request contract mirrors v1 so existing
 * puter-js clients work unchanged.
 */

const DEFAULT_MODEL = 'eleven_multilingual_sts_v2';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';
const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024;

interface ConvertArgs {
    audio: unknown;
    voice?: string;
    voice_id?: string;
    voiceId?: string;
    model?: string;
    model_id?: string;
    voice_settings?: unknown;
    voiceSettings?: unknown;
    seed?: number;
    remove_background_noise?: boolean;
    output_format?: string;
    file_format?: string;
    optimize_streaming_latency?: number;
    enable_logging?: boolean;
    test_mode?: boolean;
}

export class VoiceChangerDriver extends PuterDriver {
    readonly driverInterface = 'puter-speech2speech';
    readonly driverName = 'elevenlabs-voice-changer';
    readonly isDefault = true;

    #apiKey: string | null = null;
    #baseUrl = 'https://api.elevenlabs.io';
    #defaultVoiceId = DEFAULT_VOICE_ID;
    #defaultModelId = DEFAULT_MODEL;

    override onServerStart () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfg = this.config as any;
        const svcConfig = cfg?.services?.elevenlabs ?? cfg?.elevenlabs;

        this.#apiKey = svcConfig?.apiKey ?? svcConfig?.api_key ?? svcConfig?.key ?? null;
        this.#baseUrl = svcConfig?.baseUrl ?? this.#baseUrl;
        this.#defaultVoiceId = svcConfig?.defaultVoiceId ?? svcConfig?.voiceId ?? DEFAULT_VOICE_ID;
        this.#defaultModelId = svcConfig?.speechToSpeechModelId ?? svcConfig?.stsModelId ?? DEFAULT_MODEL;
    }

    async convert (args: ConvertArgs): Promise<DriverStreamResult | { url: string; content_type: string }> {
        if ( args.test_mode ) {
            return { url: SAMPLE_AUDIO_URL, content_type: 'audio/mpeg' };
        }

        if ( ! this.#apiKey ) {
            throw new HttpError(500, 'ElevenLabs API key not configured');
        }

        const actor = Context.get('actor');
        if ( ! actor ) throw new HttpError(401, 'Authentication required');

        if ( ! args.audio ) {
            throw new HttpError(400, '`audio` is required');
        }

        const userId = Number((actor as { user?: { id?: unknown } }).user?.id ?? NaN);
        if ( Number.isNaN(userId) ) throw new HttpError(401, 'Unauthorized');

        const loaded = await loadFileInput(this.stores, userId, args.audio, {
            maxBytes: MAX_AUDIO_FILE_SIZE,
        });

        const modelId = args.model_id || args.model || this.#defaultModelId;
        const voiceId = args.voice_id || args.voiceId || args.voice || this.#defaultVoiceId;
        if ( ! voiceId ) throw new HttpError(400, '`voice` is required');

        // Metering: estimate duration from file size if we don't parse metadata.
        // 16 kbit/s is a safe lower bound for speech audio; pre-check credits
        // before we hit the ElevenLabs API. Post-usage we increment by the same
        // estimate — duration parsing is deferred to v2.1 if needed.
        const estimatedSeconds = Math.max(1, Math.ceil(loaded.buffer.byteLength / 16000));
        const usageKey = `elevenlabs:${modelId}:second`;

        const hasCredits = await this.services.metering.hasEnoughCreditsFor(actor, usageKey, estimatedSeconds);
        if ( ! hasCredits ) {
            throw new HttpError(402, 'Insufficient credits');
        }

        const formData = new FormData();
        const blob = new Blob([loaded.buffer], { type: loaded.mimeType ?? 'application/octet-stream' });
        formData.append('audio', blob, loaded.filename);
        formData.append('model_id', modelId);

        const settings = args.voice_settings ?? args.voiceSettings;
        if ( settings !== undefined && settings !== null ) {
            formData.append('voice_settings', typeof settings === 'string' ? settings : JSON.stringify(settings));
        }
        if ( args.seed !== undefined && args.seed !== null ) {
            formData.append('seed', String(args.seed));
        }
        if ( typeof args.remove_background_noise === 'boolean' ) {
            formData.append('remove_background_noise', String(args.remove_background_noise));
        }
        if ( args.file_format ) {
            formData.append('file_format', args.file_format);
        }

        const searchParams = new URLSearchParams();
        const outputFormat = args.output_format || DEFAULT_OUTPUT_FORMAT;
        if ( outputFormat ) searchParams.set('output_format', outputFormat);
        if ( args.optimize_streaming_latency !== undefined && args.optimize_streaming_latency !== null ) {
            searchParams.set('optimize_streaming_latency', String(args.optimize_streaming_latency));
        }
        if ( args.enable_logging !== undefined && args.enable_logging !== null ) {
            searchParams.set('enable_logging', String(args.enable_logging));
        }

        const url = new URL(`/v1/speech-to-speech/${voiceId}`, this.#baseUrl);
        const search = searchParams.toString();
        if ( search ) url.search = search;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'xi-api-key': this.#apiKey },
            body: formData,
        });

        if ( ! response.ok ) {
            let detail: unknown = null;
            try {
                detail = await response.json();
            } catch {
                // Non-JSON body — ignore.
            }
            const message = (detail && typeof detail === 'object' && 'detail' in detail)
                ? String((detail as { detail: unknown }).detail)
                : `ElevenLabs returned ${response.status}`;
            throw new HttpError(response.status, message);
        }

        const arrayBuffer = await response.arrayBuffer();
        const stream = Readable.from(Buffer.from(arrayBuffer));
        this.services.metering.incrementUsage(actor, usageKey, estimatedSeconds);

        return {
            dataType: 'stream',
            content_type: response.headers.get('content-type') ?? 'audio/mpeg',
            stream,
        };
    }
}
