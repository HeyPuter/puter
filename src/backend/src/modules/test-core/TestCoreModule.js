const { AnomalyService } = require('../../services/AnomalyService');
const { GroupService } = require('../../services/auth/GroupService');
const { PermissionService } = require('../../services/auth/PermissionService');
const { CommandService } = require('../../services/CommandService');
const { SqliteDatabaseAccessService } = require('../../services/database/SqliteDatabaseAccessService');
const { DetailProviderService } = require('../../services/DetailProviderService');
const { EventService } = require('../../services/EventService');
const { GetUserService } = require('../../services/GetUserService');
const { MeteringServiceWrapper } = require('../../services/MeteringService/MeteringServiceWrapper.mjs');
const { DBKVServiceWrapper } = require('../../services/repositories/DBKVStore/index.mjs');
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
        services.registerService('meteringService', MeteringServiceWrapper);
        services.registerService('puter-kvstore', DBKVServiceWrapper);
        services.registerService('permission', PermissionService);
        services.registerService('group', GroupService);
        services.registerService('anomaly', AnomalyService);
    }
}

module.exports = {
    TestCoreModule,
};
