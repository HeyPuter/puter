const { AdvancedBase } = require("@heyputer/putility");

class WebModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        const SocketioService = require("./SocketioService");
        services.registerService('socketio', SocketioService);
        
        const WebServerService = require("./WebServerService");
        services.registerService('web-server', WebServerService);
    }
}

module.exports = {
    WebModule,
};
