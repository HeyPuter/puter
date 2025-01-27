const config = require("../../config");

const { AdvancedBase } = require("@heyputer/putility");

class PuterExecModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const ExecInterfaceService = require('./ExecInterfaceService');
        services.registerService('__exec-interfaces', ExecInterfaceService);
    }
}

module.exports = {
    PuterExecModule
};
