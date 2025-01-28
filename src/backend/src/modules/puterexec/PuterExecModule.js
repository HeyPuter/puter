const config = require("../../config");

const { AdvancedBase } = require("@heyputer/putility");

class PuterExecModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const ExecInterfaceService = require('./ExecInterfaceService');
        services.registerService('__exec-interfaces', ExecInterfaceService);

        if ( !! config?.services?.['judge0'] ) {
            const Judge0Service = require('./Judge0Service');
            services.registerService('judge0', Judge0Service);
        }
    }
}

module.exports = {
    PuterExecModule
};
