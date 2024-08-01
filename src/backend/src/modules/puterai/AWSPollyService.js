const { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand } = require("@aws-sdk/client-polly");
const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");

class AWSPollyService extends BaseService {
    static MODULES = {
        kv: globalThis.kv,
    }

    async _construct () {
        this.clients_ = {};
    }

    static IMPLEMENTS = {
        ['puter-tts']: {
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
