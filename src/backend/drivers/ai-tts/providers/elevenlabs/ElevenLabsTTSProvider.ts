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

import { HttpError } from '../../../../core/http/HttpError.js';
import { Context } from '../../../../core/context.js';
import type { AiMeteringService } from '../../../util/aiCostFactor.js';
import type { DriverStreamResult } from '../../../meta.js';
import {
    upstreamBodyStream,
    upstreamFetch,
} from '../../../util/upstreamErrors.js';
import { SAMPLE_AUDIO_URL } from '../../../util/testMode.js';
import type {
    ITTSVoice,
    ITTSEngine,
    ISynthesizeArgs,
    ITTSProvider,
} from '../../types.js';
import {
    characterCostReport,
    meterPerCharacter,
    TTS_UPSTREAM_TIMEOUT_MS,
} from '../common.js';
import { ELEVENLABS_TTS_COSTS } from './costs.js';

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const VOICES_TTL_MS = 10 * 60 * 1000;
// ElevenLabs voice IDs are 20 alphanumeric characters.
const VOICE_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
const VOICE_SEARCH_MAX_PAGES = 5;
// https://elevenlabs.io/docs/api-reference/text-to-speech/convert
// mp3_44100_192 needs the Creator tier; pcm/wav at 44.1 kHz need Pro.
const OUTPUT_FORMATS = new Set([
    'alaw_8000',
    'mp3_22050_32',
    'mp3_24000_48',
    'mp3_44100_32',
    'mp3_44100_64',
    'mp3_44100_96',
    'mp3_44100_128',
    'mp3_44100_192',
    'opus_48000_32',
    'opus_48000_64',
    'opus_48000_96',
    'opus_48000_128',
    'opus_48000_192',
    'pcm_8000',
    'pcm_16000',
    'pcm_22050',
    'pcm_24000',
    'pcm_32000',
    'pcm_44100',
    'pcm_48000',
    'ulaw_8000',
    'wav_8000',
    'wav_16000',
    'wav_22050',
    'wav_24000',
    'wav_32000',
    'wav_44100',
    'wav_48000',
]);
// OpenAI-style `response_format` names. ElevenLabs ignored the body field
// these used to travel in, so callers passing them always got MP3; map them to
// the closest native format instead of letting the vendor reject them.
const OUTPUT_FORMAT_SHORTHANDS: Record<string, string> = {
    mp3: DEFAULT_OUTPUT_FORMAT,
    opus: 'opus_48000_128',
    pcm: 'pcm_24000',
    wav: 'wav_24000',
};

const ELEVENLABS_TTS_MODELS = [
    { id: DEFAULT_MODEL, name: 'Eleven Multilingual v2' },
    { id: 'eleven_v4', name: 'Eleven v4' },
    { id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo' },
    { id: 'eleven_v3', name: 'Eleven v3' },
    { id: 'eleven_v3_conversational', name: 'Eleven v3 Conversational' },
    { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5' },
    { id: 'eleven_flash_v2', name: 'Eleven Flash v2' },
];

/**
 * ElevenLabs TTS provider. Uses the ElevenLabs REST API to synthesize speech
 * and returns audio as a DriverStreamResult.
 */
export class ElevenLabsTTSProvider implements ITTSProvider {
    readonly providerName = 'elevenlabs';

    private apiKey: string;
    private baseUrl: string;
    private defaultVoiceId: string;
    private voicesCache: {
        voices: Promise<ITTSVoice[]>;
        expires: number;
    } | null = null;

    constructor(
        private readonly meteringService: AiMeteringService,
        config: {
            apiKey: string;
            apiBaseUrl?: string;
            defaultVoiceId?: string;
        },
    ) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.apiBaseUrl ?? 'https://api.elevenlabs.io';
        this.defaultVoiceId = config.defaultVoiceId ?? DEFAULT_VOICE_ID;
    }

    private request(
        path: string,
        opts: {
            method?: string;
            body?: unknown;
            headers?: Record<string, string>;
            stream?: boolean;
        } = {},
    ): Promise<Response> {
        const { method = 'GET', body, headers = {}, stream } = opts;
        return upstreamFetch(
            'elevenlabs',
            `${this.baseUrl}${path}`,
            {
                method,
                headers: {
                    'xi-api-key': this.apiKey,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...headers,
                },
                body: body ? JSON.stringify(body) : undefined,
            },
            {
                providerLabel: 'ElevenLabs',
                timeoutMs: TTS_UPSTREAM_TIMEOUT_MS,
                stream,
            },
        );
    }

    /**
     * The account's voices, cached for {@link VOICES_TTL_MS} so voice listings
     * don't call ElevenLabs on every request. A failed fetch isn't cached.
     */
    async listVoices(): Promise<ITTSVoice[]> {
        const cached = this.voicesCache;
        if (cached && Date.now() < cached.expires) return cached.voices;
        const voices = this.fetchVoices();
        this.voicesCache = { voices, expires: Date.now() + VOICES_TTL_MS };
        try {
            return await voices;
        } catch (e) {
            if (this.voicesCache?.voices === voices) this.voicesCache = null;
            throw e;
        }
    }

    private async fetchVoices(): Promise<ITTSVoice[]> {
        const res = await this.request('/v1/voices');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await res.json();
        const voices = Array.isArray(data?.voices)
            ? data.voices
            : Array.isArray(data)
              ? data
              : [];

        return (
            voices
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((voice: any) => ({
                    id: voice.voice_id || voice.voiceId || voice.id,
                    name: voice.name,
                    description: voice.description,
                    category: voice.category,
                    provider: 'elevenlabs' as const,
                    labels: voice.labels,
                    supported_models: ELEVENLABS_TTS_MODELS.map((m) => m.id),
                }))
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .filter((v: any) => v.id && v.name)
        );
    }

    private async resolveVoiceId(voice: string): Promise<string> {
        // Voice IDs go straight to synthesis: the account's library listing
        // omits voices that still synthesize (the default voice among them)
        // and runs to megabytes, so it can't gate IDs.
        if (VOICE_ID_PATTERN.test(voice)) return voice;

        const voices = await this.searchVoices(voice);
        const byId = voices.find((entry) => entry.voice_id === voice);
        if (byId) return byId.voice_id;

        // Exact full names first; premade voices are named "Bella - Professional,
        // Bright, Warm", so their short name before " - " also resolves. Library
        // voices don't get the short form: "Rachel" would land on whichever
        // community voice happens to share it.
        let matches = voices.filter((entry) => entry.name === voice);
        if (matches.length === 0) {
            matches = voices.filter(
                (entry) =>
                    entry.category === 'premade' &&
                    entry.name.split(' - ')[0].trim() === voice,
            );
        }
        if (matches.length === 1) return matches[0].voice_id;

        throw new HttpError(
            400,
            matches.length > 1
                ? 'Ambiguous ElevenLabs voice name. Use a voice ID from listVoices.'
                : 'Unknown ElevenLabs voice. Use a voice ID or exact name from listVoices.',
            { legacyCode: 'field_invalid', fields: { key: 'voice' } },
        );
    }

    private async searchVoices(
        search: string,
    ): Promise<{ voice_id: string; name: string; category?: string }[]> {
        const voices: { voice_id: string; name: string; category?: string }[] =
            [];
        let pageToken: string | undefined;
        for (let page = 0; page < VOICE_SEARCH_MAX_PAGES; page++) {
            const params = new URLSearchParams({
                search,
                page_size: '100',
                include_total_count: 'false',
            });
            if (pageToken) params.set('next_page_token', pageToken);
            const res = await this.request(`/v2/voices?${params}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data: any = await res.json();
            for (const entry of Array.isArray(data?.voices)
                ? data.voices
                : []) {
                if (
                    typeof entry?.voice_id === 'string' &&
                    typeof entry?.name === 'string'
                ) {
                    voices.push(entry);
                }
            }
            if (!data?.has_more || typeof data?.next_page_token !== 'string')
                break;
            pageToken = data.next_page_token;
        }
        return voices;
    }

    async listEngines(): Promise<ITTSEngine[]> {
        return ELEVENLABS_TTS_MODELS.map((model) => ({
            id: model.id,
            name: model.name,
            provider: 'elevenlabs',
            pricing_per_million_chars: ELEVENLABS_TTS_COSTS[model.id] / 100, // Convert microcents per character to dollars per million characters.
        }));
    }

    getReportedCosts(): Record<string, unknown>[] {
        return characterCostReport('elevenlabs', ELEVENLABS_TTS_COSTS);
    }

    async synthesize(
        args: ISynthesizeArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const {
            text,
            voice: voiceArg,
            model: modelArg,
            response_format,
            output_format,
            voice_settings,
            voiceSettings,
            test_mode,
        } = args;

        if (test_mode) {
            return { url: SAMPLE_AUDIO_URL, content_type: 'audio' };
        }

        if (typeof text !== 'string' || !text.trim()) {
            throw new HttpError(400, 'Missing required field: text', {
                legacyCode: 'field_required',
                fields: { key: 'text' },
            });
        }

        const modelId = modelArg || DEFAULT_MODEL;

        // Gate on the cost table rather than the advertised model list: an id
        // we can't price is an id we can't bill for, and the vendor bills us
        // for it either way.
        if (!Object.hasOwn(ELEVENLABS_TTS_COSTS, modelId)) {
            const expected = Object.keys(ELEVENLABS_TTS_COSTS);
            throw new HttpError(
                400,
                `Invalid model: ${modelId}. Expected: ${expected.join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: { key: 'model', expected, got: modelId },
                },
            );
        }

        const requestedFormat =
            output_format || response_format || DEFAULT_OUTPUT_FORMAT;
        const desiredFormat = Object.hasOwn(
            OUTPUT_FORMAT_SHORTHANDS,
            requestedFormat,
        )
            ? OUTPUT_FORMAT_SHORTHANDS[requestedFormat]
            : requestedFormat;
        if (!OUTPUT_FORMATS.has(desiredFormat)) {
            const expected = [...OUTPUT_FORMATS];
            throw new HttpError(
                400,
                `Invalid output_format: ${requestedFormat}. Expected: ${expected.join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: output_format
                            ? 'output_format'
                            : 'response_format',
                        expected,
                        got: requestedFormat,
                    },
                },
            );
        }

        const payload: Record<string, unknown> = {
            text,
            model_id: modelId,
        };
        const finalVoiceSettings = voice_settings ?? voiceSettings;
        if (finalVoiceSettings) payload.voice_settings = finalVoiceSettings;
        const searchParams = new URLSearchParams({
            output_format: desiredFormat,
        });

        return meterPerCharacter(
            this.meteringService,
            Context.get('actor')!,
            `elevenlabs:${modelId}:character`,
            ELEVENLABS_TTS_COSTS[modelId],
            text,
            async () => {
                const voiceId = voiceArg
                    ? await this.resolveVoiceId(voiceArg)
                    : this.defaultVoiceId;
                const response = await this.request(
                    `/v1/text-to-speech/${encodeURIComponent(voiceId)}?${searchParams}`,
                    { method: 'POST', body: payload, stream: true },
                );
                return {
                    dataType: 'stream',
                    content_type:
                        response.headers.get('content-type') || 'audio/mpeg',
                    chunked: true,
                    stream: upstreamBodyStream(response),
                };
            },
        );
    }
}
