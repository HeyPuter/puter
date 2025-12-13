import { FilesystemService } from '../../filesystem/FilesystemService.js';
import { AnomalyService } from '../../services/AnomalyService.js';
import { AuthService } from '../../services/auth/AuthService.js';
import { GroupService } from '../../services/auth/GroupService.js';
import { PermissionService } from '../../services/auth/PermissionService.js';
import { TokenService } from '../../services/auth/TokenService.js';
import { CommandService } from '../../services/CommandService.js';
import { SqliteDatabaseAccessService } from '../../services/database/SqliteDatabaseAccessService.js';
import { DetailProviderService } from '../../services/DetailProviderService.js';
import { EventService } from '../../services/EventService.js';
import { FeatureFlagService } from '../../services/FeatureFlagService.js';
import { GetUserService } from '../../services/GetUserService.js';
import { InformationService } from '../../services/information/InformationService.js';
import { MeteringServiceWrapper } from '../../services/MeteringService/MeteringServiceWrapper.mjs';
import { NotificationService } from '../../services/NotificationService.js';
import { RegistrantService } from '../../services/RegistrantService.js';
import { RegistryService } from '../../services/RegistryService.js';
import { DBKVServiceWrapper } from '../../services/repositories/DBKVStore/index.mjs';
import { ScriptService } from '../../services/ScriptService.js';
import { SessionService } from '../../services/SessionService.js';
import { SUService } from '../../services/SUService.js';
import { SystemValidationService } from '../../services/SystemValidationService.js';
import { TraceService } from '../../services/TraceService.js';
import { AlarmService } from '../core/AlarmService.js';
import APIErrorService from '../web/APIErrorService.js';

export class TestCoreModule {
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
        services.registerService('api-error', APIErrorService);
        services.registerService('system-validation', SystemValidationService);
        services.registerService('registry', RegistryService);
        services.registerService('__registrant', RegistrantService);
        services.registerService('feature-flag', FeatureFlagService);
        services.registerService('token', TokenService);
        services.registerService('information', InformationService);
        services.registerService('auth', AuthService);
        services.registerService('session', SessionService);
        services.registerService('notification', NotificationService);
        services.registerService('script', ScriptService);
        services.registerService('filesystem', FilesystemService);
    }
}
