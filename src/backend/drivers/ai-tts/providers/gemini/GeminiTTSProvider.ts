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

import { GoogleGenAI } from '@google/genai';
import { Readable } from 'node:stream';
import { HttpError } from '../../../../core/http/HttpError.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { DriverStreamResult } from '../../../meta.js';
import type { ITTSVoice, ITTSEngine, ISynthesizeArgs } from '../../types.js';
import { TTSProvider } from '../TTSProvider.js';
import { GEMINI_TTS_COSTS } from './costs.js';

const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';
const DEFAULT_VOICE = 'Kore';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';

const GEMINI_TTS_MODELS = [
    {
        id: 'gemini-2.5-flash-preview-tts',
        name: 'Gemini 2.5 Flash TTS',
    },
    {
        id: 'gemini-2.5-pro-preview-tts',
        name: 'Gemini 2.5 Pro TTS',
    },
    {
        id: 'gemini-3.1-flash-tts-preview',
        name: 'Gemini 3.1 Flash TTS',
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

/**
 * Gemini TTS provider. Calls the Gemini generateContent API with
 * `responseModalities: ["AUDIO"]` and `speechConfig` to synthesize speech.
 * Returns raw PCM audio wrapped in a WAV container.
 */
export class GeminiTTSProvider extends TTSProvider {
    readonly providerName = 'gemini';

    #client: GoogleGenAI;

    constructor(meteringService: MeteringService, config: { apiKey: string }) {
        super(meteringService, config);
        if (!config.apiKey) {
            throw new Error('Gemini TTS requires an API key');
        }
        this.#client = new GoogleGenAI({ apiKey: config.apiKey });
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

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(GEMINI_TTS_COSTS).map(([model, costs]) => ({
            usageType: `gemini:${model}:tts`,
            ucentsInputPerToken: this.#toMicroCents(costs.input / 1_000_000),
            ucentsOutputAudioPerToken: this.#toMicroCents(
                costs.output_audio / 1_000_000,
            ),
            unit: 'token',
            source: 'driver:aiTts/gemini',
        }));
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

        const voice = voiceArg || DEFAULT_VOICE;
        if (
            !GEMINI_TTS_VOICES.find(
                ({ id }) => id.toLowerCase() === voice.toLowerCase(),
            )
        ) {
            throw new HttpError(
                400,
                `Invalid voice: ${voice}. Expected: ${GEMINI_TTS_VOICES.map(({ id }) => id).join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'voice',
                        expected: GEMINI_TTS_VOICES.map(({ id }) => id).join(
                            ', ',
                        ),
                        got: voice,
                    },
                },
            );
        }

        const actor = Context.get('actor')!;
        const costs = GEMINI_TTS_COSTS[model];
        if (!costs) {
            throw new HttpError(500, `No cost data for model: ${model}`, {
                legacyCode: 'internal_error',
            });
        }

        // Estimate input tokens (~4 chars per token) and a rough output
        // audio duration (~150 words/min, 25 tokens/sec).
        const estimatedInputTokens = Math.max(1, Math.ceil(text.length / 4));
        const wordCount = text.split(/\s+/).length;
        const estimatedDurationSec = Math.max(1, (wordCount / 150) * 60);
        const estimatedOutputTokens = Math.ceil(estimatedDurationSec * 25);

        const estimatedInputCostCents =
            (estimatedInputTokens / 1_000_000) * costs.input;
        const estimatedOutputCostCents =
            (estimatedOutputTokens / 1_000_000) * costs.output_audio;
        const estimatedTotalMicroCents = this.#toMicroCents(
            estimatedInputCostCents + estimatedOutputCostCents,
        );

        const usageAllowed = await this.meteringService.hasEnoughCredits(
            actor,
            estimatedTotalMicroCents,
        );
        if (!usageAllowed) {
            throw new HttpError(402, 'Insufficient funds', {
                legacyCode: 'insufficient_funds',
            });
        }

        // The TTS models require the text to be framed as a transcript
        // to read aloud. Prefixing with "Say:" prevents the model from
        // trying to generate conversational text instead of audio.
        const inputText = instructions
            ? `${instructions}\n\nSay the following text aloud:\n${text}`
            : `Say the following text aloud:\n${text}`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let response: any;
        try {
            response = await this.#client.models.generateContent({
                model,
                contents: [{ parts: [{ text: inputText }] }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voice },
                        },
                    },
                },
            });
        } catch (e: unknown) {
            const msg = (e as Error).message ?? String(e);
            console.error('[GeminiTTSProvider] API error:', msg);
            throw new HttpError(502, `Gemini TTS API error: ${msg}`, {
                legacyCode: 'internal_error',
                fields: { provider: 'gemini' },
            });
        }

        // Extract audio data from response
        const part = response?.candidates?.[0]?.content?.parts?.[0];
        if (!part?.inlineData?.data) {
            throw new HttpError(502, 'Gemini TTS did not return audio data', {
                legacyCode: 'internal_error',
                fields: { provider: 'gemini' },
            });
        }

        const audioBase64: string = part.inlineData.data;
        const mimeType: string =
            part.inlineData.mimeType || 'audio/L16;rate=24000';

        // Convert base64 PCM to a WAV buffer for broad client compatibility
        const pcmBuffer = Buffer.from(audioBase64, 'base64');
        let outputBuffer: Buffer;
        let contentType: string;

        if (mimeType.startsWith('audio/L16') || mimeType === 'audio/pcm') {
            // Wrap raw PCM (16-bit LE, 24kHz, mono) in a WAV container
            outputBuffer = this.#wrapPcmInWav(pcmBuffer, 24000, 1, 16);
            contentType = 'audio/wav';
        } else {
            // If the API returns encoded audio (unlikely today), pass through
            outputBuffer = pcmBuffer;
            contentType = mimeType;
        }

        // Meter actual usage from response metadata
        const usage = response.usageMetadata;
        const actualInputTokens =
            typeof usage?.promptTokenCount === 'number'
                ? usage.promptTokenCount
                : estimatedInputTokens;
        const actualOutputTokens =
            typeof usage?.candidatesTokenCount === 'number'
                ? usage.candidatesTokenCount
                : estimatedOutputTokens;

        const inputCostCents = (actualInputTokens / 1_000_000) * costs.input;
        const outputCostCents =
            (actualOutputTokens / 1_000_000) * costs.output_audio;

        const usagePrefix = `gemini:${model}`;
        this.meteringService.batchIncrementUsages(actor, [
            {
                usageType: `${usagePrefix}:input`,
                usageAmount: Math.max(actualInputTokens, 1),
                costOverride: this.#toMicroCents(inputCostCents),
            },
            {
                usageType: `${usagePrefix}:output:audio`,
                usageAmount: Math.max(actualOutputTokens, 1),
                costOverride: this.#toMicroCents(outputCostCents),
            },
        ]);

        const stream = Readable.from(outputBuffer);

        return {
            dataType: 'stream',
            content_type: contentType,
            chunked: true,
            stream,
        };
    }

    /**
     * Wrap raw PCM samples in a WAV container so browsers can play it.
     */
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

    #toMicroCents(cents: number): number {
        if (!Number.isFinite(cents) || cents <= 0) return 1;
        return Math.ceil(cents * 1_000_000);
    }
}
