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

import { Readable } from 'node:stream';
import { HttpError } from '../../../../core/http/HttpError.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { DriverStreamResult } from '../../../meta.js';
import type { ITTSVoice, ITTSEngine, ISynthesizeArgs } from '../../types.js';
import { TTSProvider } from '../TTSProvider.js';
import { ELEVENLABS_TTS_COSTS } from './costs.js';

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel" sample voice
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';

const ELEVENLABS_TTS_MODELS = [
    { id: DEFAULT_MODEL, name: 'Eleven Multilingual v2' },
    { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5' },
    { id: 'eleven_turbo_v2_5', name: 'Eleven Turbo v2.5' },
    { id: 'eleven_v3', name: 'Eleven v3 Alpha' },
];

/**
 * ElevenLabs TTS provider. Uses the ElevenLabs REST API to synthesize
 * speech and returns audio as a DriverStreamResult.
 */
export class ElevenLabsTTSProvider extends TTSProvider {
    readonly providerName = 'elevenlabs';

    private apiKey: string;
    private baseUrl: string;
    private defaultVoiceId: string;

    constructor(
        meteringService: MeteringService,
        config: {
            apiKey: string;
            apiBaseUrl?: string;
            defaultVoiceId?: string;
        },
    ) {
        super(meteringService, config);

        this.apiKey = config.apiKey;
        this.baseUrl = config.apiBaseUrl ?? 'https://api.elevenlabs.io';
        this.defaultVoiceId = config.defaultVoiceId ?? DEFAULT_VOICE_ID;
    }

    private async request(
        path: string,
        opts: {
            method?: string;
            body?: unknown;
            headers?: Record<string, string>;
        } = {},
    ): Promise<Response> {
        const { method = 'GET', body, headers = {} } = opts;

        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                'xi-api-key': this.apiKey,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (response.ok) {
            return response;
        }

        let detail: unknown = null;
        try {
            detail = await response.json();
        } catch {
            // ignore
        }

        console.error('[ElevenLabsTTSProvider] request failed', {
            path,
            status: response.status,
            detail,
        });
        throw new HttpError(
            502,
            `ElevenLabs request failed (status ${response.status})`,
            {
                legacyCode: 'internal_error',
                fields: { provider: 'elevenlabs', status: response.status },
            },
        );
    }

    async listVoices(): Promise<ITTSVoice[]> {
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

    async listEngines(): Promise<ITTSEngine[]> {
        return ELEVENLABS_TTS_MODELS.map((model) => ({
            id: model.id,
            name: model.name,
            provider: 'elevenlabs',
            pricing_per_million_chars: 0,
        }));
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(ELEVENLABS_TTS_COSTS).map(
            ([model, ucentsPerUnit]) => ({
                usageType: `elevenlabs:${model}:character`,
                ucentsPerUnit,
                unit: 'character',
                source: 'driver:aiTts/elevenlabs',
            }),
        );
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

        const voiceId = voiceArg || this.defaultVoiceId;
        const modelId = modelArg || DEFAULT_MODEL;
        const desiredFormat =
            output_format || response_format || DEFAULT_OUTPUT_FORMAT;

        const actor = Context.get('actor')!;
        const usageKey = `elevenlabs:${modelId}:character`;
        const ucentsPerChar = ELEVENLABS_TTS_COSTS[modelId] ?? 0;
        const totalCost = ucentsPerChar * text.length;

        const usageAllowed = await this.meteringService.hasEnoughCredits(
            actor,
            totalCost,
        );
        if (!usageAllowed) {
            throw new HttpError(402, 'Insufficient funds', {
                legacyCode: 'insufficient_funds',
            });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = {
            text,
            model_id: modelId,
            output_format: desiredFormat,
        };

        const finalVoiceSettings = voice_settings ?? voiceSettings;
        if (finalVoiceSettings) {
            payload.voice_settings = finalVoiceSettings;
        }

        const response = await this.request(`/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            body: payload,
        });

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const stream = Readable.from(buffer);

        this.meteringService.incrementUsage(
            actor,
            usageKey,
            text.length,
            totalCost,
        );

        const contentType =
            response.headers.get('content-type') || 'audio/mpeg';

        return {
            dataType: 'stream',
            content_type: contentType,
            chunked: true,
            stream,
        };
    }
}
