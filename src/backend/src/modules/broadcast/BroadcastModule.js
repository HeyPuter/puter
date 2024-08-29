const { AdvancedBase } = require("@heyputer/putil");

class BroadcastModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const { BroadcastService } = require('./BroadcastService');
        services.registerService('broadcast', BroadcastService);
    }
}

module.exports = {
    BroadcastModule,
};
