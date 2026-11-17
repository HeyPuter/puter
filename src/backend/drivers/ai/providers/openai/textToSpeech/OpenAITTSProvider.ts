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

import { pipeline, Transform } from 'node:stream';
import OpenAI from 'openai';
import type { Actor } from '../../../../../core/actor.js';
import { HttpError } from '../../../../../core/http/HttpError.js';
import { Context } from '../../../../../core/context.js';
import type { AiMeteringService } from '../../../../../util/aiCostFactor.js';
import type { DriverStreamResult } from '../../../../meta.js';
import { SAMPLE_AUDIO_URL } from '../../../shared/testMode.js';
import { withStreamedAiCharge } from '../../../shared/streamedAiCharge.js';
import { upstreamBodyStream } from '../../../../util/upstreamErrors.js';
import type {
    ITTSVoice,
    ITTSEngine,
    ISynthesizeArgs,
    ITTSProvider,
} from '../../../interfaces/textToSpeech/types.js';
import {
    characterCostReport,
    meterPerCharacter,
} from '../../../interfaces/textToSpeech/common.js';
import { OPENAI_TTS_COSTS, OPENAI_TTS_TOKEN_COSTS } from './costs.js';

const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'alloy';

interface SpeechUsage {
    input_tokens?: unknown;
    output_tokens?: unknown;
}

const tokenCount = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;

/**
 * Turns OpenAI's speech event stream into the audio bytes it carries, and hands
 * `onEnd` the usage from its final event, or undefined when it ends without
 * one.
 */
const speechEventAudio = (
    onEnd: (usage: SpeechUsage | undefined) => void,
): Transform => {
    let pending = '';
    let usage: SpeechUsage | undefined;
    return new Transform({
        transform(chunk: Buffer, _encoding, done) {
            pending = (pending + chunk.toString('utf8')).replace(/\r\n/g, '\n');
            try {
                let end: number;
                while ((end = pending.indexOf('\n\n')) !== -1) {
                    const data = pending
                        .slice(0, end)
                        .split('\n')
                        .filter((line) => line.startsWith('data:'))
                        .map((line) => line.slice(5).trimStart())
                        .join('\n');
                    pending = pending.slice(end + 2);
                    if (!data || data === '[DONE]') continue;
                    const event = JSON.parse(data);
                    if (
                        event?.type === 'speech.audio.delta' &&
                        typeof event.audio === 'string'
                    )
                        this.push(Buffer.from(event.audio, 'base64'));
                    else if (event?.type === 'speech.audio.done')
                        usage = event.usage;
                }
                done();
            } catch (e) {
                done(e as Error);
            }
        },
        flush(done) {
            onEnd(usage);
            done();
        },
        destroy(error, callback) {
            onEnd(usage);
            callback(error);
        },
    });
};

const RESPONSE_CONTENT_TYPES: Record<string, string> = {
    mp3: 'audio/mpeg',
    opus: 'audio/opus',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wav: 'audio/wav',
    pcm: 'audio/pcm',
};

// Voices without `models` work on every engine; the rest are gpt-4o-mini-tts only.
const OPENAI_TTS_VOICES: { id: string; name: string; models?: string[] }[] = [
    { id: 'alloy', name: 'Alloy' },
    { id: 'ash', name: 'Ash' },
    { id: 'ballad', name: 'Ballad', models: [DEFAULT_MODEL] },
    { id: 'cedar', name: 'Cedar', models: [DEFAULT_MODEL] },
    { id: 'coral', name: 'Coral' },
    { id: 'echo', name: 'Echo' },
    { id: 'fable', name: 'Fable' },
    { id: 'marin', name: 'Marin', models: [DEFAULT_MODEL] },
    { id: 'nova', name: 'Nova' },
    { id: 'onyx', name: 'Onyx' },
    { id: 'sage', name: 'Sage' },
    { id: 'shimmer', name: 'Shimmer' },
    { id: 'verse', name: 'Verse', models: [DEFAULT_MODEL] },
];

const OPENAI_TTS_MODELS = [
    {
        id: DEFAULT_MODEL,
        name: 'GPT-4o mini TTS',
        pricing_per_million_chars: 15,
    },
    {
        id: 'tts-1',
        name: 'TTS 1',
        pricing_per_million_chars: 15,
    },
    {
        id: 'tts-1-hd',
        name: 'TTS 1 HD',
        pricing_per_million_chars: 30,
    },
];

/**
 * OpenAI TTS provider. Wraps the OpenAI speech synthesis API and returns audio
 * as a DriverStreamResult.
 */
export class OpenAITTSProvider implements ITTSProvider {
    readonly providerName = 'openai';

    private openai: OpenAI;

    constructor(
        private readonly meteringService: AiMeteringService,
        config: { apiKey: string },
    ) {
        this.openai = new OpenAI({ apiKey: config.apiKey });
    }

    async listVoices(): Promise<ITTSVoice[]> {
        return OPENAI_TTS_VOICES.map((voice) => ({
            id: voice.id,
            name: voice.name,
            language: {
                name: 'English',
                code: 'en',
            },
            provider: 'openai',
            supported_models:
                voice.models ?? OPENAI_TTS_MODELS.map((m) => m.id),
        }));
    }

    async listEngines(): Promise<ITTSEngine[]> {
        return OPENAI_TTS_MODELS.map((model) => ({
            id: model.id,
            name: model.name,
            pricing_per_million_chars: model.pricing_per_million_chars,
            provider: 'openai',
        }));
    }

    getReportedCosts(): Record<string, unknown>[] {
        return [
            ...characterCostReport('openai', OPENAI_TTS_COSTS),
            ...Object.entries(OPENAI_TTS_TOKEN_COSTS).flatMap(
                ([model, costs]) =>
                    (
                        [
                            ['input', costs.input],
                            ['output:audio', costs.outputAudio],
                        ] as const
                    ).map(([kind, ucentsPerUnit]) => ({
                        usageType: `openai:${model}:${kind}`,
                        ucentsPerUnit,
                        unit: 'token',
                        source: 'driver:aiTts/openai',
                    })),
            ),
        ];
    }

    async synthesize(
        args: ISynthesizeArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const {
            text,
            voice: voiceArg,
            model: modelArg,
            response_format,
            instructions,
            test_mode,
        } = args;

        if (test_mode) {
            return { url: SAMPLE_AUDIO_URL, content_type: 'audio' };
        }

        if (typeof text !== 'string' || text.trim() === '') {
            throw new HttpError(400, 'Missing required field: text', {
                legacyCode: 'field_required',
                fields: { key: 'text' },
            });
        }

        const model = modelArg || DEFAULT_MODEL;
        if (!OPENAI_TTS_MODELS.find(({ id }) => id === model)) {
            throw new HttpError(
                400,
                `Invalid model: ${model}. Expected: ${OPENAI_TTS_MODELS.map(({ id }) => id).join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'model',
                        expected: OPENAI_TTS_MODELS.map(({ id }) => id).join(
                            ', ',
                        ),
                        got: model,
                    },
                },
            );
        }

        const voice = voiceArg || DEFAULT_VOICE;
        const voiceEntry = OPENAI_TTS_VOICES.find(({ id }) => id === voice);
        if (!voiceEntry) {
            throw new HttpError(
                400,
                `Invalid voice: ${voice}. Expected: ${OPENAI_TTS_VOICES.map(({ id }) => id).join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'voice',
                        expected: OPENAI_TTS_VOICES.map(({ id }) => id).join(
                            ', ',
                        ),
                        got: voice,
                    },
                },
            );
        }

        if (voiceEntry.models && !voiceEntry.models.includes(model)) {
            throw new HttpError(
                400,
                `Voice ${voice} is not supported by ${model}. Expected: ${voiceEntry.models.join(', ')}`,
                {
                    legacyCode: 'field_invalid',
                    fields: {
                        key: 'voice',
                        expected: voiceEntry.models.join(', '),
                        got: voice,
                    },
                },
            );
        }

        const format = response_format || 'mp3';
        const contentType =
            RESPONSE_CONTENT_TYPES[format] || RESPONSE_CONTENT_TYPES.mp3;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = { model, voice, input: text };
        if (instructions) payload.instructions = instructions;
        if (response_format) payload.response_format = response_format;

        const actor = Context.get('actor')!;
        const tokenCosts = OPENAI_TTS_TOKEN_COSTS[model];
        if (tokenCosts)
            return this.#synthesizeByTokens(
                actor,
                payload,
                contentType,
                tokenCosts,
                text.length + (instructions?.length ?? 0),
            );

        return meterPerCharacter(
            this.meteringService,
            actor,
            `openai:${model}:character`,
            OPENAI_TTS_COSTS[model] ?? 0,
            text,
            async () => {
                const response = await this.openai.audio.speech.create(payload);
                return {
                    dataType: 'stream',
                    content_type: contentType,
                    chunked: true,
                    stream: upstreamBodyStream(response),
                };
            },
        );
    }

    /**
     * Streams a model OpenAI bills by token as server-sent events and charges
     * the tokens its final event reports. The hold is the per-character rate on
     * the text and instructions; a stream that ends without usage, as when the
     * caller hangs up, is charged that hold.
     */
    #synthesizeByTokens(
        actor: Actor,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: any,
        contentType: string,
        costs: { input: number; outputAudio: number },
        characters: number,
    ): Promise<DriverStreamResult> {
        const model: string = payload.model;
        const held = (OPENAI_TTS_COSTS[model] ?? 0) * characters;
        let reportUsage!: (usage: SpeechUsage | undefined) => void;
        const usage = new Promise<SpeechUsage | undefined>((resolve) => {
            reportUsage = resolve;
        });
        return withStreamedAiCharge(
            this.meteringService,
            actor,
            `openai:${model}:character`,
            held,
            async () => {
                const response = await this.openai.audio.speech.create({
                    ...payload,
                    stream_format: 'sse',
                });
                return {
                    dataType: 'stream',
                    content_type: contentType,
                    chunked: true,
                    stream: pipeline(
                        upstreamBodyStream(response),
                        speechEventAudio(reportUsage),
                        () => {},
                    ),
                };
            },
            async () => {
                const reported = await usage;
                const input = tokenCount(reported?.input_tokens);
                const output = tokenCount(reported?.output_tokens);
                if (input === undefined || output === undefined)
                    return this.meteringService.incrementUsage(
                        actor,
                        `openai:${model}:character`,
                        characters,
                        held,
                    );
                return this.meteringService.batchIncrementUsages(
                    actor,
                    [
                        {
                            usageType: `openai:${model}:input`,
                            usageAmount: input,
                            costOverride: input * costs.input,
                        },
                        {
                            usageType: `openai:${model}:output:audio`,
                            usageAmount: output,
                            costOverride: output * costs.outputAudio,
                        },
                    ].filter((line) => line.usageAmount > 0),
                );
            },
        );
    }
}
