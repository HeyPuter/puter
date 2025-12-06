import { FilesystemService } from '../../filesystem/FilesystemService';
import { AnomalyService } from '../../services/AnomalyService';
import { AuthService } from '../../services/auth/AuthService';
import { GroupService } from '../../services/auth/GroupService';
import { PermissionService } from '../../services/auth/PermissionService';
import { TokenService } from '../../services/auth/TokenService';
import { CommandService } from '../../services/CommandService';
import { SqliteDatabaseAccessService } from '../../services/database/SqliteDatabaseAccessService';
import { DetailProviderService } from '../../services/DetailProviderService';
import { EventService } from '../../services/EventService';
import { FeatureFlagService } from '../../services/FeatureFlagService';
import { GetUserService } from '../../services/GetUserService';
import { InformationService } from '../../services/information/InformationService';
import { MeteringServiceWrapper } from '../../services/MeteringService/MeteringServiceWrapper.mjs';
import { NotificationService } from '../../services/NotificationService';
import { RegistrantService } from '../../services/RegistrantService';
import { RegistryService } from '../../services/RegistryService';
import { DBKVServiceWrapper } from '../../services/repositories/DBKVStore/index.mjs';
import { ScriptService } from '../../services/ScriptService';
import { SessionService } from '../../services/SessionService';
import { SUService } from '../../services/SUService';
import { SystemValidationService } from '../../services/SystemValidationService';
import { TraceService } from '../../services/TraceService';
import { AlarmService } from '../core/AlarmService';
import APIErrorService from '../web/APIErrorService';

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
