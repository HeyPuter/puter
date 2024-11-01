const { AdvancedBase } = require("@heyputer/putility");
const uuid = require('uuid');
const { ExtensionService } = require("./ExtensionService");

class ExtensionModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        this.extension.emit('install', { context, services })

        if ( this.extension.service ) {
            services.registerService(uuid.v4(), ExtensionService, {
                state: this.extension.service,
            }); // uuid for now
        }
    }
}

module.exports = {
    ExtensionModule,
};
