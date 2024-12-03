const BaseService = require('../../services/BaseService');

class SocketioService extends BaseService {
    static MODULES = {
        socketio: require('socket.io'),
    };

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
    
    async send (socket_specifiers, key, data) {
        const svc_getUser = this.services.get('get-user');
        
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
