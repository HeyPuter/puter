/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { AdvancedBase } = require("@heyputer/puter-js-common");
const BaseService = require("../../services/BaseService");

class KeyPairHelper extends AdvancedBase {
    static MODULES = {
        tweetnacl: require('tweetnacl'),
    };
    
    constructor ({
        kpublic,
        ksecret,
    }) {
        super();
        this.kpublic = kpublic;
        this.ksecret = ksecret;
        this.nonce_ = 0;
    }
    
    to_nacl_key_ (key) {
        console.log('WUT', key);
        const full_buffer = Buffer.from(key, 'base64');

        // Remove version byte (assumed to be 0x31 and ignored for now)
        const buffer = full_buffer.slice(1);
        
        return new Uint8Array(buffer);
    }
    
    get naclSecret () {
        return this.naclSecret_ ?? (
            this.naclSecret_ = this.to_nacl_key_(this.ksecret));
    }
    get naclPublic () {
        return this.naclPublic_ ?? (
            this.naclPublic_ = this.to_nacl_key_(this.kpublic));
    }
    
    write (text) {
        const require = this.require;
        const nacl = require('tweetnacl');

        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const message = {};
        
        const textUint8 = new Uint8Array(Buffer.from(text, 'utf-8'));
        const encryptedText = nacl.box(
            textUint8, nonce,
            this.naclPublic, this.naclSecret
        );
        message.text = Buffer.from(encryptedText);
        message.nonce = Buffer.from(nonce);
        
        return message;
    }
    
    read (message) {
        const require = this.require;
        const nacl = require('tweetnacl');
        
        const arr = nacl.box.open(
            new Uint8Array(message.text),
            new Uint8Array(message.nonce),
            this.naclPublic,
            this.naclSecret,
        );
        
        return Buffer.from(arr).toString('utf-8');
    }
}

class Peer extends AdvancedBase {
    static AUTHENTICATING = Symbol('AUTHENTICATING');
    static ONLINE = Symbol('ONLINE');
    static OFFLINE = Symbol('OFFLINE');
    
    static MODULES = {
        sioclient: require('socket.io-client'),
        crypto: require('crypto'),
    };

    constructor (svc_broadcast, config) {
        super();
        this.svc_broadcast = svc_broadcast;
        this.log = this.svc_broadcast.log;
        this.config = config;
    }
    
    send (data) {
        if ( ! this.socket ) return;
        const require = this.require;
        const crypto = require('crypto');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
            'aes-256-cbc',
            this.aesKey,
            iv,
        );
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
    
    get state () {
        try {
            if ( this.socket?.connected ) return this.constructor.ONLINE;
        } catch (e) {
            console.error('could not get peer state', e);
        }
        return this.constructor.OFFLINE;
    }
    
    connect () {
        const address = this.config.address;
        const socket = this.modules.sioclient(address, {
            transports: ['websocket'],
            path: '/wssinternal',
            reconnection: true,
            extraHeaders: {
                ...(this.config.host ? {
                    Host: this.config.host,
                } : {})
            }
        });
        socket.on('connect', () => {
            this.log.info(`connected`, {
                address: this.config.address
            });

            const require = this.require;
            const crypto = require('crypto');
            this.aesKey = crypto.randomBytes(32);

            const kp_helper = new KeyPairHelper({
                kpublic: this.config.key,
                ksecret: this.svc_broadcast.config.keys.secret,
            });
            socket.send({
                $: 'take-my-key',
                key: this.svc_broadcast.config.keys.public,
                message: kp_helper.write(
                    this.aesKey.toString('base64')
                ),
            });
        });
        socket.on('disconnect', () => {
            this.log.info(`disconnected`, {
                address: this.config.address
            });
        });
        socket.on('connect_error', e => {
            this.log.info(`connection error`, {
                address: this.config.address,
                message: e.message,
            });
        });
        socket.on('error', e => {
            this.log.info('error', {
                message: e.message,
            });
        });

        this.socket = socket;
    }
}

class Connection extends AdvancedBase {
    static MODULES = {
        crypto: require('crypto'),
    }

    static AUTHENTICATING = {
        on_message (data) {
            if ( data.$ !== 'take-my-key' ) {
                this.disconnect();
                return;
            }
            
            const hasKey = this.svc_broadcast.trustedPublicKeys_[data.key];
            if ( ! hasKey ) {
                this.disconnect();
                return;
            }
            
            const is_trusted =
                this.svc_broadcast.trustedPublicKeys_
                    .hasOwnProperty(data.key)
            if ( ! is_trusted ) {
                this.disconnect();
                return;
            }

            const kp_helper = new KeyPairHelper({
                kpublic: data.key,
                ksecret: this.svc_broadcast.config.keys.secret,
            });
            
            const message = kp_helper.read(data.message);
            this.aesKey = Buffer.from(message, 'base64');
            
            this.state = this.constructor.ONLINE;
        }
    }
    static ONLINE = {
        on_message (data) {
            if ( ! this.on_message ) return;
            
            const require = this.require;
            const crypto = require('crypto');
            const decipher = crypto.createDecipheriv(
                'aes-256-cbc',
                this.aesKey,
                data.iv,
            )
            const buffers = [];
            buffers.push(decipher.update(data.message));
            buffers.push(decipher.final());
            
            const rawjson = Buffer.concat(buffers).toString('utf-8');
            
            const output = JSON.parse(rawjson);
            
            this.on_message(output);
        }
    }
    static OFFLINE = {
        on_message () {
            throw new Error('unexpected message');
        }
    }
    
    constructor (svc_broadcast, socket) {
        super();
        this.state = this.constructor.AUTHENTICATING;
        this.svc_broadcast = svc_broadcast;
        this.log = this.svc_broadcast.log;
        this.socket = socket;
        
        socket.on('message', data => {
            this.state.on_message.call(this, data);
        });
    }
    
    disconnect () {
        this.socket.disconnect(true);
        this.state = this.constructor.OFFLINE;
    }
}

class BroadcastService extends BaseService {
    static MODULES = {
        express: require('express'),
        // ['socket.io']: require('socket.io'),
    };
    
    _construct () {
        this.peers_ = [];
        this.connections_ = [];
        this.trustedPublicKeys_ = {};
    }
    
    async _init () {
        const peers = this.config.peers ?? [];
        for ( const peer_config of peers ) {
            this.trustedPublicKeys_[peer_config.key] = true;
            const peer = new Peer(this, peer_config);
            this.peers_.push(peer);
            peer.connect();
        }
        
        this._register_commands(this.services.get('commands'));
        
        const svc_event = this.services.get('event');
        svc_event.on('outer.*', this.on_event.bind(this));
    }
    
    async on_event (key, data, meta) {
        if ( meta.from_outside ) return;
        
        for ( const peer of this.peers_ ) {
            if ( peer.state !== Peer.ONLINE ) continue;
            peer.send({ key, data, meta });
        }
    }
    
    async ['__on_install.websockets'] () {
        const svc_event = this.services.get('event');
        const svc_webServer = this.services.get('web-server');
        
        const server = svc_webServer.get_server();

        const io = require('socket.io')(server, {
            cors: { origin: '*' },
            path: '/wssinternal',
        });
        
        io.on('connection', async socket => {
            const conn = new Connection(this, socket);
            this.connections_.push(conn);
            
            conn.on_message = ({ key, data, meta }) => {
                if ( meta.from_outside ) {
                    this.log.noticeme('possible over-sending');
                    return;
                }
                
                if ( key === 'test' ) {
                    this.log.noticeme(`test message: ` +
                        JSON.stringify(data)
                    );
                }
                
                meta.from_outside = true;
                svc_event.emit(key, data, meta);
            };
        });
        
        
        this.log.noticeme(
            require('node:util').inspect(this.config)
        );
    }
    
    _register_commands (commands) {
        commands.registerCommands('broadcast', [
            {
                id: 'test',
                description: 'send a test message',
                handler: async (args, ctx) => {
                    this.on_event('test', {
                        contents: 'I am a test message',
                    }, {})
                }
            }
        ])
    }
}

module.exports = { BroadcastService };
