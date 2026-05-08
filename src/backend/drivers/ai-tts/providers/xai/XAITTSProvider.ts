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
import { XAI_TTS_COSTS } from './costs.js';

const API_BASE = 'https://api.x.ai/v1';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';

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
 * xAI (Grok) TTS provider. Calls the xAI /v1/tts REST endpoint.
 * Returns audio as a DriverStreamResult.
 */
export class XAITTSProvider extends TTSProvider {
    readonly providerName = 'xai';

    #apiKey: string;

    constructor(meteringService: MeteringService, config: { apiKey: string }) {
        super(meteringService, config);
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
                pricing_per_million_chars: 420,
            },
        ];
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(XAI_TTS_COSTS).map(([model, ucentsPerUnit]) => ({
            usageType: `xai:${model}:character`,
            ucentsPerUnit,
            unit: 'character',
            source: 'driver:aiTts/xai',
        }));
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

        const voice = voiceArg || DEFAULT_VOICE;

        const actor = Context.get('actor')!;
        const ucentsPerChar = XAI_TTS_COSTS['xai-tts'] ?? 0;
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

        // Build request body
        const body: Record<string, unknown> = {
            text,
            voice_id: voice,
            language: language || 'en',
        };

        // Handle output format
        const formatStr = output_format || response_format;
        if (formatStr) {
            const codec = typeof formatStr === 'string' ? formatStr : 'mp3';
            body.output_format = { codec };
        }

        let response: Response;
        try {
            response = await fetch(`${API_BASE}/tts`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.#apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
        } catch (e: unknown) {
            const msg = (e as Error).message ?? String(e);
            console.error('[XAITTSProvider] API error:', msg);
            throw new HttpError(502, `xAI TTS API error: ${msg}`, {
                legacyCode: 'internal_error',
                fields: { provider: 'xai' },
            });
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error(
                `[XAITTSProvider] API returned ${response.status}: ${errText}`,
            );
            throw new HttpError(
                502,
                `xAI TTS API error (${response.status}): ${errText}`,
                { legacyCode: 'internal_error', fields: { provider: 'xai' } },
            );
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const stream = Readable.from(buffer);

        // Determine content type from response or codec
        const respContentType =
            response.headers.get('content-type') || 'audio/mpeg';
        const codec =
            (body.output_format as { codec?: string } | undefined)?.codec ??
            'mp3';
        const contentType = CODEC_CONTENT_TYPES[codec] || respContentType;

        // Meter usage
        this.meteringService.incrementUsage(
            actor,
            'xai:xai-tts:character',
            text.length,
            totalCost,
        );

        return {
            dataType: 'stream',
            content_type: contentType,
            chunked: true,
            stream,
        };
    }
}
