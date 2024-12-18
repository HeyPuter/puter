// METADATA // {"ai-params":{"service":"claude"},"ai-commented":{"service":"claude"}}
const BaseService = require('../../services/BaseService');

/**
 * SocketioService provides a service for sending messages to clients.
 * socket.io is used behind the scenes. This service provides a simpler
 * interface for sending messages to rooms or socket ids.
 */
class SocketioService extends BaseService {
    static MODULES = {
        socketio: require('socket.io'),
    };

    /**
     * Initializes socket.io
     * 
     * @evtparam server The server to attach socket.io to.
     */
    ['__on_install.socketio'] (_, { server }) {
        const require = this.require;
        
        const socketio = require('socket.io');
        /**
         * @type {import('socket.io').Server}
         */
        this.io = socketio(server, {
            cors: {
                origin: '*',
            }
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
                const io = this.io.sockets.sockets.get(socket_specifier.socket)
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
            const room = this.io.sockets.adapter.rooms.get(socket_specifier.room);
            return (!!room) && room.size > 0;
        }
        if ( socket_specifier.socket ) {
            return this.io.sockets.sockets.has(socket_specifier.socket);
        }
    }
}

module.exports = SocketioService;
