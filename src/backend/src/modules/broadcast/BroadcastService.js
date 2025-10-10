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
const BaseService = require("../../services/BaseService");
const { CLink } = require("./connection/CLink");
const { SLink } = require("./connection/SLink");
const { Context } = require("../../util/context");

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
            const peer = new CLink({
                keys: this.config.keys,
                config: peer_config,
                log: this.log,
            });
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
            try {
                peer.send({ key, data, meta });
            } catch (e) {
                //
            }
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
            const conn = new SLink({
                keys: this.config.keys,
                trustedKeys: this.trustedPublicKeys_,
                socket,
            });
            this.connections_.push(conn);
            
            conn.channels.message.on(({ key, data, meta }) => {
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
                const context = Context.get(undefined, { allow_fallback: true });
                context.arun(async () => {
                    await svc_event.emit(key, data, meta);
                });
            });
        });
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
