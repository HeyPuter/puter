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
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { DriverStreamResult } from '../meta.js';
import { PuterDriver } from '../types.js';
import { loadFileInput } from '../util/fileInput.js';
import { VOICE_CHANGER_COSTS } from './costs.js';

/**
 * Driver implementing `puter-speech2speech` — voice changer. Currently a
 * single provider (ElevenLabs).
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

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(VOICE_CHANGER_COSTS).map(
            ([usageType, ucentsPerUnit]) => ({
                usageType,
                ucentsPerUnit,
                unit: 'second',
                source: 'driver:aiSpeech2Speech',
            }),
        );
    }

    #apiKey: string | null = null;
    #baseUrl = 'https://api.elevenlabs.io';
    #defaultVoiceId = DEFAULT_VOICE_ID;
    #defaultModelId = DEFAULT_MODEL;

    override onServerStart() {
        const elevenlabs = this.config.providers?.elevenlabs as
            | Record<string, unknown>
            | undefined;

        this.#apiKey =
            (elevenlabs?.apiKey as string | undefined) ??
            (elevenlabs?.api_key as string | undefined) ??
            (elevenlabs?.key as string | undefined) ??
            null;
        this.#baseUrl =
            (elevenlabs?.apiBaseUrl as string | undefined) ?? this.#baseUrl;
        this.#defaultVoiceId =
            (elevenlabs?.defaultVoiceId as string | undefined) ??
            DEFAULT_VOICE_ID;
        this.#defaultModelId =
            (elevenlabs?.speechToSpeechModelId as string | undefined) ??
            DEFAULT_MODEL;
    }

    async convert(
        args: ConvertArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        if (args.test_mode) {
            return { url: SAMPLE_AUDIO_URL, content_type: 'audio/mpeg' };
        }

        if (!this.#apiKey) {
            throw new HttpError(500, 'ElevenLabs API key not configured', {
                legacyCode: 'internal_error',
            });
        }

        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        if (!args.audio) {
            throw new HttpError(400, '`audio` is required', {
                legacyCode: 'bad_request',
            });
        }

        const loaded = await loadFileInput(
            this.stores,
            this.services.fs,
            actor,
            args.audio,
            { maxBytes: MAX_AUDIO_FILE_SIZE },
        );

        const modelId = args.model_id || args.model || this.#defaultModelId;
        const voiceId =
            args.voice_id || args.voiceId || args.voice || this.#defaultVoiceId;
        if (!voiceId)
            throw new HttpError(400, '`voice` is required', {
                legacyCode: 'bad_request',
            });

        // Metering: estimate duration from file size if we don't parse metadata.
        // 16 kbit/s is a safe lower bound for speech audio; pre-check credits
        // before we hit the ElevenLabs API. Post-usage we increment by the same
        // estimate — duration parsing is deferred to v2.1 if needed.
        const estimatedSeconds = Math.max(
            1,
            Math.ceil(loaded.buffer.byteLength / 16000),
        );
        const usageKey = `elevenlabs:${modelId}:second`;
        const ucentsPerSecond = VOICE_CHANGER_COSTS[usageKey] ?? 0;
        const estimatedCost = ucentsPerSecond * estimatedSeconds;

        const hasCredits = await this.services.metering.hasEnoughCredits(
            actor,
            estimatedCost,
        );
        if (!hasCredits) {
            throw new HttpError(402, 'Insufficient credits', {
                legacyCode: 'insufficient_funds',
            });
        }

        const formData = new FormData();
        const blob = new Blob([loaded.buffer], {
            type: loaded.mimeType ?? 'application/octet-stream',
        });
        formData.append('audio', blob, loaded.filename);
        formData.append('model_id', modelId);

        const settings = args.voice_settings ?? args.voiceSettings;
        if (settings !== undefined && settings !== null) {
            formData.append(
                'voice_settings',
                typeof settings === 'string'
                    ? settings
                    : JSON.stringify(settings),
            );
        }
        if (args.seed !== undefined && args.seed !== null) {
            formData.append('seed', String(args.seed));
        }
        if (typeof args.remove_background_noise === 'boolean') {
            formData.append(
                'remove_background_noise',
                String(args.remove_background_noise),
            );
        }
        if (args.file_format) {
            formData.append('file_format', args.file_format);
        }

        const searchParams = new URLSearchParams();
        const outputFormat = args.output_format || DEFAULT_OUTPUT_FORMAT;
        if (outputFormat) searchParams.set('output_format', outputFormat);
        if (
            args.optimize_streaming_latency !== undefined &&
            args.optimize_streaming_latency !== null
        ) {
            searchParams.set(
                'optimize_streaming_latency',
                String(args.optimize_streaming_latency),
            );
        }
        if (args.enable_logging !== undefined && args.enable_logging !== null) {
            searchParams.set('enable_logging', String(args.enable_logging));
        }

        const url = new URL(`/v1/speech-to-speech/${voiceId}`, this.#baseUrl);
        const search = searchParams.toString();
        if (search) url.search = search;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'xi-api-key': this.#apiKey },
            body: formData,
        });

        if (!response.ok) {
            let detail: unknown = null;
            try {
                detail = await response.json();
            } catch {
                // Non-JSON body — ignore.
            }
            const message =
                detail && typeof detail === 'object' && 'detail' in detail
                    ? String((detail as { detail: unknown }).detail)
                    : `ElevenLabs returned ${response.status}`;
            throw new HttpError(response.status, message, {
                legacyCode: 'internal_error',
            });
        }

        const arrayBuffer = await response.arrayBuffer();
        const stream = Readable.from(Buffer.from(arrayBuffer));
        this.services.metering.incrementUsage(
            actor,
            usageKey,
            estimatedSeconds,
            ucentsPerSecond * estimatedSeconds,
        );

        return {
            dataType: 'stream',
            content_type: response.headers.get('content-type') ?? 'audio/mpeg',
            stream,
        };
    }
}
