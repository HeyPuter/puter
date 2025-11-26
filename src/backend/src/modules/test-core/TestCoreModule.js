const { CommandService } = require('../../services/CommandService');
const { SqliteDatabaseAccessService } = require('../../services/database/SqliteDatabaseAccessService');
const { DetailProviderService } = require('../../services/DetailProviderService');
const { EventService } = require('../../services/EventService');
const { GetUserService } = require('../../services/GetUserService');
const { SUService } = require('../../services/SUService');
const { TraceService } = require('../../services/TraceService');
const { AlarmService } = require('../core/AlarmService');

class TestCoreModule {
    async install (context) {
        const services = context.get('services');
        services.registerService('whoami', DetailProviderService);
        services.registerService('get-user', GetUserService);
        services.registerService('database', SqliteDatabaseAccessService);
        services.registerService('traceService', TraceService);
        services.registerService('su', SUService);
        services.registerService('alarm', AlarmService);
        services.registerService('event', EventService);
        services.registerService('commands', CommandService);
    }
}

module.exports = {
    TestCoreModule,
};
