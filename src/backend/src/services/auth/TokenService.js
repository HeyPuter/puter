// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
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
const BaseService = require("../BaseService");

const def = o => {
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

const defv = o => {
    return {
        to_short: o,
        to_long: Object.keys(o).reduce((acc, key) => {
            acc[o[key]] = key;
            return acc;
        }, {}),
    };
};

const uuid_compression = prefix => ({
    encode: v => {
        if ( prefix ) {
            if ( ! v.startsWith(prefix) ) {
                throw new Error(`Expected ${prefix} prefix`);
            }
            v = v.slice(prefix.length);
        }

        const undecorated = v.replace(/-/g, "");
        const base64 = Buffer
            .from(undecorated, 'hex')
            .toString('base64');
        return base64;
    },
    decode: v => {
        // if already a uuid, return that
        if ( v.includes('-') ) return v;

        const undecorated = Buffer
            .from(v, 'base64')
            .toString('hex');
        return (prefix ?? '') + [
            undecorated.slice(0, 8),
            undecorated.slice(8, 12),
            undecorated.slice(12, 16),
            undecorated.slice(16, 20),
            undecorated.slice(20),
        ].join('-');
    }
});

const compression = {
    auth: def({
        uuid: {
            short: 'u',
            ...uuid_compression(),
        },
        session: {
            short: 's',
            ...uuid_compression(),
        },
        version: 'v',
        type: {
            short: 't',
            values: defv({
                'session': 's',
                'access-token': 't',
                'app-under-user': 'au',
            }),
        },
        user_uid: {
            short: 'uu',
            ...uuid_compression(),
        },
        app_uid: {
            short: 'au',
            ...uuid_compression('app-'),
        },
    }),
};


/**
* TokenService class for managing token creation and verification.
* This service extends the BaseService class and provides methods 
* for signing and verifying JWTs, as well as compressing and decompressing 
* payloads to and from a compact format.
*/
class TokenService extends BaseService {
    static MODULES = {
        jwt: require('jsonwebtoken'),
    };


    /**
     * Constructs a new TokenService instance and initializes the compression settings.
     * This method is called when a TokenService object is created.
     * 
     * @returns {void}
     */
    _construct () {
        this.compression = compression;
    }


    /**
     * Initializes the TokenService instance by setting the JWT secret
     * from the global configuration.
     * 
     * @function
     * @returns {void}
     * @throws {Error} Throws an error if the jwt_secret is not defined in global_config.
     */
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

        const decoded = this._decompress_payload(context, payload);
        return decoded;
    }

    _compress_payload (context, payload) {
        if ( ! context ) return payload;

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
            } else if ( compress_info.encode ) {
                v = compress_info.encode(v);
            }

            compressed[k] = v;
        }

        return compressed;
    }

    _decompress_payload (context, payload) {
        if ( ! context ) return payload;

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
            } else if ( compress_info.decode ) {
                v = compress_info.decode(v);
            }

            decompressed[k] = v;
        }

        return decompressed;
    }

    _test ({ assert }) {
        const U1 = '843f1d83-3c30-48c7-8964-62aff1a912d0';
        const U2 = '42e9c36b-8a53-4c3e-8e18-fe549b10a44d';
        const U3 = 'app-c22ef816-edb6-47c5-8c41-31c6520fa9e6';
        // Test compression
        {
            const context = this.compression.auth;
            const payload = {
                uuid: U1,
                type: 'session',
                user_uid: U2,
                app_uid: U3,
            };
            
            const compressed = this._compress_payload(context, payload);
            assert(() => compressed.u === uuid_compression().encode(U1));
            assert(() => compressed.t === 's');
            assert(() => compressed.uu === uuid_compression().encode(U2));
            assert(() => compressed.au === uuid_compression('app-').encode(U3));
        }

        // Test decompression
        {
            const context = this.compression.auth;
            const payload = {
                u: uuid_compression().encode(U1),
                t: 's',
                uu: uuid_compression().encode(U2),
                au: uuid_compression('app-').encode(U3),
            };
            
            const decompressed = this._decompress_payload(context, payload);
            assert(() => decompressed.uuid === U1);
            assert(() => decompressed.type === 'session');
            assert(() => decompressed.user_uid === U2);
            assert(() => decompressed.app_uid === U3);
        }

        // Test UUID preservation
        {
            const payload = { uuid: U1 };
            const compressed = this._compress_payload(this.compression.auth, payload);
            const decompressed = this._decompress_payload(this.compression.auth, compressed);
            assert(() => decompressed.uuid === U1);
        }
    }
}

module.exports = { TokenService };
