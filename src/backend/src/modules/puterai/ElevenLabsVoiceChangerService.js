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
const { FileFacade } = require('../../services/drivers/FileFacade');
const { Context } = require('../../util/context');

const DEFAULT_MODEL = 'eleven_multilingual_sts_v2';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';
const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

/**
 * ElevenLabs voice changer (speech-to-speech).
 */
class ElevenLabsVoiceChangerService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService () {
        return this.services.get('meteringService').meteringService;
    }

    static MODULES = {
        mime: require('mime-types'),
        musicMetadata: require('music-metadata'),
        path: require('path'),
    };

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-speech2speech' && method_name === 'convert';
            },
        },
        ['puter-speech2speech']: {
            async convert (params) {
                return this.convert(params);
            },
        },
    };

    async _init () {
        const svcConfig = this.global_config?.services?.elevenlabs ??
            this.config?.services?.elevenlabs ??
            this.config?.elevenlabs;

        this.apiKey = svcConfig?.apiKey ?? svcConfig?.api_key ?? svcConfig?.key;
        this.baseUrl = svcConfig?.baseUrl ?? 'https://api.elevenlabs.io';
        this.defaultVoiceId = svcConfig?.defaultVoiceId ?? svcConfig?.voiceId ?? DEFAULT_VOICE_ID;
        this.defaultModelId = svcConfig?.speechToSpeechModelId ?? svcConfig?.stsModelId ?? DEFAULT_MODEL;

        if ( !this.apiKey ) {
            throw new Error('ElevenLabs API key not configured');
        }
    }

    async convert (params) {
        const {
            audio,
            voice,
            voice_id,
            voiceId,
            model,
            model_id,
            voice_settings,
            voiceSettings,
            seed,
            remove_background_noise,
            output_format,
            file_format,
            optimize_streaming_latency,
            enable_logging,
            test_mode,
        } = params ?? {};

        if ( test_mode ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'audio',
            }, SAMPLE_AUDIO_URL);
        }

        if ( !audio ) {
            throw APIError.create('field_required', null, { key: 'audio' });
        }

        if ( !(audio instanceof FileFacade) ) {
            throw APIError.create('field_invalid', null, {
                key: 'audio',
                expected: 'file reference',
            });
        }

        const {
            buffer,
            filename,
            mimeType,
            estimatedSeconds,
        } = await this._prepareAudioBuffer(audio);

        const modelId = model_id || model || this.defaultModelId || DEFAULT_MODEL;
        const selectedVoiceId = voice_id || voiceId || voice || this.defaultVoiceId;

        if ( !selectedVoiceId ) {
            throw APIError.create('field_required', null, { key: 'voice' });
        }

        const actor = Context.get('actor');
        const usageKey = `elevenlabs:${modelId}:second`;
        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageKey, estimatedSeconds);
        if ( !usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const formData = new FormData();
        const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
        formData.append('audio', blob, filename);
        formData.append('model_id', modelId);

        const mergedVoiceSettings = voice_settings ?? voiceSettings;
        if ( mergedVoiceSettings !== undefined && mergedVoiceSettings !== null ) {
            const serializedSettings = typeof mergedVoiceSettings === 'string'
                ? mergedVoiceSettings
                : JSON.stringify(mergedVoiceSettings);
            formData.append('voice_settings', serializedSettings);
        }

        if ( seed !== undefined && seed !== null ) {
            formData.append('seed', seed);
        }

        if ( typeof remove_background_noise === 'boolean' ) {
            formData.append('remove_background_noise', String(remove_background_noise));
        }

        if ( file_format ) {
            formData.append('file_format', file_format);
        }

        const searchParams = new URLSearchParams();
        const desiredOutputFormat = output_format || DEFAULT_OUTPUT_FORMAT;
        if ( desiredOutputFormat ) {
            searchParams.set('output_format', desiredOutputFormat);
        }
        if ( optimize_streaming_latency !== undefined && optimize_streaming_latency !== null ) {
            searchParams.set('optimize_streaming_latency', optimize_streaming_latency);
        }
        if ( enable_logging !== undefined && enable_logging !== null ) {
            searchParams.set('enable_logging', enable_logging);
        }

        const url = new URL(`/v1/speech-to-speech/${selectedVoiceId}`, this.baseUrl);
        const search = searchParams.toString();
        if ( search ) {
            url.search = search;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'xi-api-key': this.apiKey,
            },
            body: formData,
        });

        if ( !response.ok ) {
            let detail = null;
            try {
                detail = await response.json();
            } catch ( e ) {
                // ignore
            }
            this.log.error('ElevenLabs voice changer request failed', {
                status: response.status,
                detail,
            });
            throw APIError.create('internal_server_error', null, {
                provider: 'elevenlabs',
                status: response.status,
            });
        }

        const arrayBuffer = await response.arrayBuffer();
        const responseBuffer = Buffer.from(arrayBuffer);
        const stream = Readable.from(responseBuffer);

        this.meteringService.incrementUsage(actor, usageKey, estimatedSeconds);

        return new TypedValue({
            $: 'stream',
            content_type: response.headers.get('content-type') || 'audio/mpeg',
        }, stream);
    }

    async _prepareAudioBuffer (file) {
        const buffer = await file.get('buffer');
        if ( !buffer || !buffer.length ) {
            throw APIError.create('field_invalid', null, {
                key: 'audio',
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

        if ( ! mimeType ) {
            const guessedMime = this.modules.mime.lookup(filename);
            if ( guessedMime ) {
                mimeType = guessedMime;
            }
        }

        if ( ! filename.includes('.') ) {
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
}

module.exports = {
    ElevenLabsVoiceChangerService,
};
