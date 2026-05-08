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

import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterDriver } from '../types.js';
import { loadFileInput } from '../util/fileInput.js';

/**
 * Driver implementing `puter-speech2txt` for the xAI (Grok) STT API.
 *
 * Uses the xAI /v1/stt REST endpoint which accepts multipart/form-data
 * with an audio file and returns a JSON transcript with word-level timestamps.
 *
 * Pricing: $0.10/hr REST = 10 cents/hr = 10 * 1_000_000 / 3600 ≈ 2778 microcents/second
 */

const API_BASE = 'https://api.x.ai/v1';
const MAX_AUDIO_FILE_SIZE = 500 * 1024 * 1024; // 500 MB per xAI docs
// $0.10 per hour = 10 cents per hour = 10 * 1_000_000 microcents per hour
// Per second: 10_000_000 / 3600 ≈ 2778 microcents per second
const UCENTS_PER_SECOND = 2778;

const SAMPLE_TRANSCRIPT = {
    text: 'Hello! This is a sample transcription returned while test mode is enabled.',
    language: 'English',
    duration: 2.0,
    words: [
        { text: 'Hello!', start: 0.0, end: 0.5 },
        { text: 'This', start: 0.6, end: 0.8 },
        { text: 'is', start: 0.8, end: 0.9 },
        { text: 'a', start: 0.9, end: 1.0 },
        { text: 'sample', start: 1.0, end: 1.3 },
        { text: 'transcription.', start: 1.3, end: 2.0 },
    ],
};

interface TranscribeArgs {
    file: unknown;
    language?: string;
    format?: boolean;
    diarize?: boolean;
    multichannel?: boolean;
    channels?: number;
    audio_format?: string;
    sample_rate?: number;
    test_mode?: boolean;
}

export class XAISpeechToTextDriver extends PuterDriver {
    readonly driverInterface = 'puter-speech2txt';
    readonly driverName = 'xai-speech2txt';

    #apiKey: string | null = null;

    override getReportedCosts(): Record<string, unknown>[] {
        return [
            {
                usageType: 'xai:stt:second',
                ucentsPerUnit: UCENTS_PER_SECOND,
                unit: 'second',
                source: 'driver:aiSpeech2Txt/xai',
            },
        ];
    }

    override onServerStart() {
        const providers = (this.config.providers ?? {}) as Record<
            string,
            Record<string, unknown> | undefined
        >;
        const xai = providers['xai'];
        if (!xai) return;
        const key =
            (xai.apiKey as string | undefined) ??
            (xai.secret_key as string | undefined) ??
            (xai.api_key as string | undefined) ??
            (xai.key as string | undefined);
        if (key) this.#apiKey = key;
    }

    async list_models() {
        return [
            {
                id: 'xai-stt',
                name: 'xAI Speech to Text',
                type: 'transcription',
                response_formats: ['json'],
                supports_prompt: false,
                supports_logprobs: false,
                supports_diarization: true,
            },
        ];
    }

    async transcribe(args: TranscribeArgs) {
        return this.#handleTranscription(args);
    }

    async translate(args: TranscribeArgs) {
        // xAI STT doesn't have a separate translation endpoint;
        // delegate to transcribe which auto-detects language
        return this.#handleTranscription(args);
    }

    #isHttpUrl(value: unknown): value is string {
        return (
            typeof value === 'string' &&
            (value.startsWith('https://') || value.startsWith('http://'))
        );
    }

    async #handleTranscription(args: TranscribeArgs) {
        if (args.test_mode) {
            return { ...SAMPLE_TRANSCRIPT, model: 'xai-stt' };
        }

        if (!this.#apiKey) {
            throw new HttpError(500, 'xAI API key not configured', {
                legacyCode: 'internal_error',
            });
        }
        if (!args.file) {
            throw new HttpError(400, '`file` is required', {
                legacyCode: 'bad_request',
            });
        }

        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        // Determine if the input is an HTTP URL or a filesystem/data-URL reference
        const isUrl = this.#isHttpUrl(args.file);

        // For URLs we use xAI's native `url` param — no local fetch needed.
        // For files we load from the Puter FS / data-URL.
        let fileBuffer: Buffer | null = null;
        let filename = 'audio.mp3';
        let mimeType = 'audio/mpeg';

        if (!isUrl) {
            const loaded = await loadFileInput(
                this.stores,
                this.services.fs,
                actor,
                args.file,
                { maxBytes: MAX_AUDIO_FILE_SIZE },
            );
            fileBuffer = loaded.buffer;
            filename = loaded.filename || 'audio.mp3';
            mimeType = loaded.mimeType || 'audio/mpeg';
        }

        // Pre-flight credit check. For URLs we can't know the duration
        // upfront, so use a conservative 60-second estimate; actual usage
        // is metered from the API response duration afterwards.
        const estimatedSeconds = fileBuffer
            ? Math.max(1, Math.ceil(fileBuffer.byteLength / 16000))
            : 60;
        const estimatedCost = UCENTS_PER_SECOND * estimatedSeconds;
        const allowed = await this.services.metering.hasEnoughCredits(
            actor,
            estimatedCost,
        );
        if (!allowed)
            throw new HttpError(402, 'Insufficient credits', {
                legacyCode: 'insufficient_funds',
            });

        // Build multipart form data
        const formData = new FormData();

        if (args.language) formData.append('language', args.language);
        if (args.format !== undefined)
            formData.append('format', String(args.format));
        if (args.diarize) formData.append('diarize', 'true');
        if (args.multichannel) formData.append('multichannel', 'true');
        if (args.channels) formData.append('channels', String(args.channels));
        if (args.audio_format)
            formData.append('audio_format', args.audio_format);
        if (args.sample_rate)
            formData.append('sample_rate', String(args.sample_rate));

        if (isUrl) {
            // Pass URL directly to xAI — it downloads server-side
            formData.append('url', args.file as string);
        } else {
            // File must be the last field per xAI docs
            const blob = new Blob([fileBuffer!], { type: mimeType });
            formData.append('file', blob, filename);
        }

        let response: Response;
        try {
            response = await fetch(`${API_BASE}/stt`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.#apiKey}`,
                },
                body: formData,
            });
        } catch (e: unknown) {
            const msg = (e as Error).message ?? String(e);
            console.error('[XAISpeechToTextDriver] API error:', msg);
            throw new HttpError(502, `xAI STT API error: ${msg}`, {
                legacyCode: 'internal_error',
            });
        }

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error(
                `[XAISpeechToTextDriver] API returned ${response.status}: ${errText}`,
            );
            throw new HttpError(
                502,
                `xAI STT API error (${response.status}): ${errText}`,
                { legacyCode: 'internal_error' },
            );
        }

        const result = await response.json();

        // Meter actual usage using returned duration, or estimated
        const actualSeconds =
            typeof result.duration === 'number'
                ? Math.ceil(result.duration)
                : estimatedSeconds;
        const actualCost = UCENTS_PER_SECOND * actualSeconds;

        this.services.metering.incrementUsage(
            actor,
            'xai:stt:second',
            actualSeconds,
            actualCost,
        );

        return result;
    }
}
