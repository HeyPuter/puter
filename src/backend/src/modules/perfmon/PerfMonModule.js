const { AdvancedBase } = require("@heyputer/putility");

/**
 * Enable this module when you want performance monitoring.
 * 
 * Performance monitoring requires additional setup. Jaegar should be installed
 * and running.
 */
class PerfMonModule extends AdvancedBase {
    async install (context) {
        const services = context.get('services');

        const TelemetryService = require("./TelemetryService");
        services.registerService('telemetry', TelemetryService);
    }
}

module.exports = {
    PerfMonModule,
};
