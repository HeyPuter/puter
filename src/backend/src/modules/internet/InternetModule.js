const { AdvancedBase } = require("@heyputer/putility");
const config = require("../../config.js");

class InternetModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        if ( !! config?.services?.['wisp-relay'] ) {
            const WispRelayService = require('./WispRelayService.js');
            services.registerService('wisp-relay', WispRelayService);
        } else {
            this.log.noticeme('WISP Relay is disabled');
        }

    }
}

module.exports = { InternetModule };
