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

import type { Actor } from '../../../../../core/actor.js';
import { HttpError } from '../../../../../core/http/HttpError.js';
import type { DriverStreamResult } from '../../../../meta.js';
import { loadFileInput } from '../../../../util/fileInput.js';
import {
    upstreamBodyStream,
    upstreamFetch,
} from '../../../../util/upstreamErrors.js';
import type { ConvertArgs } from '../../../interfaces/speechToSpeech/types.js';
import { type AiMeteringService } from '../../../../../util/aiCostFactor.js';
import { withStreamedAiCharge } from '../../../shared/streamedAiCharge.js';
import { DEFAULT_OUTPUT_FORMAT } from '../outputFormats.js';
import { VOICE_CHANGER_COSTS } from './costs.js';
import { measuredOutput, outputBytesPerSecond } from './measuredOutput.js';

const DEFAULT_MODEL = 'eleven_multilingual_sts_v2';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024;
// Covers the upload as well as the conversion.
const CONVERT_TIMEOUT_MS = 10 * 60 * 1000;

const SUPPORTED_MODELS = Object.keys(VOICE_CHANGER_COSTS).map(
    (key) => key.split(':')[1]!,
);

/** ElevenLabs voice changer: converts input audio to another voice. */
export class ElevenLabsSpeechToSpeechProvider {
    readonly #apiKey: string;
    readonly #baseUrl: string;
    readonly #defaultVoiceId: string;
    readonly #defaultModelId: string;

    constructor(
        private readonly deps: {
            stores: Parameters<typeof loadFileInput>[0];
            fs: Parameters<typeof loadFileInput>[1];
            metering: AiMeteringService;
        },
        config: {
            apiKey: string;
            apiBaseUrl?: string;
            defaultVoiceId?: string;
            defaultModelId?: string;
        },
    ) {
        this.#apiKey = config.apiKey;
        this.#baseUrl = config.apiBaseUrl ?? 'https://api.elevenlabs.io';
        this.#defaultVoiceId = config.defaultVoiceId ?? DEFAULT_VOICE_ID;
        this.#defaultModelId = config.defaultModelId ?? DEFAULT_MODEL;
    }

    async convert(
        args: ConvertArgs,
        actor: Actor,
    ): Promise<DriverStreamResult> {
        if (!args.audio) {
            throw new HttpError(400, '`audio` is required', {
                legacyCode: 'bad_request',
            });
        }

        // The format picks how the converted audio is timed for billing.
        if (args.output_format && typeof args.output_format !== 'string') {
            throw new HttpError(400, '`output_format` must be a string', {
                legacyCode: 'bad_request',
            });
        }

        const modelId = args.model_id || args.model || this.#defaultModelId;
        const voiceId =
            args.voice_id || args.voiceId || args.voice || this.#defaultVoiceId;
        if (!voiceId)
            throw new HttpError(400, '`voice` is required', {
                legacyCode: 'bad_request',
            });
        // `voiceId` lands in the request URL path, which carries our API key,
        // so anything outside ElevenLabs' `[A-Za-z0-9_-]+` id shape could
        // steer the request at a different endpoint.
        if (!/^[A-Za-z0-9_-]+$/.test(voiceId))
            throw new HttpError(400, '`voice` must be alphanumeric', {
                legacyCode: 'bad_request',
            });

        // Gate on the cost table: an id we can't price is one we can't bill
        // for, and ElevenLabs bills us for it either way. This also keeps
        // anything but a known id out of the multipart `model_id` field.
        const usageKey = `elevenlabs:${modelId}:second`;
        if (!Object.hasOwn(VOICE_CHANGER_COSTS, usageKey)) {
            throw new HttpError(
                400,
                `Invalid model: ${modelId}. Expected: ${SUPPORTED_MODELS.join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'model',
                        expected: SUPPORTED_MODELS,
                        got: modelId,
                    },
                },
            );
        }
        const ucentsPerSecond = VOICE_CHANGER_COSTS[usageKey]!;

        const loaded = await loadFileInput(
            this.deps.stores,
            this.deps.fs,
            actor,
            args.audio,
            { maxBytes: MAX_AUDIO_FILE_SIZE, acceptWebInput: true },
        );

        // The hold estimates seconds from the input at 128 kbps: compact audio
        // is under-held rather than refused. Usage is metered from the length
        // of the audio that comes back.
        const estimatedSeconds = Math.max(
            1,
            Math.ceil(loaded.buffer.byteLength / 16000),
        );
        const estimatedCost = ucentsPerSecond * estimatedSeconds;

        const formData = new FormData();
        const blob = new Blob([loaded.buffer as BlobPart], {
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

        const { metering } = this.deps;
        const output = measuredOutput(
            outputBytesPerSecond(outputFormat),
            outputFormat,
        );
        return withStreamedAiCharge(
            metering,
            actor,
            usageKey,
            estimatedCost,
            async (): Promise<DriverStreamResult> => {
                const response = await upstreamFetch(
                    'elevenlabs',
                    url,
                    {
                        method: 'POST',
                        headers: { 'xi-api-key': this.#apiKey },
                        body: formData,
                    },
                    {
                        providerLabel: 'ElevenLabs',
                        timeoutMs: CONVERT_TIMEOUT_MS,
                        stream: true,
                    },
                );
                return {
                    dataType: 'stream',
                    content_type:
                        response.headers.get('content-type') ?? 'audio/mpeg',
                    stream: output.measure(upstreamBodyStream(response)),
                };
            },
            async () => {
                const measured = await output.seconds;
                // A stream cut short was still converted in full upstream.
                const seconds =
                    measured.complete && measured.seconds
                        ? measured.seconds
                        : Math.max(measured.seconds ?? 0, estimatedSeconds);
                return metering.incrementUsage(
                    actor,
                    usageKey,
                    seconds,
                    ucentsPerSecond * seconds,
                );
            },
        );
    }
}
