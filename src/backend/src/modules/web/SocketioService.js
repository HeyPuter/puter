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

// METADATA // {"ai-params":{"service":"claude"},"ai-commented":{"service":"claude"}}
const BaseService = require('../../services/BaseService');
const socketio = require('socket.io');

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
    ['__on_install.socketio'] (_, { server }) {
        /**
         * @type {import('socket.io').Server}
         */
        this.io = socketio(server, {
            cors: {
                origin: '*',
            },
        });
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
                const io = this.io.sockets.sockets.get(socket_specifier.socket);
                if ( ! io ) continue;
                io.emit(key, data);
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
