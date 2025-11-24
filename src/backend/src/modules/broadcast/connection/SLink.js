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

const { BaseLink } = require('./BaseLink');
const { KeyPairHelper } = require('./KeyPairHelper');

class SLink extends BaseLink {
    static AUTHENTICATING = {
        on_message (data) {
            if ( data.$ !== 'take-my-key' ) {
                this.disconnect();
                return;
            }

            const trustedKeys = this.trustedKeys;

            const hasKey = trustedKeys[data.key];
            if ( ! hasKey ) {
                this.disconnect();
                return;
            }

            const is_trusted = trustedKeys.hasOwnProperty(data.key);
            if ( ! is_trusted ) {
                this.disconnect();
                return;
            }

            const kp_helper = new KeyPairHelper({
                kpublic: data.key,
                ksecret: this.keys.secret,
            });

            const message = kp_helper.read(data.message);
            this.aesKey = Buffer.from(message, 'base64');

            this.state = this.constructor.ONLINE;
        },
    };
    static ONLINE = {
        on_message (data) {
            const require = this.require;
            const crypto = require('crypto');
            const decipher = crypto.createDecipheriv('aes-256-cbc',
                            this.aesKey,
                            data.iv);
            const buffers = [];
            buffers.push(decipher.update(data.message));
            buffers.push(decipher.final());

            const rawjson = Buffer.concat(buffers).toString('utf-8');

            const output = JSON.parse(rawjson);

            this.channels.message.emit(output);
        },
    };
    static OFFLINE = {
        on_message () {
            throw new Error('unexpected message');
        },
    };

    _send () {
        // TODO: implement as a fallback
        throw new Error('cannot send via SLink yet');
    }

    disconnect () {
        this.socket.disconnect();
        this.state = this.constructor.OFFLINE;
    }

    constructor ({
        keys,
        trustedKeys,
        socket,
    }) {
        super();
        this.state = this.constructor.AUTHENTICATING;
        // Keys of server (local)
        this.keys = keys;
        // Allowed client keys (remote)
        this.trustedKeys = trustedKeys;
        this.socket = socket;

        socket.on('message', data => {
            this.state.on_message.call(this, data);
        });
    }
}

module.exports = { SLink };
