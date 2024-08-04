const BaseService = require("../../services/BaseService");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { Context } = require("../../util/context");

class OpenAIImageGenerationService extends BaseService {
    static MODULES = {
        openai: require('openai'),
    }
    async _init () {
        const sk_key =
            this.config?.openai?.secret_key ??
            this.global_config.openai?.secret_key;

        this.openai = new this.modules.openai.OpenAI({
            apiKey: sk_key
        });
    }

    static IMPLEMENTS = {
        ['puter-image-generation']: {
            async generate ({ prompt, test_mode }) {
                if ( test_mode ) {
                    return new TypedValue({
                        $: 'string:url:web',
                        content_type: 'image',
                    }, 'https://puter-sample-data.puter.site/image_example.png');
                }

                const url = await this.generate(prompt, {
                    ratio: this.constructor.RATIO_SQUARE,
                });

                const image = new TypedValue({
                    $: 'string:url:web',
                    content_type: 'image'
                }, url);

                return image;
            }
        }
    };

    static RATIO_SQUARE = { w: 1024, h: 1024 };
    static RATIO_PORTRAIT = { w: 1024, h: 1792 };
    static RATIO_LANDSCAPE = { w: 1792, h: 1024 };

    async generate (prompt, {
        ratio,
        model,
    }) {
        if ( typeof prompt !== 'string' ) {
            throw new Error('`prompt` must be a string');
        }

        if ( ! ratio || ! this._validate_ratio(ratio) ) {
            throw new Error('`ratio` must be a valid ratio');
        }

        model = model ?? 'dall-e-3';

        const user_private_uid = Context.get('actor')?.private_uid ?? 'UNKNOWN';
        if ( user_private_uid === 'UNKNOWN' ) {
            this.errors.report('chat-completion-service:unknown-user', {
                message: 'failed to get a user ID for an OpenAI request',
                alarm: true,
                trace: true,
            });
        }

        const result =
            await this.openai.images.generate({
                user: user_private_uid,
                prompt,
                size: `${ratio.w}x${ratio.h}`,
            });

        const spending_meta = {
            model,
            size: `${ratio.w}x${ratio.h}`,
        };

        const svc_spending = Context.get('services').get('spending');
        svc_spending.record_spending('openai', 'image-generation', spending_meta);

        const url = result.data?.[0]?.url;
        return url;
    }

    _validate_ratio (ratio) {
        return false
            || ratio === this.constructor.RATIO_SQUARE
            || ratio === this.constructor.RATIO_PORTRAIT
            || ratio === this.constructor.RATIO_LANDSCAPE
            ;
    }
}

module.exports = {
    OpenAIImageGenerationService,
};
