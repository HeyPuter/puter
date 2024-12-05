const { AdvancedBase } = require("@heyputer/putility");

/**
 * A replacement for CoreModule with as few external relative requires as possible.
 * This will eventually be the successor to CoreModule, the main module for Puter's backend.
 */
class Core2Module extends AdvancedBase {
    async install (context) {
        // === LIBS === //
        const useapi = context.get('useapi');

        const lib = require('./lib/__lib__.js');
        for ( const k in lib ) {
            useapi.def(`core.${k}`, lib[k], { assign: true });
        }
        
        useapi.def('core.context', require('../../util/context.js').Context);
        
        // === SERVICES === //
        const services = context.get('services');

        const { LogService } = require('./LogService.js');
        services.registerService('log-service', LogService);
        
        const { AlarmService } = require("./AlarmService.js");
        services.registerService('alarm', AlarmService);
        
        const { ErrorService } = require("./ErrorService.js");
        services.registerService('error-service', ErrorService);
        
        const { PagerService } = require("./PagerService.js");
        services.registerService('pager', PagerService);
        
        const { ExpectationService } = require("./ExpectationService.js");
        services.registerService('expectations', ExpectationService);

        const { ProcessEventService } = require("./ProcessEventService.js");
        services.registerService('process-event', ProcessEventService);
        
        const { ServerHealthService } = require("./ServerHealthService.js");
        services.registerService('server-health', ServerHealthService);
    }
}

module.exports = {
    Core2Module,
};
