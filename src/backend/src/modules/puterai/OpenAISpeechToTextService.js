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

const BaseService = require('../../services/BaseService');
const APIError = require('../../api/APIError');
const { Context } = require('../../util/context');
const { FileFacade } = require('../../services/drivers/FileFacade');

const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per OpenAI limits
const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_TRANSLATE_MODEL = 'whisper-1';
const SAMPLE_TRANSCRIPT = {
    text: 'Hello! This is a sample transcription returned while test mode is enabled.',
    language: 'en',
    duration_seconds: 2,
    words: [
        { start: 0.0, end: 0.5, text: 'Hello' },
        { start: 0.5, end: 0.9, text: '!' },
        { start: 1.1, end: 2.0, text: 'This is a sample transcription.' },
    ],
};

const TRANSCRIPTION_MODEL_CAPABILITIES = {
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
        requiresChunkingOverThirtySeconds: true,
        diarization: true,
    },
    'whisper-1': {
        canPrompt: true,
        canLogprobs: false,
        responseFormats: ['json', 'text', 'srt', 'verbose_json', 'vtt'],
        timestampGranularities: true,
    },
};

class OpenAISpeechToTextService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService() {
        return this.services.get('meteringService').meteringService;
    }

    static MODULES = {
        openai: require('openai'),
        musicMetadata: require('music-metadata'),
        mime: require('mime-types'),
        path: require('path'),
    };

    async _init() {
        let apiKey =
            this.config?.services?.openai?.apiKey ??
            this.global_config?.services?.openai?.apiKey;

        if ( !apiKey ) {
            apiKey =
                this.config?.openai?.secret_key ??
                this.global_config.openai?.secret_key;

            if ( apiKey ) {
                console.warn('The `openai.secret_key` configuration format is deprecated. ' +
                    'Please use `services.openai.apiKey` instead.');
            }
        }

        if ( !apiKey ) {
            throw new Error('OpenAI API key not configured');
        }

        this.openai = new this.modules.openai.OpenAI({ apiKey });
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode(iface, method_name) {
                return iface === 'puter-speech2txt' &&
                    (method_name === 'transcribe' || method_name === 'translate');
            },
        },
        ['puter-speech2txt']: {
            async list_models() {
                return this.listModels();
            },
            async transcribe(params) {
                return this._handleTranscription({ ...params, translate: false });
            },
            async translate(params) {
                return this._handleTranscription({ ...params, translate: true });
            },
        },
    };

    listModels() {
        return [
            {
                id: 'gpt-4o-mini-transcribe',
                name: 'GPT-4o mini (Transcribe)',
                type: 'transcription',
                response_formats: TRANSCRIPTION_MODEL_CAPABILITIES['gpt-4o-mini-transcribe'].responseFormats,
                supports_prompt: true,
                supports_logprobs: true,
            },
            {
                id: 'gpt-4o-transcribe',
                name: 'GPT-4o (Transcribe)',
                type: 'transcription',
                response_formats: TRANSCRIPTION_MODEL_CAPABILITIES['gpt-4o-transcribe'].responseFormats,
                supports_prompt: true,
                supports_logprobs: true,
            },
            {
                id: 'gpt-4o-transcribe-diarize',
                name: 'GPT-4o (Transcribe + Diarization)',
                type: 'transcription',
                response_formats: TRANSCRIPTION_MODEL_CAPABILITIES['gpt-4o-transcribe-diarize'].responseFormats,
                supports_prompt: false,
                supports_logprobs: false,
                supports_diarization: true,
            },
            {
                id: 'whisper-1',
                name: 'Whisper 1',
                type: 'translation',
                response_formats: TRANSCRIPTION_MODEL_CAPABILITIES['whisper-1'].responseFormats,
                supports_prompt: true,
                supports_logprobs: false,
                supports_timestamp_granularities: true,
            },
        ];
    }

    async _handleTranscription({
        file,
        translate = false,
        model,
        response_format,
        language,
        prompt,
        temperature,
        logprobs,
        timestamp_granularities,
        chunking_strategy,
        known_speaker_names,
        known_speaker_references,
        extra_body,
        stream,
        test_mode,
    }) {
        if ( test_mode ) {
            return {
                ...SAMPLE_TRANSCRIPT,
                model: model || (translate ? DEFAULT_TRANSLATE_MODEL : DEFAULT_TRANSCRIBE_MODEL),
            };
        }

        if ( stream ) {
            throw APIError.create('not_yet_supported', null, {
                message: 'Streaming transcription is not yet supported.',
            });
        }

        if ( !file ) {
            throw APIError.create('field_missing', null, { key: 'file' });
        }

        if ( ! (file instanceof FileFacade) ) {
            throw APIError.create('field_invalid', null, {
                key: 'file',
                expected: 'file reference',
            });
        }

        const {
            buffer,
            filename,
            mimeType,
            estimatedSeconds,
        } = await this._prepareAudioBuffer(file);

        const selectedModel = model || (translate ? DEFAULT_TRANSLATE_MODEL : DEFAULT_TRANSCRIBE_MODEL);
        const capabilities = TRANSCRIPTION_MODEL_CAPABILITIES[selectedModel];

        if ( !capabilities ) {
            throw APIError.create('field_invalid', null, {
                key: 'model',
                expected: Object.keys(TRANSCRIPTION_MODEL_CAPABILITIES).join(', '),
                got: selectedModel,
            });
        }

        if ( response_format && !capabilities.responseFormats.includes(response_format) ) {
            throw APIError.create('field_invalid', null, {
                key: 'response_format',
                expected: capabilities.responseFormats.join(', '),
                got: response_format,
            });
        }

        if ( prompt && !capabilities.canPrompt ) {
            throw APIError.create('field_invalid', null, {
                key: 'prompt',
                expected: `Not supported for model ${selectedModel}`,
            });
        }

        if ( logprobs && !capabilities.canLogprobs ) {
            throw APIError.create('field_invalid', null, {
                key: 'logprobs',
                expected: `Not supported for model ${selectedModel}`,
            });
        }

        if ( timestamp_granularities && !capabilities.timestampGranularities ) {
            throw APIError.create('field_invalid', null, {
                key: 'timestamp_granularities',
                expected: `Only supported on models that provide timestamp granularity (such as whisper-1).`,
            });
        }

        let diarizationChunkingStrategy = chunking_strategy;
        if ( capabilities.diarization ) {
            if ( !response_format ) {
                response_format = 'diarized_json';
            }
            if ( !diarizationChunkingStrategy && capabilities.requiresChunkingOverThirtySeconds && estimatedSeconds > 30 ) {
                diarizationChunkingStrategy = 'auto';
            }
        }

        const actor = Context.get('actor');
        const usageType = `openai:${selectedModel}:second`;
        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageType, estimatedSeconds);

        if ( !usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const openaiFile = await this.modules.openai.toFile(
            buffer,
            filename,
            mimeType ? { type: mimeType } : undefined,
        );

        const payload = {
            file: openaiFile,
            model: selectedModel,
        };

        if ( response_format ) payload.response_format = response_format;
        if ( language ) payload.language = language;
        if ( typeof temperature === 'number' ) payload.temperature = temperature;
        if ( prompt && capabilities.canPrompt ) payload.prompt = prompt;
        if ( logprobs && capabilities.canLogprobs ) payload.logprobs = logprobs;
        if ( timestamp_granularities && capabilities.timestampGranularities ) payload.timestamp_granularities = timestamp_granularities;
        if ( diarizationChunkingStrategy ) payload.chunking_strategy = diarizationChunkingStrategy;

        if ( capabilities.diarization && (known_speaker_names || known_speaker_references) ) {
            payload.extra_body = {
                ...(extra_body || {}),
                ...(known_speaker_names ? { known_speaker_names } : {}),
                ...(known_speaker_references ? { known_speaker_references } : {}),
            };
        } else if ( extra_body ) {
            payload.extra_body = extra_body;
        }

        let transcription;
        if ( translate ) {
            transcription = await this.openai.audio.translations.create(payload);
        } else {
            transcription = await this.openai.audio.transcriptions.create(payload);
        }

        this.meteringService.incrementUsage(actor, usageType, estimatedSeconds);

        return this._formatResponse(transcription, response_format);
    }

    async _prepareAudioBuffer(file) {
        const buffer = await file.get('buffer');
        if ( !buffer || !buffer.length ) {
            throw APIError.create('field_invalid', null, {
                key: 'file',
                expected: 'non-empty audio file',
            });
        }

        if ( buffer.length > MAX_AUDIO_FILE_SIZE ) {
            throw APIError.create('file_too_large', null, {
                max_size: MAX_AUDIO_FILE_SIZE,
            });
        }

        let filename = 'audio';
        let mimeType;

        const pathValue = await file.get('path');
        if ( pathValue ) {
            filename = this.modules.path.basename(pathValue);
        } else {
            const url = await file.get('web_url');
            if ( url ) {
                try {
                    const parsed = new URL(url);
                    const candidate = this.modules.path.basename(parsed.pathname);
                    if ( candidate ) filename = candidate;
                } catch (_) {
                    // Ignore URL parsing errors; we'll fall back to defaults.
                }
            }
        }

        const dataUrl = await file.get('data_url');
        if ( dataUrl ) {
            const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
            if ( match ) {
                mimeType = match[1];
            }
        }

        if ( !mimeType ) {
            const guessedMime = this.modules.mime.lookup(filename);
            if ( guessedMime ) {
                mimeType = guessedMime;
            }
        }

        if ( !filename.includes('.') ) {
            const extension = mimeType ? this.modules.mime.extension(mimeType) : 'mp3';
            filename = `${filename}.${extension || 'mp3'}`;
        }

        let estimatedSeconds = Math.ceil(buffer.length / 16000);
        try {
            const metadata = await this.modules.musicMetadata.parseBuffer(buffer, {
                mimeType,
                size: buffer.length,
            });
            if ( metadata?.format?.duration ) {
                estimatedSeconds = Math.ceil(metadata.format.duration);
            }
        } catch (e) {
            // When metadata parsing fails we fall back to the byte-size estimate.
            if ( process.env.DEBUG_AUDIO_METADATA === '1' ) {
                console.warn('Failed to parse audio metadata for duration estimation:', e.message);
            }
        }

        estimatedSeconds = Math.max(1, estimatedSeconds);

        return {
            buffer,
            filename,
            mimeType,
            estimatedSeconds,
        };
    }

    _formatResponse(result, response_format) {
        if ( response_format === 'text' && typeof result === 'string' ) {
            return result;
        }
        if ( typeof result === 'string' ) {
            return result;
        }
        if ( response_format === 'text' && result && typeof result.text === 'string' ) {
            return result.text;
        }
        return result;
    }
}

module.exports = {
    OpenAISpeechToTextService,
};
