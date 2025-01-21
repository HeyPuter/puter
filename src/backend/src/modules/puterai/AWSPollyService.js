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

// METADATA // {"ai-commented":{"service":"claude"}}
const { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand } = require("@aws-sdk/client-polly");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");


/**
* AWSPollyService class provides text-to-speech functionality using Amazon Polly.
* Extends BaseService to integrate with AWS Polly for voice synthesis operations.
* Implements voice listing, speech synthesis, and voice selection based on language.
* Includes caching for voice descriptions and supports both text and SSML inputs.
* @extends BaseService
*/
class AWSPollyService extends BaseService {
    static MODULES = {
        kv: globalThis.kv,
    }


    /**
    * Initializes the service by creating an empty clients object.
    * This method is called during service construction to set up
    * the internal state needed for AWS Polly client management.
    * @returns {Promise<void>}
    */
    async _construct () {
        this.clients_ = {};
    }

    static IMPLEMENTS = {
        ['driver-capabilities']: {
            supports_test_mode (iface, method_name) {
                return iface === 'puter-tts' && method_name === 'synthesize';
            }
        },
        ['puter-tts']: {
            /**
            * Implements the driver interface methods for text-to-speech functionality
            * Contains methods for listing available voices and synthesizing speech
            * @interface
            * @property {Object} list_voices - Lists available Polly voices with language info
            * @property {Object} synthesize - Converts text to speech using specified voice/language
            * @property {Function} supports_test_mode - Indicates test mode support for methods
            */
            async list_voices () {
                const polly_voices = await this.describe_voices();

                let voices = polly_voices.Voices;

                voices = voices.map((voice) => ({
                    id: voice.Id,
                    name: voice.Name,
                    language: {
                        name: voice.LanguageName,
                        code: voice.LanguageCode,
                    },
                }))

                return voices;
            },
            async synthesize ({
                text, voice,
                ssml, language,
                test_mode,
            }) {
                if ( test_mode ) {
                    const url = 'https://puter-sample-data.puter.site/tts_example.mp3'
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'audio',
                    }, url);
                }
    
                const polly_speech = await this.synthesize_speech(text, {
                    format: 'mp3',
                    voice_id: voice,
                    text_type: ssml ? 'ssml' : 'text',
                    language,
                });
    
                const speech = new TypedValue({
                    $: 'stream',
                    content_type: 'audio/mpeg',
                }, polly_speech.AudioStream);
    
                return speech;
            }
        }
    }


    /**
    * Creates AWS credentials object for authentication
    * @private
    * @returns {Object} Object containing AWS access key ID and secret access key
    */
    _create_aws_credentials () {
        return {
            accessKeyId: this.config.aws.access_key,
            secretAccessKey: this.config.aws.secret_key,
        };
    }

    _get_client (region) {
        if ( ! region ) {
            region = this.config.aws?.region ?? this.global_config.aws?.region
                ?? 'us-west-2';
        }
        if ( this.clients_[region] ) return this.clients_[region];

        this.clients_[region] = new PollyClient({
            credentials: this._create_aws_credentials(),
            region,
        });

        return this.clients_[region];
    }


    /**
    * Describes available AWS Polly voices and caches the results
    * @returns {Promise<Object>} Response containing array of voice details in Voices property
    * @description Fetches voice information from AWS Polly API and caches it for 10 minutes
    * Uses KV store for caching to avoid repeated API calls
    */
    async describe_voices () {
        let voices = this.modules.kv.get('svc:polly:voices');
        if ( voices ) {
            this.log.debug('voices cache hit');
            return voices;
        }

        this.log.debug('voices cache miss');

        const client = this._get_client(this.config.aws.region);

        const params = {};

        const command = new DescribeVoicesCommand(params);

        const response = await client.send(command);

        this.modules.kv.set('svc:polly:voices', response);
        this.modules.kv.expire('svc:polly:voices', 60 * 10); // 10 minutes

        return response;
    }


    /**
    * Synthesizes speech from text using AWS Polly
    * @param {string} text - The text to synthesize
    * @param {Object} options - Synthesis options
    * @param {string} options.format - Output audio format (e.g. 'mp3')
    * @param {string} [options.voice_id] - AWS Polly voice ID to use
    * @param {string} [options.language] - Language code (e.g. 'en-US')
    * @param {string} [options.text_type] - Type of input text ('text' or 'ssml')
    * @returns {Promise<AWS.Polly.SynthesizeSpeechOutput>} The synthesized speech response
    */
    async synthesize_speech (text, { format, voice_id, language, text_type }) {
        const client = this._get_client(this.config.aws.region);

        let voice = voice_id ?? undefined

        if ( ! voice && language ) {
            this.log.debug('getting language appropriate voice', { language });
            voice = await this.maybe_get_language_appropriate_voice_(language);
        }

        if ( ! voice ) {
            voice = 'Salli';
        }

        this.log.debug('using voice', { voice });

        const params = {
            OutputFormat: format,
            Text: text,
            VoiceId: voice,
            LanguageCode: language ?? 'en-US',
            TextType: text_type ?? 'text',
        };

        const command = new SynthesizeSpeechCommand(params);

        const response = await client.send(command);

        return response;
    }


    /**
    * Attempts to find an appropriate voice for the given language code
    * @param {string} language - The language code to find a voice for (e.g. 'en-US')
    * @returns {Promise<?string>} The voice ID if found, null if no matching voice exists
    * @private
    */
    async maybe_get_language_appropriate_voice_ (language) {
        const voices = await this.describe_voices();

        const voice = voices.Voices.find((voice) => {
            return voice.LanguageCode === language;
        });

        if ( ! voice ) return null;

        return voice.Id;
    }
}

module.exports = {
    AWSPollyService,
};
