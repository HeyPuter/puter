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

/**
 * Client-side link that establishes an encrypted socket.io connection.
 * Handles AES-256-CBC encryption for message transmission and uses asymmetric
 * key exchange for secure AES key distribution.
 */
class CLink extends BaseLink {
    static MODULES = {
        sioclient: require('socket.io-client'),
    };

    /**
     * Encrypts the data using AES-256-CBC and sends it through the socket.
     * The data is JSON stringified, encrypted with a random IV, and transmitted
     * as a buffer along with the IV.
     *
     * @param {*} data - The data to be encrypted and sent through the socket
     * @returns {void}
     */
    _send (data) {
        if ( ! this.socket ) return;
        const require = this.require;
        const crypto = require('crypto');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc',
                        this.aesKey,
                        iv);
        const jsonified = JSON.stringify(data);
        let buffers = [];
        buffers.push(cipher.update(Buffer.from(jsonified, 'utf-8')));
        buffers.push(cipher.final());
        const buffer = Buffer.concat(buffers);
        this.socket.send({
            iv,
            message: buffer,
        });
    }

    /**
     * Initializes the client link with local keys, remote server configuration, and logger.
     */
    constructor ({
        keys,
        log,
        config,
    }) {
        super();
        // keys of client (local)
        this.keys = keys;
        // keys of server (remote)
        this.config = config;
        this.log = log;
    }

    /**
     * Establishes a socket.io connection to the configured server address.
     * Generates an AES key, encrypts it using the server's public key, and sends
     * it during the handshake. Sets up event handlers for connection lifecycle
     * and message reception.
     */
    connect () {
        let address = this.config.address;
        if ( ! (
            address.startsWith('https://') ||
            address.startsWith('http://')
        ) ) {
            address = `https://${address}`;
        }
        const socket = this.modules.sioclient(address, {
            transports: ['websocket'],
            path: '/wssinternal',
            reconnection: true,
            extraHeaders: {
                ...(this.config.host ? {
                    Host: this.config.host,
                } : {}),
            },
        });
        socket.on('connect', () => {
            this.log.info('connected', {
                address,
            });

            const require = this.require;
            const crypto = require('crypto');
            this.aesKey = crypto.randomBytes(32);

            const kp_helper = new KeyPairHelper({
                kpublic: this.config.key,
                ksecret: this.keys.secret,
            });
            socket.send({
                $: 'take-my-key',
                key: this.keys.public,
                message: kp_helper.write(this.aesKey.toString('base64')),
            });
            this.state = this.constructor.ONLINE;
        });
        socket.on('disconnect', () => {
            this.log.info('disconnected', {
                address,
            });
        });
        socket.on('connect_error', e => {
            this.log.info('connection error', {
                address,
                message: e.message,
            });
        });
        socket.on('error', e => {
            this.log.info('error', {
                message: e.message,
            });
        });
        socket.on('message', data => {
            if ( this.state.on_message ) {
                this.state.on_message.call(this, data);
            }
        });

        this.socket = socket;
    }
}

module.exports = { CLink };
