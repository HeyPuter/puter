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

import { Readable } from 'node:stream';
import { HttpError } from '../../../../core/http/HttpError.js';
import { Context } from '../../../../core/context.js';
import type { AiMeteringService } from '../../../util/aiCostFactor.js';
import type { DriverStreamResult } from '../../../meta.js';
import { upstreamFetch } from '../../../util/upstreamErrors.js';
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
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel" sample voice
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

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
        } = {},
    ): Promise<Response> {
        const { method = 'GET', body, headers = {} } = opts;
        return upstreamFetch(
            'ElevenLabs',
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
            { timeoutMs: TTS_UPSTREAM_TIMEOUT_MS },
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

        const voiceId = voiceArg || this.defaultVoiceId;
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

        const payload: Record<string, unknown> = {
            text,
            model_id: modelId,
            output_format:
                output_format || response_format || DEFAULT_OUTPUT_FORMAT,
        };
        const finalVoiceSettings = voice_settings ?? voiceSettings;
        if (finalVoiceSettings) payload.voice_settings = finalVoiceSettings;

        return meterPerCharacter(
            this.meteringService,
            Context.get('actor')!,
            `elevenlabs:${modelId}:character`,
            ELEVENLABS_TTS_COSTS[modelId],
            text,
            async () => {
                const response = await this.request(
                    `/v1/text-to-speech/${voiceId}`,
                    { method: 'POST', body: payload },
                );
                const buffer = Buffer.from(await response.arrayBuffer());
                return {
                    dataType: 'stream',
                    content_type:
                        response.headers.get('content-type') || 'audio/mpeg',
                    chunked: true,
                    stream: Readable.from(buffer),
                };
            },
        );
    }
}
