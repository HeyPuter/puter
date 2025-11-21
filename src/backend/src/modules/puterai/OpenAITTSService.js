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

const { Readable } = require('stream');
const APIError = require('../../api/APIError');
const BaseService = require('../../services/BaseService');
const { TypedValue } = require('../../services/drivers/meta/Runtime');
const { Context } = require('../../util/context');

const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'alloy';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';

const RESPONSE_CONTENT_TYPES = {
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
 * Service that connects the puter-tts driver interface with OpenAI Text-to-Speech API.
 * Provides voice synthesis, engine discovery, and test-mode behaviour consistent with
 * the AWS Polly implementation.
 */
class OpenAITTSService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService () {
        return this.services.get('meteringService').meteringService;
    }

    static MODULES = {
        openai: require('openai'),
    };

    async _init () {
        let apiKey =
            this.config?.services?.openai?.apiKey ??
            this.global_config?.services?.openai?.apiKey;

        if ( ! apiKey ) {
            apiKey =
                this.config?.openai?.secret_key ??
                this.global_config.openai?.secret_key;

            if ( apiKey ) {
                console.warn('The `openai.secret_key` configuration format is deprecated. ' +
                    'Please use `services.openai.apiKey` instead.');
            }
        }

        if ( ! apiKey ) {
            throw new Error('OpenAI API key not configured');
        }

        this.openai = new this.modules.openai.OpenAI({ apiKey });
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-tts' && method_name === 'synthesize';
            },
        },
        ['puter-tts']: {
            async list_voices ({ provider } = {}) {
                if ( provider && provider !== 'openai' ) {
                    return [];
                }

                return OPENAI_TTS_VOICES.map((voice) => ({
                    id: voice.id,
                    name: voice.name,
                    language: {
                        name: 'English',
                        code: 'en',
                    },
                    provider: 'openai',
                    supported_models: OPENAI_TTS_MODELS.map(model => model.id),
                }));
            },
            async list_engines ({ provider } = {}) {
                if ( provider && provider !== 'openai' ) {
                    return [];
                }

                return OPENAI_TTS_MODELS.map(model => ({
                    id: model.id,
                    name: model.name,
                    pricing_per_million_chars: model.pricing_per_million_chars,
                    provider: 'openai',
                }));
            },
            async synthesize (params) {
                return this.synthesize(params);
            },
        },
    };

    async synthesize ({
        text,
        voice,
        model,
        response_format,
        instructions,
        test_mode,
    }) {
        if ( test_mode ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'audio',
            }, SAMPLE_AUDIO_URL);
        }

        if ( typeof text !== 'string' || text.trim() === '' ) {
            throw APIError.create('field_required', null, { key: 'text' });
        }

        model = model || DEFAULT_MODEL;
        if ( ! OPENAI_TTS_MODELS.find(({ id }) => id === model) ) {
            throw APIError.create('field_invalid', null, {
                key: 'model',
                expected: OPENAI_TTS_MODELS.map(({ id }) => id).join(', '),
                got: model,
            });
        }

        voice = voice || DEFAULT_VOICE;
        if ( ! OPENAI_TTS_VOICES.find(({ id }) => id === voice) ) {
            throw APIError.create('field_invalid', null, {
                key: 'voice',
                expected: OPENAI_TTS_VOICES.map(({ id }) => id).join(', '),
                got: voice,
            });
        }

        const format = response_format || 'mp3';
        const contentType = RESPONSE_CONTENT_TYPES[format] || RESPONSE_CONTENT_TYPES.mp3;

        const actor = Context.get('actor');
        const usageType = `openai:${model}:character`;

        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageType, text.length);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const payload = {
            model,
            voice,
            input: text,
        };

        if ( instructions ) {
            payload.instructions = instructions;
        }

        if ( response_format ) {
            payload.response_format = response_format;
        }

        const response = await this.openai.audio.speech.create(payload);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const stream = Readable.from(buffer);

        this.meteringService.incrementUsage(actor, usageType, text.length);

        return new TypedValue({
            $: 'stream',
            content_type: contentType,
        }, stream);
    }
}

module.exports = {
    OpenAITTSService,
};
