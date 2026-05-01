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

import OpenAI from 'openai';
import { Readable } from 'node:stream';
import { HttpError } from '../../../../core/http/HttpError.js';
import { Context } from '../../../../core/context.js';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { DriverStreamResult } from '../../../meta.js';
import type { ITTSVoice, ITTSEngine, ISynthesizeArgs } from '../../types.js';
import { TTSProvider } from '../TTSProvider.js';
import { OPENAI_TTS_COSTS } from './costs.js';

const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'alloy';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';

const RESPONSE_CONTENT_TYPES: Record<string, string> = {
    mp3: 'audio/mpeg',
    opus: 'audio/opus',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wav: 'audio/wav',
    pcm: 'audio/pcm',
};

const OPENAI_TTS_VOICES = [
    { id: 'alloy', name: 'Alloy' },
    { id: 'ash', name: 'Ash' },
    { id: 'ballad', name: 'Ballad' },
    { id: 'coral', name: 'Coral' },
    { id: 'echo', name: 'Echo' },
    { id: 'fable', name: 'Fable' },
    { id: 'nova', name: 'Nova' },
    { id: 'onyx', name: 'Onyx' },
    { id: 'sage', name: 'Sage' },
    { id: 'shimmer', name: 'Shimmer' },
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
 * OpenAI TTS provider. Wraps the OpenAI speech synthesis API and
 * returns audio as a DriverStreamResult.
 */
export class OpenAITTSProvider extends TTSProvider {
    readonly providerName = 'openai';

    private openai: OpenAI;

    constructor(meteringService: MeteringService, config: { apiKey: string }) {
        super(meteringService, config);
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
            supported_models: OPENAI_TTS_MODELS.map((m) => m.id),
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

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(OPENAI_TTS_COSTS).map(
            ([model, ucentsPerUnit]) => ({
                usageType: `openai:${model}:character`,
                ucentsPerUnit,
                unit: 'character',
                source: 'driver:aiTts/openai',
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
        if (!OPENAI_TTS_VOICES.find(({ id }) => id === voice)) {
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

        const format = response_format || 'mp3';
        const contentType =
            RESPONSE_CONTENT_TYPES[format] || RESPONSE_CONTENT_TYPES.mp3;

        const actor = Context.get('actor')!;
        const usageType = `openai:${model}:character`;
        const ucentsPerChar = OPENAI_TTS_COSTS[model] ?? 0;
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = {
            model,
            voice,
            input: text,
        };

        if (instructions) {
            payload.instructions = instructions;
        }

        if (response_format) {
            payload.response_format = response_format;
        }

        const response = await this.openai.audio.speech.create(payload);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const stream = Readable.from(buffer);

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
