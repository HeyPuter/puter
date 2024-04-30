const BaseService = require("../BaseService");

def = o => {
    for ( let k in o ) {
        if ( typeof o[k] === 'string' ) {
            o[k] = { short: o[k] };
        }
    }
    return {
        fullkey_to_info: o,
        short_to_fullkey: Object.keys(o).reduce((acc, key) => {
            acc[o[key].short] = key;
            return acc;
        }, {}),
    };
}

defv = o => {
    return {
        to_short: o,
        to_long: Object.keys(o).reduce((acc, key) => {
            acc[o[key]] = key;
            return acc;
        }, {}),
    };
};

const compression = {
    auth: def({
        uuid: 'u',
        type: {
            short: 't',
            values: defv({
                'session': 's',
                'access-token': 't',
                'app-under-user': 'au',
            }),
        },
        user_uid: 'uu',
        app_uid: 'au',
    }),
};

class TokenService extends BaseService {
    static MODULES = {
        jwt: require('jsonwebtoken'),
    };

    _construct () {
        this.compression = compression;
    }

    _init () {
        // TODO: move to service config
        this.secret = this.global_config.jwt_secret;
    }

    sign (scope, payload, options) {
        const require = this.require;

        const jwt = require('jwt');
        const secret = this.secret;

        const context = this.compression[scope];
        const compressed_payload = this._compress_payload(context, payload);

        return jwt.sign(compressed_payload, secret, options);
    }

    verify (scope, token) {
        const require = this.require;

        const jwt = require('jwt');
        const secret = this.secret;

        const context = this.compression[scope];
        const payload = jwt.verify(token, secret);

        return this._decompress_payload(context, payload);
    }

    _compress_payload (context, payload) {
        const fullkey_to_info = context.fullkey_to_info;

        const compressed = {};

        for ( let fullkey in payload ) {
            if ( ! fullkey_to_info[fullkey] ) {
                compressed[fullkey] = payload[fullkey];
                continue;
            }

            let k = fullkey, v = payload[fullkey];
            const compress_info = fullkey_to_info[fullkey];

            if ( compress_info.short ) k = compress_info.short;
            if ( compress_info.values && compress_info.values.to_short[v] ) {
                v = compress_info.values.to_short[v];
            }

            compressed[k] = v;
        }

        return compressed;
    }

    _decompress_payload (context, payload) {
        const fullkey_to_info = context.fullkey_to_info;
        const short_to_fullkey = context.short_to_fullkey;

        const decompressed = {};

        for ( let short in payload ) {
            if ( ! short_to_fullkey[short] ) {
                decompressed[short] = payload[short];
                continue;
            }

            let k = short, v = payload[short];
            const fullkey = short_to_fullkey[short];
            const compress_info = fullkey_to_info[fullkey];


            if ( compress_info.short ) k = fullkey;
            if ( compress_info.values && compress_info.values.to_long[v] ) {
                v = compress_info.values.to_long[v];
            }

            decompressed[k] = v;
        }

        return decompressed;
    }

    _test ({ assert }) {
        // Test compression
        {
            const context = this.compression.auth;
            const payload = {
                uuid: '123',
                type: 'session',
                user_uid: '456',
                app_uid: '789',
            };
            
            const compressed = this._compress_payload(context, payload);
            assert(() => compressed.u === '123');
            assert(() => compressed.t === 's');
            assert(() => compressed.uu === '456');
            assert(() => compressed.au === '789');
        }

        // Test decompression
        {
            const context = this.compression.auth;
            const payload = {
                u: '123',
                t: 's',
                uu: '456',
                au: '789',
            };
            
            const decompressed = this._decompress_payload(context, payload);
            assert(() => decompressed.uuid === '123');
            assert(() => decompressed.type === 'session');
            assert(() => decompressed.user_uid === '456');
            assert(() => decompressed.app_uid === '789');
        }
    }
}

module.exports = { TokenService };
