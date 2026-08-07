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
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { DriverStreamResult } from '../../../meta.js';
import type { ITTSVoice, ITTSEngine, ISynthesizeArgs } from '../../types.js';
import { TTSProvider } from '../TTSProvider.js';
import { SPEECHIFY_TTS_COSTS } from './costs.js';

// Public API base only — never an internal/consumer Speechify endpoint.
const API_BASE = 'https://api.speechify.ai';
const CALLER_HEADER = 'Speechify-Caller';
const CALLER_VALUE = 'puter';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';

const DEFAULT_MODEL = 'simba-3.2';
const DEFAULT_VOICE = 'geffen_32';

const SPEECHIFY_TTS_MODELS = [
    { id: 'simba-3.2', name: 'Simba 3.2' },
    { id: 'simba-english', name: 'Simba English' },
    { id: 'simba-multilingual', name: 'Simba Multilingual' },
];

// Representative starter catalog — verify against Speechify's live
// voices endpoint before this ships upstream.
const SPEECHIFY_TTS_VOICES = [
    { id: 'geffen_32', name: 'Geffen', description: 'Warm, conversational' },
    { id: 'dominic_32', name: 'Dominic', description: 'Deep, narrator' },
    { id: 'harper_32', name: 'Harper', description: 'Bright, upbeat' },
    { id: 'hugh_32', name: 'Hugh', description: 'Calm, professional' },
    { id: 'imogen_32', name: 'Imogen', description: 'Clear, neutral' },
];

const CONTENT_TYPES: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    aac: 'audio/aac',
};

/**
 * Speechify TTS provider. Calls the Speechify `/v1/audio/speech` REST endpoint
 * and returns audio as a DriverStreamResult. Every outbound request carries
 * `Speechify-Caller: puter` for integration attribution.
 */
export class SpeechifyTTSProvider extends TTSProvider {
    readonly providerName = 'speechify';

    #apiKey: string;

    constructor(meteringService: MeteringService, config: { apiKey: string }) {
        super(meteringService, config);
        if (!config.apiKey) {
            throw new Error('Speechify TTS requires an API key');
        }
        this.#apiKey = config.apiKey;
    }

    async listVoices(): Promise<ITTSVoice[]> {
        return SPEECHIFY_TTS_VOICES.map((voice) => ({
            id: voice.id,
            name: voice.name,
            description: voice.description,
            provider: 'speechify',
            supported_models: SPEECHIFY_TTS_MODELS.map((m) => m.id),
        }));
    }

    async listEngines(): Promise<ITTSEngine[]> {
        return SPEECHIFY_TTS_MODELS.map((model) => ({
            id: model.id,
            name: model.name,
            provider: 'speechify',
        }));
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(SPEECHIFY_TTS_COSTS).map(
            ([model, ucentsPerUnit]) => ({
                usageType: `speechify:${model}:character`,
                ucentsPerUnit,
                unit: 'character',
                source: 'driver:aiTts/speechify',
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

        const model = modelArg || DEFAULT_MODEL;
        if (!SPEECHIFY_TTS_MODELS.find(({ id }) => id === model)) {
            throw new HttpError(
                400,
                `Invalid model: ${model}. Expected: ${SPEECHIFY_TTS_MODELS.map(({ id }) => id).join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'model',
                        expected: SPEECHIFY_TTS_MODELS.map(({ id }) => id).join(
                            ', ',
                        ),
                        got: model,
                    },
                },
            );
        }

        const voice = voiceArg || DEFAULT_VOICE;
        const format = output_format || response_format || 'mp3';

        const actor = Context.get('actor')!;
        const usageType = `speechify:${model}:character`;
        const ucentsPerChar = SPEECHIFY_TTS_COSTS[model] ?? 0;
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

        // Speechify's synthesis endpoint expects SSML; wrap plain text so
        // callers can keep passing bare strings like every other provider.
        const input = /<speak[\s>]/i.test(text)
            ? text
            : `<speak>${text}</speak>`;

        const response = await fetch(`${API_BASE}/v1/audio/speech`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.#apiKey}`,
                'Content-Type': 'application/json',
                [CALLER_HEADER]: CALLER_VALUE,
            },
            body: JSON.stringify({
                input,
                voice_id: voice,
                model,
                audio_format: format,
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error(
                `[SpeechifyTTSProvider] API returned ${response.status}: ${errText}`,
            );
            // Map upstream status to an `upstream_*` HttpError so the
            // alarm gate skips it. Mirrors ElevenLabs/xAI's translator —
            // 4xx and 5xx both surface as 400 to the client (with the
            // appropriate legacyCode), 429 stays 429, auth stays 500.
            const legacyCode =
                response.status >= 500
                    ? 'upstream_provider_unavailable'
                    : response.status === 401 || response.status === 403
                      ? 'upstream_auth_failed'
                      : response.status === 429
                        ? 'upstream_rate_limited'
                        : 'upstream_bad_request';
            const exposedStatus =
                legacyCode === 'upstream_rate_limited'
                    ? 429
                    : legacyCode === 'upstream_auth_failed'
                      ? 500
                      : 400;
            throw new HttpError(
                exposedStatus,
                errText ||
                    `Speechify TTS request failed (status ${response.status})`,
                {
                    legacyCode,
                    fields: {
                        provider: 'speechify',
                        upstreamStatus: response.status,
                    },
                },
            );
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await response.json();
        if (!data?.audio_data) {
            throw new HttpError(
                400,
                'Speechify TTS did not return audio data',
                {
                    legacyCode: 'upstream_bad_request',
                    fields: { provider: 'speechify' },
                },
            );
        }

        const buffer = Buffer.from(data.audio_data, 'base64');
        const stream = Readable.from(buffer);
        const contentType =
            CONTENT_TYPES[data.audio_format ?? format] || 'audio/mpeg';

        this.meteringService.incrementUsage(
            actor,
            usageType,
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
