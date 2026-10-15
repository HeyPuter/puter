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

import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import { insufficientCreditsError } from '../../../../services/metering/enforcement.js';
import type { UsageInput } from '../../../../services/metering/types.js';
import { loadFileInput } from '../../../util/fileInput.js';
import {
    geminiUpstreamFailure,
    postGeminiJson,
    usesGoogleGeminiEndpoint,
} from '../../../util/geminiRest.js';
import type {
    ISpeechToTextDeps,
    ISpeechToTextModel,
    ITranscribeArgs,
} from '../../types.js';
import { SpeechToTextProvider } from '../SpeechToTextProvider.js';
import { GEMINI_SPEECH_TO_TEXT_COSTS } from './costs.js';

const MODEL = 'gemini-3.5-transcribe';

/** Decoded audio; its inline base64 keeps the request under Gemini's 20 MB. */
export const GEMINI_STT_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const GEMINI_STT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Covers the upload, the transcription and reading the reply. */
export const GEMINI_STT_TIMEOUT_MS = 10 * 60 * 1000;
export const GEMINI_STT_MAX_OUTPUT_TOKENS = 8192;
export const GEMINI_COUNT_TOKENS_MAX_RESPONSE_BYTES = 64 * 1024;
export const GEMINI_COUNT_TOKENS_TIMEOUT_MS = 30_000;
/** Outlasts the upstream deadline so the hold stands until usage is recorded. */
export const GEMINI_STT_HOLD_TTL_MS = 11 * 60 * 1000;

/** Audio MIME types Gemini documents; anything else is rejected, not converted. */
const AUDIO_MIME_TYPES = new Set([
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/mp3',
    'audio/mpeg',
    'audio/aiff',
    'audio/x-aiff',
    'audio/aac',
    'audio/x-aac',
    'audio/ogg',
    'audio/flac',
    'audio/x-flac',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/l16',
    'audio/opus',
    'audio/alaw',
    'audio/mulaw',
    'audio/webm',
]);

/** Options other providers take; set to anything but false, they're refused. */
const UNSUPPORTED_OPTIONS = [
    'prompt',
    'temperature',
    'logprobs',
    'stream',
    'chunking_strategy',
    'known_speaker_names',
    'extra_body',
    'format',
    'multichannel',
    'channels',
    'audio_format',
    'sample_rate',
] as const satisfies readonly (keyof ITranscribeArgs)[];

const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const OFFSET_PATTERN = /^(\d+(?:\.\d+)?)s$/;

const SAMPLE_TEXT =
    'Hello! This is a sample transcription returned while test mode is enabled.';
const SAMPLE_WORDS: GeminiTranscriptWord[] = [
    { text: 'Hello!', start: 0.0, end: 0.5 },
    { text: 'This', start: 0.6, end: 0.8 },
    { text: 'is', start: 0.8, end: 0.9 },
    { text: 'a', start: 0.9, end: 1.0 },
    { text: 'sample', start: 1.0, end: 1.3 },
    { text: 'transcription', start: 1.3, end: 1.8 },
    { text: 'returned', start: 1.8, end: 2.1 },
    { text: 'while', start: 2.1, end: 2.3 },
    { text: 'test', start: 2.3, end: 2.5 },
    { text: 'mode', start: 2.5, end: 2.7 },
    { text: 'is', start: 2.7, end: 2.8 },
    { text: 'enabled.', start: 2.8, end: 3.3 },
];

export interface GeminiTranscriptWord {
    text: string;
    /** Seconds from the start of the audio. */
    start: number;
    end: number;
    /** Speaker label, such as `spk:0`, when `diarize` is set. */
    speaker?: string;
}

/** What `transcribe` returns unless `response_format` is `text`. */
export interface GeminiTranscript {
    text: string;
    model: string;
    /** The `language` the caller supplied; Gemini reports none of its own. */
    language?: string;
    /** Present when word timestamps or diarization were requested. */
    words?: GeminiTranscriptWord[];
}

interface TranscriptionOptions {
    language?: string;
    words: boolean;
    diarize: boolean;
    textFormat: boolean;
}

// -- Gemini wire shapes --

interface TranscriptionMode {
    type: 'verbatim';
    timestamp_granularities: ['word'];
    diarization_mode?: 'speaker';
}

interface InteractionRequest {
    model: string;
    input: { type: 'audio'; mime_type: string; data: string }[];
    generation_config: {
        max_output_tokens: number;
        transcription_config?: {
            language_codes?: string[];
            mode?: TranscriptionMode;
        };
    };
    store: false;
    background: false;
    stream: false;
}

interface WordInfo {
    type?: string;
    text?: string;
    start_offset?: string;
    end_offset?: string;
    speaker?: string;
}

interface InteractionContent {
    type?: string;
    text?: string;
    annotations?: WordInfo[];
}

interface InteractionModalityTokens {
    modality?: string;
    tokens?: number;
}

interface InteractionUsage {
    total_input_tokens?: number;
    input_tokens_by_modality?: InteractionModalityTokens[];
    total_output_tokens?: number;
    total_thought_tokens?: number;
}

/** The reply as documented; every field is checked before use. */
interface Interaction {
    status?: string;
    steps?: { type?: string; content?: InteractionContent[] }[];
    usage?: InteractionUsage;
}

interface CountTokensRequest {
    contents: { parts: { inlineData: { mimeType: string; data: string } }[] }[];
}

interface CountTokensReply {
    totalTokens?: number;
}

const badRequest = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

/** A usable token count: a safe, non-negative integer. */
const tokenCount = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;

/** Seconds from a Duration string such as `0.300s`. */
const offsetSeconds = (value: unknown): number | undefined => {
    if (typeof value !== 'string') return undefined;
    const match = OFFSET_PATTERN.exec(value);
    const seconds = match ? Number(match[1]) : NaN;
    return Number.isFinite(seconds) ? seconds : undefined;
};

/**
 * Billable tokens from the reply's usage: audio input by modality, and output
 * plus thinking. Undefined when a count is missing, malformed or would cost
 * more than a safe integer. Text input carries no published rate.
 */
const billedTokens = (
    usage: InteractionUsage | undefined,
): { audio: number; output: number } | undefined => {
    if (!usage || typeof usage !== 'object') return undefined;
    const costs = GEMINI_SPEECH_TO_TEXT_COSTS[MODEL]!;
    const byModality = usage.input_tokens_by_modality;
    if (!Array.isArray(byModality)) return undefined;

    let audio: number | undefined;
    for (const entry of byModality) {
        const tokens = tokenCount(entry?.tokens);
        if (tokens === undefined) return undefined;
        if (String(entry.modality).toLowerCase() !== 'audio') continue;
        audio = (audio ?? 0) + tokens;
        if (!Number.isSafeInteger(audio)) return undefined;
    }
    const totalInput =
        usage.total_input_tokens === undefined
            ? audio
            : tokenCount(usage.total_input_tokens);
    if (audio === undefined || totalInput === undefined || audio > totalInput)
        return undefined;

    const output = tokenCount(usage.total_output_tokens);
    const thoughts =
        usage.total_thought_tokens === undefined
            ? 0
            : tokenCount(usage.total_thought_tokens);
    if (output === undefined || thoughts === undefined) return undefined;

    const billedOutput = output + thoughts;
    if (
        !Number.isSafeInteger(
            audio * costs.inputAudio + billedOutput * costs.outputText,
        )
    )
        return undefined;
    return { audio, output: billedOutput };
};

/**
 * Speech-to-text via Gemini's Interactions API. Audio goes inline, so the hold
 * is sized from a `countTokens` preflight plus the full output bound, and the
 * reply's usage settles it.
 */
export class GeminiSpeechToTextProvider extends SpeechToTextProvider {
    readonly providerName = 'gemini';

    // Null when the deployment has no Gemini credentials. The provider still
    // registers so its model catalogue stays listable; transcription rejects.
    #apiKey: string | null;
    #usesGoogleEndpoint: boolean;

    constructor(
        deps: ISpeechToTextDeps,
        config: { apiKey?: string; apiBaseUrl?: string },
    ) {
        super(deps);
        this.#apiKey = config.apiKey ?? null;
        this.#usesGoogleEndpoint = usesGoogleGeminiEndpoint(config.apiBaseUrl);
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(GEMINI_SPEECH_TO_TEXT_COSTS).flatMap(
            ([model, costs]) => [
                {
                    usageType: `gemini:${model}:input:audio`,
                    ucentsPerUnit: costs.inputAudio,
                    unit: 'token',
                    source: 'driver:aiSpeech2Txt/gemini',
                },
                {
                    usageType: `gemini:${model}:output:text`,
                    ucentsPerUnit: costs.outputText,
                    unit: 'token',
                    source: 'driver:aiSpeech2Txt/gemini',
                },
            ],
        );
    }

    async listModels(): Promise<ISpeechToTextModel[]> {
        return [
            {
                id: MODEL,
                name: 'Gemini 3.5 Transcribe',
                type: 'transcription',
                response_formats: ['json', 'text'],
                supports_prompt: false,
                supports_logprobs: false,
                supports_diarization: true,
                supports_timestamp_granularities: true,
            },
        ];
    }

    async translate(_args: ITranscribeArgs): Promise<never> {
        throw badRequest(
            'Translation is not supported by Gemini transcription',
        );
    }

    async transcribe(
        args: ITranscribeArgs,
    ): Promise<GeminiTranscript | string> {
        const options = this.#readOptions(args);
        if (args.test_mode) {
            const words = SAMPLE_WORDS.map((word) =>
                options.diarize ? { ...word, speaker: 'spk:0' } : { ...word },
            );
            return this.#result(SAMPLE_TEXT, options, words);
        }

        if (!this.#usesGoogleEndpoint) {
            throw new HttpError(
                500,
                'Gemini transcription requires the Google endpoint',
                {
                    legacyCode: 'internal_error',
                },
            );
        }
        if (!this.#apiKey) {
            throw new HttpError(500, 'Gemini API key not configured', {
                legacyCode: 'internal_error',
            });
        }
        this.requireFile(args);
        const actor = this.requireActor();

        const loaded = await loadFileInput(
            this.deps.stores,
            this.deps.fs,
            actor,
            args.file,
            { maxBytes: GEMINI_STT_MAX_AUDIO_BYTES, acceptWebInput: true },
        );
        const mimeType = loaded.mimeType?.trim() ?? '';
        const essence = mimeType.split(';')[0]!.trim().toLowerCase();
        if (!AUDIO_MIME_TYPES.has(essence)) {
            throw badRequest(
                `Unsupported audio type: ${essence || 'unknown'}. Expected one of: ${[...AUDIO_MIME_TYPES].join(', ')}`,
            );
        }
        if (loaded.buffer.byteLength === 0) {
            throw badRequest('Audio input is empty');
        }
        const data = loaded.buffer.toString('base64');
        const signal = Context.get('abortSignal');
        const costs = GEMINI_SPEECH_TO_TEXT_COSTS[MODEL]!;

        const inputTokens = await this.#countTokens(mimeType, data, signal);
        const holdAmount =
            inputTokens * costs.inputAudio +
            GEMINI_STT_MAX_OUTPUT_TOKENS * costs.outputText;
        if (!Number.isSafeInteger(holdAmount)) {
            throw geminiUpstreamFailure(
                'Gemini token count returned an unusable count',
            );
        }
        const metering = this.deps.metering;
        const usagePrefix = `gemini:${MODEL}`;
        const hold = await metering.reserveAiCredits(
            actor,
            usagePrefix,
            holdAmount,
            { ttlMs: GEMINI_STT_HOLD_TTL_MS },
        );
        if (!hold) throw insufficientCreditsError();

        try {
            const interaction = await postGeminiJson<Interaction>(
                this.#apiKey,
                'interactions',
                this.#request(mimeType, data, options),
                {
                    label: 'Gemini transcription',
                    maxBytes: GEMINI_STT_MAX_RESPONSE_BYTES,
                    timeoutMs: GEMINI_STT_TIMEOUT_MS,
                    signal,
                },
            );
            // Google bills what it processed, finished or not, so usage is
            // recorded before the reply is checked. The counted audio stands in
            // when the reply's usage can't be read.
            const billed = billedTokens(interaction.usage) ?? {
                audio: inputTokens,
                output: 0,
            };
            const usages: UsageInput[] = [
                {
                    usageType: `${usagePrefix}:input:audio`,
                    usageAmount: billed.audio,
                    costOverride: billed.audio * costs.inputAudio,
                },
                {
                    usageType: `${usagePrefix}:output:text`,
                    usageAmount: billed.output,
                    costOverride: billed.output * costs.outputText,
                },
            ].filter((usage) => usage.usageAmount > 0);
            if (usages.length > 0) {
                await metering.batchIncrementUsages(actor, usages);
            }

            if (interaction.status !== 'completed') {
                throw geminiUpstreamFailure(
                    'Gemini transcription did not complete the request',
                );
            }
            const { text, words } = this.#readTranscript(interaction);
            return this.#result(text, options, words);
        } finally {
            await hold.release();
        }
    }

    /** Validates every option before any I/O, test mode included. */
    #readOptions(args: ITranscribeArgs): TranscriptionOptions {
        if (args.model !== undefined && args.model !== MODEL) {
            throw badRequest(
                `Unsupported model: ${String(args.model)}. Expected: ${MODEL}`,
            );
        }
        const format = args.response_format;
        if (format !== undefined && format !== 'json' && format !== 'text') {
            throw badRequest('response_format must be one of: json, text');
        }
        const language = args.language;
        if (
            language !== undefined &&
            (typeof language !== 'string' || !LANGUAGE_PATTERN.test(language))
        ) {
            throw badRequest('language must be a language code such as "en"');
        }
        const granularities = args.timestamp_granularities;
        if (
            granularities !== undefined &&
            (!Array.isArray(granularities) ||
                granularities.some((g) => g !== 'word'))
        ) {
            throw badRequest('timestamp_granularities only supports "word"');
        }
        if (args.diarize !== undefined && typeof args.diarize !== 'boolean') {
            throw badRequest('diarize must be a boolean');
        }
        for (const key of UNSUPPORTED_OPTIONS) {
            const value = args[key];
            if (value !== undefined && value !== null && value !== false) {
                throw badRequest(
                    `${key} is not supported by Gemini transcription`,
                );
            }
        }
        const diarize = args.diarize === true;
        return {
            language,
            // Speakers are reported per word, so diarization implies words.
            words: diarize || (granularities?.length ?? 0) > 0,
            diarize,
            textFormat: format === 'text',
        };
    }

    #request(
        mimeType: string,
        data: string,
        options: TranscriptionOptions,
    ): InteractionRequest {
        const request: InteractionRequest = {
            model: MODEL,
            input: [{ type: 'audio', mime_type: mimeType, data }],
            generation_config: {
                max_output_tokens: GEMINI_STT_MAX_OUTPUT_TOKENS,
            },
            store: false,
            background: false,
            stream: false,
        };
        if (options.language || options.words) {
            const config: NonNullable<
                InteractionRequest['generation_config']['transcription_config']
            > = {};
            if (options.language) config.language_codes = [options.language];
            if (options.words) {
                const mode: TranscriptionMode = {
                    type: 'verbatim',
                    timestamp_granularities: ['word'],
                };
                if (options.diarize) mode.diarization_mode = 'speaker';
                config.mode = mode;
            }
            request.generation_config.transcription_config = config;
        }
        return request;
    }

    /** Input tokens for the audio, as the hold's input share. */
    async #countTokens(
        mimeType: string,
        data: string,
        signal: AbortSignal | undefined,
    ): Promise<number> {
        const request: CountTokensRequest = {
            contents: [{ parts: [{ inlineData: { mimeType, data } }] }],
        };
        const reply = await postGeminiJson<CountTokensReply>(
            this.#apiKey!,
            `models/${MODEL}:countTokens`,
            request,
            {
                label: 'Gemini token count',
                maxBytes: GEMINI_COUNT_TOKENS_MAX_RESPONSE_BYTES,
                timeoutMs: GEMINI_COUNT_TOKENS_TIMEOUT_MS,
                signal,
            },
        );
        const tokens = tokenCount(reply.totalTokens);
        if (!tokens) {
            throw geminiUpstreamFailure(
                'Gemini token count returned an unusable count',
            );
        }
        return tokens;
    }

    /** The transcript text and word timings across the model's text output. */
    #readTranscript(interaction: Interaction): {
        text: string;
        words: GeminiTranscriptWord[];
    } {
        const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
        const contents = steps
            .flatMap((step) =>
                step?.type === 'model_output' && Array.isArray(step.content)
                    ? step.content
                    : [],
            )
            .filter((content) => content?.type === 'text');
        if (contents.length === 0) {
            throw new HttpError(400, 'Gemini did not return a transcript', {
                legacyCode: 'upstream_bad_request',
                fields: { provider: 'gemini' },
            });
        }

        const malformed = () =>
            geminiUpstreamFailure(
                'Gemini transcription returned a malformed transcript',
            );
        const words: GeminiTranscriptWord[] = [];
        for (const content of contents) {
            if (typeof content.text !== 'string') throw malformed();
            const annotations = content.annotations;
            if (annotations === undefined) continue;
            if (!Array.isArray(annotations)) throw malformed();
            for (const info of annotations) {
                if (info?.type !== 'word_info') continue;
                const start = offsetSeconds(info.start_offset);
                const end = offsetSeconds(info.end_offset);
                if (
                    typeof info.text !== 'string' ||
                    start === undefined ||
                    end === undefined ||
                    end < start ||
                    (info.speaker !== undefined &&
                        typeof info.speaker !== 'string')
                ) {
                    throw malformed();
                }
                const word: GeminiTranscriptWord = {
                    text: info.text,
                    start,
                    end,
                };
                if (info.speaker !== undefined) word.speaker = info.speaker;
                words.push(word);
            }
        }
        return {
            text: contents.map((content) => content.text).join(''),
            words,
        };
    }

    #result(
        text: string,
        options: TranscriptionOptions,
        words: GeminiTranscriptWord[],
    ): GeminiTranscript | string {
        if (options.textFormat) return text;
        const result: GeminiTranscript = { text, model: MODEL };
        if (options.language) result.language = options.language;
        if (options.words) result.words = words;
        return result;
    }
}
