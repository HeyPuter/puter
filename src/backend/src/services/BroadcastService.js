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
const { Endpoint } = require("../util/expressutil");
const { UserActorType } = require("./auth/Actor");
const BaseService = require("./BaseService");

class Peer extends AdvancedBase {
    static ONLINE = Symbol('ONLINE');
    static OFFLINE = Symbol('OFFLINE');
    
    static MODULES = {
        sioclient: require('socket.io-client'),
    };

    constructor (svc_broadcast, config) {
        super();
        this.svc_broadcast = svc_broadcast;
        this.log = this.svc_broadcast.log;
        this.config = config;
    }
    
    send (data) {
        if ( ! this.socket ) return;
        this.socket.send(data)
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

class BroadcastService extends BaseService {
    static MODULES = {
        express: require('express'),
        // ['socket.io']: require('socket.io'),
    };
    
    _construct () {
        this.peers_ = [];
    }
    
    async _init () {
        const peers = this.config.peers ?? [];
        for ( const peer_config of peers ) {
            const peer = new Peer(this, peer_config);
            this.peers_.push(peer);
            peer.connect();
        }
        
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
    
    async ['__on_install.websockets'] (_, { server }) {
        const svc_event = this.services.get('event');

        const io = require('socket.io')(server, {
            cors: { origin: '*' },
            path: '/wssinternal',
        });
        
        io.on('connection', async socket => {
            socket.on('message', ({ key, data, meta }) => {
                if ( meta.from_outside ) {
                    this.log.noticeme('possible over-sending');
                    return;
                }
                
                meta.from_outside = true;
                svc_event.emit(key, data, meta);
            });
        });
        
        
        this.log.noticeme(
            require('node:util').inspect(this.config)
        );
    }
}

module.exports = { BroadcastService };
