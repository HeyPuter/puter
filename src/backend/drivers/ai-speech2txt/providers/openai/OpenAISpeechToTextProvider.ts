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

import OpenAI, { toFile } from 'openai';
import { HttpError } from '../../../../core/http/HttpError.js';
import { loadFileInput } from '../../../util/fileInput.js';
import { SPEECH_TO_TEXT_COSTS } from '../../costs.js';
import type {
    ISpeechToTextDeps,
    ISpeechToTextModel,
    ITranscribeArgs,
} from '../../types.js';
import { SpeechToTextProvider } from '../SpeechToTextProvider.js';

/**
 * Wraps OpenAI's audio API (Whisper + GPT-4o transcribe models) for
 * transcription and translation.
 *
 * `file` may be a path, uid/uuid ref, or data URL.
 */

const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_TRANSLATE_MODEL = 'whisper-1';
const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024;

const SAMPLE_TRANSCRIPT = {
    text: 'Hello! This is a sample transcription returned while test mode is enabled.',
    language: 'en',
    duration_seconds: 2,
    words: [
        { start: 0.0, end: 0.5, text: 'Hello' },
        { start: 1.1, end: 2.0, text: 'This is a sample transcription.' },
    ],
};

interface ModelCapabilities {
    canPrompt: boolean;
    canLogprobs: boolean;
    responseFormats: string[];
    timestampGranularities?: boolean;
    diarization?: boolean;
    requiresChunkingOverThirtySeconds?: boolean;
}

const MODEL_CAPS: Record<string, ModelCapabilities> = {
    'gpt-4o-mini-transcribe': {
        canPrompt: true,
        canLogprobs: true,
        responseFormats: ['json', 'text'],
    },
    'gpt-4o-transcribe': {
        canPrompt: true,
        canLogprobs: true,
        responseFormats: ['json', 'text'],
    },
    'gpt-4o-transcribe-diarize': {
        canPrompt: false,
        canLogprobs: false,
        responseFormats: ['json', 'text', 'diarized_json'],
        diarization: true,
        requiresChunkingOverThirtySeconds: true,
    },
    'whisper-1': {
        canPrompt: true,
        canLogprobs: false,
        responseFormats: ['json', 'text', 'srt', 'verbose_json', 'vtt'],
        timestampGranularities: true,
    },
};

export class OpenAISpeechToTextProvider extends SpeechToTextProvider {
    readonly providerName = 'openai';

    // Null when the deployment has no OpenAI credentials. The provider still
    // registers so its model catalogue stays listable; transcription rejects.
    #openai: OpenAI | null;

    constructor(deps: ISpeechToTextDeps, config: { apiKey?: string }) {
        super(deps);
        this.#openai = config.apiKey
            ? new OpenAI({ apiKey: config.apiKey })
            : null;
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(SPEECH_TO_TEXT_COSTS).map(
            ([usageType, ucentsPerUnit]) => ({
                usageType,
                ucentsPerUnit,
                unit: 'second',
                source: 'driver:aiSpeech2Txt',
            }),
        );
    }

    async listModels(): Promise<ISpeechToTextModel[]> {
        return Object.entries(MODEL_CAPS).map(([id, caps]) => ({
            id,
            name: id,
            type: caps.diarization
                ? 'transcription'
                : id === 'whisper-1'
                  ? 'translation'
                  : 'transcription',
            response_formats: caps.responseFormats,
            supports_prompt: caps.canPrompt,
            supports_logprobs: caps.canLogprobs,
            ...(caps.diarization ? { supports_diarization: true } : {}),
            ...(caps.timestampGranularities
                ? { supports_timestamp_granularities: true }
                : {}),
        }));
    }

    async transcribe(args: ITranscribeArgs) {
        return this.#handleTranscription(args, false);
    }

    async translate(args: ITranscribeArgs) {
        return this.#handleTranscription(args, true);
    }

    async #handleTranscription(args: ITranscribeArgs, translate: boolean) {
        if (args.test_mode) {
            return {
                ...SAMPLE_TRANSCRIPT,
                model:
                    args.model ||
                    (translate
                        ? DEFAULT_TRANSLATE_MODEL
                        : DEFAULT_TRANSCRIBE_MODEL),
            };
        }
        if (args.stream) {
            throw new HttpError(
                400,
                'Streaming transcription is not yet supported',
                { legacyCode: 'bad_request' },
            );
        }
        if (!this.#openai)
            throw new HttpError(500, 'OpenAI API key not configured', {
                legacyCode: 'internal_error',
            });
        this.requireFile(args);

        const actor = this.requireActor();

        const loaded = await loadFileInput(
            this.deps.stores,
            this.deps.fs,
            actor,
            args.file,
            { maxBytes: MAX_AUDIO_FILE_SIZE, acceptWebInput: true },
        );

        const selectedModel =
            args.model ||
            (translate ? DEFAULT_TRANSLATE_MODEL : DEFAULT_TRANSCRIBE_MODEL);
        const caps = MODEL_CAPS[selectedModel];
        if (!caps) {
            throw new HttpError(400, `Unsupported model: ${selectedModel}`, {
                legacyCode: 'bad_request',
            });
        }

        if (
            args.response_format &&
            !caps.responseFormats.includes(args.response_format)
        ) {
            throw new HttpError(
                400,
                `response_format must be one of: ${caps.responseFormats.join(', ')}`,
                { legacyCode: 'bad_request' },
            );
        }
        if (args.prompt && !caps.canPrompt) {
            throw new HttpError(
                400,
                `prompt is not supported for model ${selectedModel}`,
                { legacyCode: 'bad_request' },
            );
        }
        if (args.logprobs && !caps.canLogprobs) {
            throw new HttpError(
                400,
                `logprobs is not supported for model ${selectedModel}`,
                { legacyCode: 'bad_request' },
            );
        }

        // Estimate seconds from raw bytes — 16 kbps is a conservative speech-audio
        // lower bound. Full metadata parsing (music-metadata) is deferred — clients
        // aren't observably sensitive to billing-time delta vs real duration.
        const estimatedSeconds = Math.max(
            1,
            Math.ceil(loaded.buffer.byteLength / 16000),
        );
        const usageType = `openai:${selectedModel}:second`;
        const ucentsPerSecond = SPEECH_TO_TEXT_COSTS[usageType] ?? 0;
        const estimatedCost = ucentsPerSecond * estimatedSeconds;
        const allowed = await this.deps.metering.hasEnoughCredits(
            actor,
            estimatedCost,
        );
        if (!allowed)
            throw new HttpError(402, 'Insufficient credits', {
                legacyCode: 'insufficient_funds',
            });

        const openaiFile = await toFile(
            loaded.buffer,
            loaded.filename,
            loaded.mimeType ? { type: loaded.mimeType } : undefined,
        );

        const payload: Record<string, unknown> = {
            file: openaiFile,
            model: selectedModel,
        };
        if (args.response_format)
            payload.response_format = args.response_format;
        if (args.language) payload.language = args.language;
        if (typeof args.temperature === 'number')
            payload.temperature = args.temperature;
        if (args.prompt && caps.canPrompt) payload.prompt = args.prompt;
        if (args.logprobs && caps.canLogprobs) payload.logprobs = args.logprobs;
        if (args.timestamp_granularities && caps.timestampGranularities) {
            payload.timestamp_granularities = args.timestamp_granularities;
        }
        if (caps.diarization) {
            if (!args.response_format)
                payload.response_format = 'diarized_json';
            const needsChunking =
                caps.requiresChunkingOverThirtySeconds && estimatedSeconds > 30;
            const strategy =
                args.chunking_strategy ?? (needsChunking ? 'auto' : undefined);
            if (strategy) payload.chunking_strategy = strategy;

            if (args.known_speaker_names || args.known_speaker_references) {
                payload.extra_body = {
                    ...(args.extra_body ?? {}),
                    ...(args.known_speaker_names
                        ? { known_speaker_names: args.known_speaker_names }
                        : {}),
                    ...(args.known_speaker_references
                        ? {
                              known_speaker_references:
                                  args.known_speaker_references,
                          }
                        : {}),
                };
            }
        } else if (args.extra_body) {
            payload.extra_body = args.extra_body;
        }

        const result = translate
            ? await this.#openai.audio.translations.create(
                  payload as Parameters<
                      OpenAI['audio']['translations']['create']
                  >[0],
              )
            : await this.#openai.audio.transcriptions.create(
                  payload as Parameters<
                      OpenAI['audio']['transcriptions']['create']
                  >[0],
              );

        this.deps.metering.incrementUsage(
            actor,
            usageType,
            estimatedSeconds,
            ucentsPerSecond * estimatedSeconds,
        );

        // Text response_format: return raw string; otherwise forward the OpenAI object.
        if (args.response_format === 'text') {
            return typeof result === 'string'
                ? result
                : ((result as { text?: string }).text ?? '');
        }
        return result;
    }
}
