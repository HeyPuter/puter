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

const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Common public "Rachel" sample voice
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const SAMPLE_AUDIO_URL = 'https://puter-sample-data.puter.site/tts_example.mp3';

const ELEVENLABS_TTS_MODELS = [
    { id: DEFAULT_MODEL, name: 'Eleven Multilingual v2' },
    { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5' },
    { id: 'eleven_turbo_v2_5', name: 'Eleven Turbo v2.5' },
    { id: 'eleven_v3', name: 'Eleven v3 Alpha' },
];

/**
 * ElevenLabs text-to-speech provider.
 * Implements the `puter-tts` interface so the AI module can synthesize speech
 * using ElevenLabs voices.
 */
class ElevenLabsTTSService extends BaseService {
    /** @type {import('../../services/MeteringService/MeteringService').MeteringService} */
    get meteringService () {
        return this.services.get('meteringService').meteringService;
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-tts' && method_name === 'synthesize';
            },
        },
        ['puter-tts']: {
            async list_voices () {
                return this.listVoices();
            },
            async list_engines () {
                return this.listEngines();
            },
            async synthesize (params) {
                return this.synthesize(params);
            },
        },
    };

    async _init () {
        const svcThere = this.global_config?.services?.elevenlabs ?? this.config?.services?.elevenlabs ?? this.config?.elevenlabs;

        this.apiKey = svcThere?.apiKey ?? svcThere?.api_key ?? svcThere?.key;
        this.baseUrl = svcThere?.baseUrl ?? 'https://api.elevenlabs.io';
        this.defaultVoiceId = svcThere?.defaultVoiceId ?? svcThere?.voiceId ?? DEFAULT_VOICE_ID;

        if ( !this.apiKey ) {
            throw new Error('ElevenLabs API key not configured');
        }
    }

    async request (path, { method = 'GET', body, headers = {} } = {}) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                'xi-api-key': this.apiKey,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if ( response.ok ) {
            return response;
        }

        let detail = null;
        try {
            detail = await response.json();
        } catch ( e ) {
            // ignore
        }
        this.log.error('ElevenLabs request failed', { path, status: response.status, detail });
        throw APIError.create('internal_server_error', null, { provider: 'elevenlabs', status: response.status });
    }

    async listVoices () {
        const res = await this.request('/v1/voices');
        const data = await res.json();
        const voices = Array.isArray(data?.voices) ? data.voices : Array.isArray(data) ? data : [];

        return voices
            .map(voice => ({
                id: voice.voice_id || voice.voiceId || voice.id,
                name: voice.name,
                description: voice.description,
                category: voice.category,
                provider: 'elevenlabs',
                labels: voice.labels,
                supported_models: ELEVENLABS_TTS_MODELS.map(model => model.id),
            }))
            .filter(v => v.id && v.name);
    }

    async listEngines () {
        return ELEVENLABS_TTS_MODELS.map(model => ({
            id: model.id,
            name: model.name,
            provider: 'elevenlabs',
            pricing_per_million_chars: 0,
        }));
    }

    async synthesize (params) {
        const {
            text,
            voice,
            model,
            response_format,
            output_format,
            voice_settings,
            voiceSettings,
            test_mode,
        } = params;
        if ( test_mode ) {
            return new TypedValue({
                $: 'string:url:web',
                content_type: 'audio',
            }, SAMPLE_AUDIO_URL);
        }

        if ( typeof text !== 'string' || !text.trim() ) {
            throw APIError.create('field_required', null, { key: 'text' });
        }

        const voiceId = voice || this.defaultVoiceId;
        const modelId = model || DEFAULT_MODEL;
        const desiredFormat = output_format || response_format || DEFAULT_OUTPUT_FORMAT;

        const actor = Context.get('actor');
        const usageKey = `elevenlabs:${modelId}:character`;
        const usageAllowed = await this.meteringService.hasEnoughCreditsFor(actor, usageKey, text.length);
        if ( !usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        const payload = {
            text,
            model_id: modelId,
            output_format: desiredFormat,
        };

        const finalVoiceSettings = voice_settings ?? voiceSettings;
        if ( finalVoiceSettings ) {
            payload.voice_settings = finalVoiceSettings;
        }

        const response = await this.request(`/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            body: payload,
        });

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const stream = Readable.from(buffer);

        this.meteringService.incrementUsage(actor, usageKey, text.length);

        return new TypedValue({
            $: 'stream',
            content_type: response.headers.get('content-type') || 'audio/mpeg',
        }, stream);
    }
}

module.exports = {
    ElevenLabsTTSService,
};
