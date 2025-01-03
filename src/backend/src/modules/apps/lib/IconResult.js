const { stream_to_buffer } = require("../../../util/streamutil");

module.exports = class IconResult {
    constructor (o) {
        Object.assign(this, o);
    }

    async get_data_url () {
        if ( this.data_url ) {
            return this.data_url;
        } else {
            try {
                const buffer = await stream_to_buffer(this.stream);
                return `data:${this.mime};base64,${buffer.toString('base64')}`;
            } catch (e) {
                const svc_error = Context.get(undefined, {
                    allow_fallback: true,
                }).get('services').get('error');
                svc_error.report('IconResult:get_data_url', {
                    source: e,
                });
                // TODO: broken image icon here
                return `data:image/png;base64,${Buffer.from([]).toString('base64')}`;
            }
        }
    }
};
