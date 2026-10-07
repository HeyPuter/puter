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
import { insufficientCreditsError } from '../../../../services/metering/enforcement.js';
import { loadFileInput } from '../../../util/fileInput.js';
import { SPEECH_TO_TEXT_COSTS } from '../../costs.js';
import type {
    ISpeechToTextDeps,
    ISpeechToTextModel,
    ITranscribeArgs,
} from '../../types.js';
import { SpeechToTextProvider } from '../SpeechToTextProvider.js';

/**
 * Wraps OpenAI's audio transcription API. No current OpenAI model serves
 * `/audio/translations`, so translate() rejects.
 *
 * `file` may be a path, uid/uuid ref, or data URL.
 */

const DEFAULT_TRANSCRIBE_MODEL = 'gpt-transcribe';
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
}

const MODEL_CAPS: Record<string, ModelCapabilities> = {
    'gpt-transcribe': {
        canPrompt: true,
        canLogprobs: true,
        responseFormats: ['json', 'text'],
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
            type: 'transcription',
            response_formats: caps.responseFormats,
            supports_prompt: caps.canPrompt,
            supports_logprobs: caps.canLogprobs,
        }));
    }

    async translate(_args: ITranscribeArgs): Promise<never> {
        throw new HttpError(
            400,
            'Translation is not supported by any current OpenAI model',
            { legacyCode: 'bad_request' },
        );
    }

    async transcribe(args: ITranscribeArgs) {
        if (args.test_mode) {
            return {
                ...SAMPLE_TRANSCRIPT,
                model: args.model || DEFAULT_TRANSCRIBE_MODEL,
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

        const selectedModel = args.model || DEFAULT_TRANSCRIBE_MODEL;
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
        const hold = await this.deps.metering.reserveAiCredits(
            actor,
            usageType,
            estimatedCost,
        );
        if (!hold) throw insufficientCreditsError();

        try {
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
            // The API ignores a bare `logprobs` flag; it only honors `include`.
            if (args.logprobs && caps.canLogprobs)
                payload.include = ['logprobs'];
            if (args.extra_body) payload.extra_body = args.extra_body;

            const result = await this.#openai.audio.transcriptions.create(
                payload as unknown as Parameters<
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
        } finally {
            await hold.release();
        }
    }
}
