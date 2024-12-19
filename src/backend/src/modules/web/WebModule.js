const { AdvancedBase } = require("@heyputer/putility");

/**
 * This module initializes a pre-configured web server and socket.io server.
 * The main service, WebServerService, emits 'install.routes' and provides
 * the server instance to the callback.
 */
class WebModule extends AdvancedBase {
    async install (context) {
        // === LIBS === //
        const useapi = context.get('useapi');
        useapi.def('web', require('./lib/__lib__.js'), { assign: true });
        
        // === SERVICES === //
        const services = context.get('services');
        
        const SocketioService = require("./SocketioService");
        services.registerService('socketio', SocketioService);
        
        const WebServerService = require("./WebServerService");
        services.registerService('web-server', WebServerService);
        
        const APIErrorService = require("./APIErrorService");
        services.registerService('api-error', APIErrorService);
    }
}

module.exports = {
    WebModule,
};
