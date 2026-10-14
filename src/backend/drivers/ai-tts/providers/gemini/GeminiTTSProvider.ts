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
import type { Actor } from '../../../../core/actor.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import { Context } from '../../../../core/context.js';
import {
    type AiMeteringService,
    withAiCreditHold,
} from '../../../util/aiCostFactor.js';
import type { UsageInput } from '../../../../services/metering/types.js';
import type { DriverStreamResult } from '../../../meta.js';
import {
    AI_TTS_GEMINI_RESERVED_TOKENS,
    AI_TTS_MAX_GEMINI_INSTRUCTIONS_CHARS,
    AI_TTS_MAX_GEMINI_TEXT_CHARS,
} from '../../../util/aiLimits.js';
import {
    geminiUpstreamFailure as upstreamFailure,
    postGeminiJson,
} from '../../../util/geminiRest.js';
import { isUpstreamTimeoutError } from '../../../util/upstreamErrors.js';
import { SAMPLE_AUDIO_URL } from '../../../util/testMode.js';
import type {
    ITTSVoice,
    ITTSEngine,
    ISynthesizeArgs,
    ITTSProvider,
} from '../../types.js';
import { assertMaxChars, TTS_UPSTREAM_TIMEOUT_MS } from '../common.js';
import {
    GEMINI_TTS_COSTS,
    type GeminiTTSCosts,
    geminiTTSCostsAt,
} from './costs.js';

/**
 * Largest Interactions reply read; audio arrives base64-encoded inside JSON.
 * The full audio budget (~11 min of 24 kHz PCM at ~25 tokens/s) is ~42 MB.
 */
export const GEMINI_TTS_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

const DEFAULT_MODEL = 'gemini-3.8-flash-tts';
const DEFAULT_VOICE = 'Kore';
const DEFAULT_PCM_SAMPLE_RATE = 24_000;

const GEMINI_TTS_MODELS = [
    {
        id: 'gemini-3.8-flash-tts',
        name: 'Gemini 3.8 Flash TTS',
    },
    {
        id: 'gemini-3.8-flash-lite-tts',
        name: 'Gemini 3.8 Flash-Lite TTS',
    },
];

const GEMINI_TTS_VOICES = [
    { id: 'Zephyr', name: 'Zephyr', description: 'Bright' },
    { id: 'Puck', name: 'Puck', description: 'Upbeat' },
    { id: 'Charon', name: 'Charon', description: 'Informative' },
    { id: 'Kore', name: 'Kore', description: 'Firm' },
    { id: 'Fenrir', name: 'Fenrir', description: 'Excitable' },
    { id: 'Leda', name: 'Leda', description: 'Youthful' },
    { id: 'Orus', name: 'Orus', description: 'Firm' },
    { id: 'Aoede', name: 'Aoede', description: 'Breezy' },
    { id: 'Callirrhoe', name: 'Callirrhoe', description: 'Easy-going' },
    { id: 'Autonoe', name: 'Autonoe', description: 'Bright' },
    { id: 'Enceladus', name: 'Enceladus', description: 'Breathy' },
    { id: 'Iapetus', name: 'Iapetus', description: 'Clear' },
    { id: 'Umbriel', name: 'Umbriel', description: 'Easy-going' },
    { id: 'Algieba', name: 'Algieba', description: 'Smooth' },
    { id: 'Despina', name: 'Despina', description: 'Smooth' },
    { id: 'Erinome', name: 'Erinome', description: 'Clear' },
    { id: 'Algenib', name: 'Algenib', description: 'Gravelly' },
    { id: 'Rasalgethi', name: 'Rasalgethi', description: 'Informative' },
    { id: 'Laomedeia', name: 'Laomedeia', description: 'Upbeat' },
    { id: 'Achernar', name: 'Achernar', description: 'Soft' },
    { id: 'Alnilam', name: 'Alnilam', description: 'Firm' },
    { id: 'Schedar', name: 'Schedar', description: 'Even' },
    { id: 'Gacrux', name: 'Gacrux', description: 'Mature' },
    { id: 'Pulcherrima', name: 'Pulcherrima', description: 'Forward' },
    { id: 'Achird', name: 'Achird', description: 'Friendly' },
    { id: 'Zubenelgenubi', name: 'Zubenelgenubi', description: 'Casual' },
    { id: 'Vindemiatrix', name: 'Vindemiatrix', description: 'Gentle' },
    { id: 'Sadachbia', name: 'Sadachbia', description: 'Lively' },
    { id: 'Sadaltager', name: 'Sadaltager', description: 'Knowledgeable' },
    { id: 'Sulafat', name: 'Sulafat', description: 'Warm' },
];

// -- Interactions API wire shapes --

interface InteractionTextInput {
    type: 'text';
    text: string;
    annotations?: { type: 'speech_metadata'; style: string }[];
}

interface InteractionRequest {
    model: string;
    input: { type: 'user_input'; content: InteractionTextInput[] }[];
    response_format: { type: 'audio' };
    generation_config: {
        speech_config: { voice: string }[];
        max_output_tokens: number;
    };
    store: false;
    background: false;
    stream: false;
}

interface InteractionContent {
    type?: string;
    mime_type?: string;
    data?: string;
}

interface InteractionModalityTokens {
    modality?: string;
    tokens?: number;
}

interface InteractionUsage {
    total_input_tokens?: number;
    input_tokens_by_modality?: InteractionModalityTokens[];
    total_output_tokens?: number;
    output_tokens_by_modality?: InteractionModalityTokens[];
}

/** The reply as documented; every field is checked before use. */
interface Interaction {
    status?: string;
    steps?: { type?: string; content?: InteractionContent[] }[];
    usage?: InteractionUsage;
}

const WAV_MIME_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave']);
const PCM_MIME_TYPES = new Set(['audio/l16', 'audio/pcm']);
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;


const SPLIT_TEXT_HINT = 'Split the text into shorter requests.';

const audioTooLong = (): HttpError =>
    new HttpError(
        400,
        `Gemini TTS generated more audio than one request can return. ${SPLIT_TEXT_HINT}`,
        { legacyCode: 'input_too_large', fields: { provider: 'gemini' } },
    );

const audioTimedOut = (cause: unknown): HttpError =>
    new HttpError(
        504,
        `Gemini TTS timed out generating the audio. ${SPLIT_TEXT_HINT}`,
        {
            legacyCode: 'upstream_timeout',
            fields: { provider: 'gemini' },
            cause,
        },
    );

/** A usable token count: a finite, non-negative integer. */
const tokenCount = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;

/**
 * `modality`'s tokens from a by-modality breakdown, or `total` when there is no
 * breakdown to read. Undefined when the counts are unusable or ambiguous.
 */
const usageTokens = (
    byModality: unknown,
    total: unknown,
    modality: string,
    rate: number,
): number | undefined => {
    if (!Array.isArray(byModality) || byModality.length === 0) {
        const count = tokenCount(total);
        return count !== undefined && Number.isSafeInteger(count * rate)
            ? count
            : undefined;
    }
    let sum: number | undefined;
    for (const entry of byModality as InteractionModalityTokens[]) {
        if (String(entry?.modality).toLowerCase() !== modality) continue;
        const tokens = tokenCount(entry.tokens);
        if (tokens === undefined) return undefined;
        sum = (sum ?? 0) + tokens;
        if (!Number.isSafeInteger(sum * rate)) return undefined;
    }
    return sum;
};

/** The last audio block of the model's output, as the API documents it. */
const lastAudioContent = (
    interaction: Interaction,
): InteractionContent | undefined => {
    const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
    return steps
        .flatMap((step) =>
            step?.type === 'model_output' && Array.isArray(step.content)
                ? step.content
                : [],
        )
        .filter((content) => content?.type === 'audio')
        .at(-1);
};

/**
 * Gemini TTS provider. Calls the Gemini Interactions API, which reads `text`
 * verbatim and takes `instructions` as a separate speech-style annotation.
 */
export class GeminiTTSProvider implements ITTSProvider {
    readonly providerName = 'gemini';

    #apiKey: string;

    constructor(
        private readonly meteringService: AiMeteringService,
        config: { apiKey: string },
    ) {
        if (!config.apiKey) {
            throw new Error('Gemini TTS requires an API key');
        }
        this.#apiKey = config.apiKey;
    }

    async listVoices(): Promise<ITTSVoice[]> {
        return GEMINI_TTS_VOICES.map((voice) => ({
            id: voice.id,
            name: voice.name,
            description: voice.description,
            provider: 'gemini',
            supported_models: GEMINI_TTS_MODELS.map((m) => m.id),
        }));
    }

    async listEngines(): Promise<ITTSEngine[]> {
        return GEMINI_TTS_MODELS.map((model) => ({
            id: model.id,
            name: model.name,
            provider: 'gemini',
        }));
    }

    getReportedCosts(): Record<string, unknown>[] {
        const now = Date.now();
        return Object.keys(GEMINI_TTS_COSTS).flatMap((model) => {
            const costs = geminiTTSCostsAt(model, now);
            if (!costs) return [];
            return [
                {
                    usageType: `gemini:${model}:tts`,
                    ucentsInputPerToken: costs.input,
                    ucentsOutputAudioPerToken: costs.output_audio,
                    unit: 'token',
                    source: 'driver:aiTts/gemini',
                },
            ];
        });
    }

    async synthesize(
        args: ISynthesizeArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const {
            text,
            voice: voiceArg,
            model: modelArg,
            instructions,
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
        assertMaxChars('text', text, AI_TTS_MAX_GEMINI_TEXT_CHARS);

        if (instructions != null && typeof instructions !== 'string') {
            throw new HttpError(400, 'instructions must be a string', {
                legacyCode: 'field_invalid',
                fields: { key: 'instructions', expected: 'string' },
            });
        }
        assertMaxChars(
            'instructions',
            instructions,
            AI_TTS_MAX_GEMINI_INSTRUCTIONS_CHARS,
        );
        const style = instructions?.trim() ? instructions : undefined;

        const model = modelArg || DEFAULT_MODEL;
        if (!GEMINI_TTS_MODELS.find(({ id }) => id === model)) {
            throw new HttpError(
                400,
                `Invalid model: ${model}. Expected: ${GEMINI_TTS_MODELS.map(({ id }) => id).join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'model',
                        expected: GEMINI_TTS_MODELS.map(({ id }) => id).join(
                            ', ',
                        ),
                        got: model,
                    },
                },
            );
        }

        const requestedVoice = String(voiceArg || DEFAULT_VOICE);
        const voice = GEMINI_TTS_VOICES.find(
            ({ id }) => id.toLowerCase() === requestedVoice.toLowerCase(),
        )?.id;
        if (!voice) {
            throw new HttpError(
                400,
                `Invalid voice: ${requestedVoice}. Expected: ${GEMINI_TTS_VOICES.map(({ id }) => id).join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'voice',
                        expected: GEMINI_TTS_VOICES.map(({ id }) => id).join(
                            ', ',
                        ),
                        got: requestedVoice,
                    },
                },
            );
        }

        const actor = Context.get('actor')!;
        // Priced once, so a request that crosses a rate change settles at the
        // rates it was held at.
        const costs = geminiTTSCostsAt(model, Date.now());
        if (!costs) {
            throw new HttpError(500, `No cost data for model: ${model}`, {
                legacyCode: 'internal_error',
            });
        }

        // The full token budget, whatever the text; settlement charges only
        // the reported usage.
        const reservedMicroCents =
            AI_TTS_GEMINI_RESERVED_TOKENS.input * costs.input +
            AI_TTS_GEMINI_RESERVED_TOKENS.audio * costs.output_audio;

        const content: InteractionTextInput = { type: 'text', text };
        if (style) {
            content.annotations = [{ type: 'speech_metadata', style }];
        }
        const request: InteractionRequest = {
            model,
            input: [{ type: 'user_input', content: [content] }],
            response_format: { type: 'audio' },
            generation_config: {
                speech_config: [{ voice }],
                // Request the same audio budget used for the credit hold.
                max_output_tokens: AI_TTS_GEMINI_RESERVED_TOKENS.audio,
            },
            store: false,
            background: false,
            stream: false,
        };

        return withAiCreditHold(
            this.meteringService,
            actor,
            `gemini:${model}`,
            reservedMicroCents,
            async (): Promise<DriverStreamResult> => {
                const signal = Context.get('abortSignal');
                let overran = false;
                let interaction: Interaction;
                try {
                    interaction = await postGeminiJson<Interaction>(
                        this.#apiKey,
                        'interactions',
                        request,
                        {
                            label: 'Gemini TTS',
                            maxBytes: GEMINI_TTS_MAX_RESPONSE_BYTES,
                            timeoutMs: TTS_UPSTREAM_TIMEOUT_MS,
                            signal,
                            tooLarge: () => {
                                overran = true;
                                return audioTooLong();
                            },
                        },
                    );
                } catch (err) {
                    const timedOut =
                        isUpstreamTimeoutError(err) && !signal?.aborted;
                    if (!overran && !timedOut) throw err;
                    // Google bills audio we never got to read, and there is
                    // no usage to settle from, so the held budget is charged.
                    await this.#meter(
                        actor,
                        model,
                        costs,
                        AI_TTS_GEMINI_RESERVED_TOKENS.input,
                        AI_TTS_GEMINI_RESERVED_TOKENS.audio,
                    );
                    throw overran ? err : audioTimedOut(err);
                }

                // A count Gemini doesn't report readably is left out, not
                // estimated. Output without a modality breakdown may be refusal
                // text, so it counts as audio only once audio came back.
                const usage = interaction.usage;
                const inputTokens = usageTokens(
                    usage?.input_tokens_by_modality,
                    usage?.total_input_tokens,
                    'text',
                    costs.input,
                );
                let outputTokens = usageTokens(
                    usage?.output_tokens_by_modality,
                    undefined,
                    'audio',
                    costs.output_audio,
                );
                try {
                    if (interaction.status !== 'completed') {
                        throw upstreamFailure(
                            'Gemini TTS did not complete the request',
                        );
                    }

                    const audio = lastAudioContent(interaction);
                    if (!audio) {
                        throw new HttpError(
                            400,
                            'Gemini TTS did not return audio data',
                            {
                                legacyCode: 'upstream_bad_request',
                                fields: { provider: 'gemini' },
                            },
                        );
                    }
                    const { body, contentType } = this.#decodeAudio(audio);

                    outputTokens = usageTokens(
                        usage?.output_tokens_by_modality,
                        usage?.total_output_tokens,
                        'audio',
                        costs.output_audio,
                    );
                    if (!inputTokens || !outputTokens) {
                        throw upstreamFailure(
                            'Gemini TTS did not report usage for the audio',
                        );
                    }

                    return {
                        dataType: 'stream',
                        content_type: contentType,
                        chunked: true,
                        stream: Readable.from(body),
                    };
                } finally {
                    // Every outcome pays once for the counts it reports.
                    await this.#meter(
                        actor,
                        model,
                        costs,
                        inputTokens,
                        outputTokens,
                    );
                }
            },
        );
    }

    async #meter(
        actor: Actor,
        model: string,
        costs: GeminiTTSCosts,
        inputTokens: number | undefined,
        outputTokens: number | undefined,
    ): Promise<void> {
        const usagePrefix = `gemini:${model}`;
        const usages: UsageInput[] = [];
        if (inputTokens) {
            usages.push({
                usageType: `${usagePrefix}:input`,
                usageAmount: inputTokens,
                costOverride: inputTokens * costs.input,
            });
        }
        if (outputTokens) {
            usages.push({
                usageType: `${usagePrefix}:output:audio`,
                usageAmount: outputTokens,
                costOverride: outputTokens * costs.output_audio,
            });
        }
        if (usages.length > 0) {
            await this.meteringService.batchIncrementUsages(actor, usages);
        }
    }

    /** WAV passes through byte for byte; raw PCM is wrapped in a WAV header. */
    #decodeAudio(audio: InteractionContent): {
        body: Buffer;
        contentType: string;
    } {
        const { data, mime_type: mimeType } = audio;
        if (
            typeof data !== 'string' ||
            !BASE64_PATTERN.test(data) ||
            typeof mimeType !== 'string'
        ) {
            throw upstreamFailure('Gemini TTS returned invalid audio data');
        }
        const bytes = Buffer.from(data, 'base64');
        const [essence, ...params] = mimeType
            .split(';')
            .map((part) => part.trim().toLowerCase());

        if (WAV_MIME_TYPES.has(essence)) {
            if (
                bytes.length <= 44 ||
                bytes.toString('latin1', 0, 4) !== 'RIFF' ||
                bytes.toString('latin1', 8, 12) !== 'WAVE'
            ) {
                throw upstreamFailure('Gemini TTS returned invalid audio data');
            }
            return { body: bytes, contentType: 'audio/wav' };
        }
        if (PCM_MIME_TYPES.has(essence) && bytes.length > 0) {
            const rate = Number(
                params.find((p) => p.startsWith('rate='))?.slice(5),
            );
            const sampleRate =
                Number.isSafeInteger(rate) && rate > 0
                    ? rate
                    : DEFAULT_PCM_SAMPLE_RATE;
            return {
                body: this.#wrapPcmInWav(bytes, sampleRate, 1, 16),
                contentType: 'audio/wav',
            };
        }
        throw upstreamFailure('Gemini TTS returned invalid audio data');
    }

    /** Wrap raw PCM samples in a WAV container so browsers can play it. */
    #wrapPcmInWav(
        pcm: Buffer,
        sampleRate: number,
        channels: number,
        bitsPerSample: number,
    ): Buffer {
        const byteRate = (sampleRate * channels * bitsPerSample) / 8;
        const blockAlign = (channels * bitsPerSample) / 8;
        const dataSize = pcm.length;
        const headerSize = 44;
        const buffer = Buffer.alloc(headerSize + dataSize);

        // RIFF header
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + dataSize, 4);
        buffer.write('WAVE', 8);

        // fmt sub-chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // sub-chunk size
        buffer.writeUInt16LE(1, 20); // PCM format
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(byteRate, 28);
        buffer.writeUInt16LE(blockAlign, 32);
        buffer.writeUInt16LE(bitsPerSample, 34);

        // data sub-chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);
        pcm.copy(buffer, headerSize);

        return buffer;
    }
}
