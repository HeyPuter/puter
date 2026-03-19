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

const BaseService = require('../../services/BaseService');
const socketio = require('socket.io');
const { createAdapter } = require('@socket.io/redis-streams-adapter');
const { redisClient } = require('../../clients/redis/redisSingleton');

const normalizeHost = (value) => {
    if ( typeof value !== 'string' ) return null;
    const trimmedValue = value.trim().toLowerCase().replace(/^\./, '');
    if ( ! trimmedValue ) return null;
    return trimmedValue.split(':')[0];
};

const extractOriginHost = (origin) => {
    if ( typeof origin !== 'string' || origin.length === 0 ) return null;
    try {
        return normalizeHost(new URL(origin).host);
    } catch {
        return null;
    }
};

/**
 * SocketioService provides a service for sending messages to clients.
 * socket.io is used behind the scenes. This service provides a simpler
 * interface for sending messages to rooms or socket ids.
 */
class SocketioService extends BaseService {
    /**
     * Initializes socket.io
     *
     * @evtparam server The server to attach socket.io to.
     */
    '__on_install.socketio' (_, { server }) {
        const uiHost = normalizeHost(this.global_config.domain);
        const apiHost = uiHost ? `api.${uiHost}` : null;
        const isApiRequest = (req) => normalizeHost(req?.headers?.host) === apiHost;
        const isUiOriginAllowed = (req) => {
            const origin = req?.headers?.origin;
            if ( ! origin ) return false;
            return extractOriginHost(origin) === uiHost;
        };

        /**
         * @type {import('socket.io').Server}
         */
        const socketioOptions = {
            cors: (req, callback) => {
                if ( isApiRequest(req) ) {
                    callback(null, {
                        origin: true,
                        credentials: true,
                    });
                    return;
                }

                callback(null, {
                    origin: isUiOriginAllowed(req),
                    credentials: true,
                });
            },
            allowRequest: (req, callback) => {
                if ( isApiRequest(req) ) {
                    callback(null, true);
                    return;
                }
                callback(null, isUiOriginAllowed(req));
            },
            adapter: createAdapter(redisClient),
        };
        this.io = socketio(server, socketioOptions);
    }

    /**
    * Sends a message to specified socket(s) or room(s)
    *
    * @param {Array|Object} socket_specifiers - Single or array of objects specifying target sockets/rooms
    * @param {string} key - The event key/name to emit
    * @param {*} data - The data payload to send
    * @returns {Promise<void>}
    */
    async send (socket_specifiers, key, data) {
        if ( ! Array.isArray(socket_specifiers) ) {
            socket_specifiers = [socket_specifiers];
        }

        for ( const socket_specifier of socket_specifiers ) {
            if ( socket_specifier.room ) {
                this.io.to(socket_specifier.room).emit(key, data);
            } else if ( socket_specifier.socket ) {
                this.io.to(socket_specifier.socket).emit(key, data);
            }
        }
    }

    /**
     * Checks if the specified socket or room exists
     *
     * @param {Object} socket_specifier - The socket specifier object
     * @returns {boolean} True if the socket exists, false otherwise
     */
    has (socket_specifier) {
        if ( socket_specifier.room ) {
            const room = this.io?.sockets.adapter.rooms.get(socket_specifier.room);
            return (!!room) && room.size > 0;
        }
        if ( socket_specifier.socket ) {
            return this.io?.sockets.sockets.has(socket_specifier.socket);
        }
    }
}

module.exports = SocketioService;
