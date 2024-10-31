const { AdvancedBase } = require("@heyputer/putility");

class ExtensionModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');
        
        this.extension.emit('install', { context, services })
    }
}

module.exports = {
    ExtensionModule,
};
