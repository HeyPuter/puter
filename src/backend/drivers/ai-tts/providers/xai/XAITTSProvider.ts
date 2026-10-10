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
import { XAI_TTS_COSTS } from './costs.js';

const API_BASE = 'https://api.x.ai/v1';

const XAI_TTS_VOICES = [
    { id: 'eve', name: 'Eve', description: 'Energetic, upbeat' },
    { id: 'ara', name: 'Ara', description: 'Warm, friendly' },
    { id: 'rex', name: 'Rex', description: 'Confident, clear' },
    { id: 'sal', name: 'Sal', description: 'Smooth, balanced' },
    { id: 'leo', name: 'Leo', description: 'Authoritative, strong' },
];

const DEFAULT_VOICE = 'eve';

const CODEC_CONTENT_TYPES: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    pcm: 'audio/pcm',
    mulaw: 'audio/basic',
    alaw: 'audio/alaw',
};

/**
 * XAI (Grok) TTS provider. Calls the xAI /v1/tts REST endpoint. Returns audio
 * as a DriverStreamResult.
 */
export class XAITTSProvider implements ITTSProvider {
    readonly providerName = 'xai';

    #apiKey: string;

    constructor(
        private readonly meteringService: AiMeteringService,
        config: { apiKey: string },
    ) {
        if (!config.apiKey) {
            throw new Error('xAI TTS requires an API key');
        }
        this.#apiKey = config.apiKey;
    }

    async listVoices(): Promise<ITTSVoice[]> {
        return XAI_TTS_VOICES.map((voice) => ({
            id: voice.id,
            name: voice.name,
            description: voice.description,
            provider: 'xai',
        }));
    }

    async listEngines(): Promise<ITTSEngine[]> {
        return [
            {
                id: 'xai-tts',
                name: 'xAI TTS',
                provider: 'xai',
                pricing_per_million_chars: 1500,
            },
        ];
    }

    getReportedCosts(): Record<string, unknown>[] {
        return characterCostReport('xai', XAI_TTS_COSTS);
    }

    async synthesize(
        args: ISynthesizeArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const {
            text,
            voice: voiceArg,
            language,
            response_format,
            output_format,
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

        if (text.length > 15000) {
            throw new HttpError(
                400,
                'Text exceeds maximum length of 15,000 characters',
                { legacyCode: 'bad_request' },
            );
        }

        const body: Record<string, unknown> = {
            text,
            voice_id: voiceArg || DEFAULT_VOICE,
            language: language || 'en',
        };
        const formatStr = output_format || response_format;
        const codec = typeof formatStr === 'string' ? formatStr : 'mp3';
        if (formatStr) body.output_format = { codec };

        return meterPerCharacter(
            this.meteringService,
            Context.get('actor')!,
            'xai:xai-tts:character',
            XAI_TTS_COSTS['xai-tts'] ?? 0,
            text,
            async () => {
                const response = await upstreamFetch(
                    'xAI TTS',
                    `${API_BASE}/tts`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${this.#apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(body),
                    },
                    { timeoutMs: TTS_UPSTREAM_TIMEOUT_MS },
                );
                const buffer = Buffer.from(await response.arrayBuffer());
                return {
                    dataType: 'stream',
                    content_type:
                        CODEC_CONTENT_TYPES[codec] ||
                        response.headers.get('content-type') ||
                        'audio/mpeg',
                    chunked: true,
                    stream: Readable.from(buffer),
                };
            },
        );
    }
}
