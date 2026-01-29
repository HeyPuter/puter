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
import { MeteringServiceWrapper } from '../../services/MeteringService/MeteringServiceWrapper.mjs';
import { NotificationService } from '../../services/NotificationService';
import { RegistrantService } from '../../services/RegistrantService';
import { RegistryService } from '../../services/RegistryService';
import { DDBClientWrapper } from '../../services/repositories/DDBClientWrapper.js';
import { DynamoKVStoreWrapper } from '../../services/repositories/DynamoKVStore/DynamoKVStoreWrapper';
import { ScriptService } from '../../services/ScriptService';
import { SessionService } from '../../services/SessionService';
import { SUService } from '../../services/SUService';
import { SystemValidationService } from '../../services/SystemValidationService';
import { AlarmService } from '../core/AlarmService';
import APIErrorService from '../web/APIErrorService';

export class TestCoreModule {
    async install (context) {
        const services = context.get('services');
        services.registerService('dynamo', DDBClientWrapper);
        services.registerService('whoami', DetailProviderService);
        services.registerService('get-user', GetUserService);
        services.registerService('database', SqliteDatabaseAccessService);
        services.registerService('su', SUService);
        services.registerService('alarm', AlarmService);
        services.registerService('event', EventService);
        services.registerService('commands', CommandService);
        services.registerService('meteringService', MeteringServiceWrapper);
        services.registerService('puter-kvstore', DynamoKVStoreWrapper);
        services.registerService('permission', PermissionService);
        services.registerService('group', GroupService);
        services.registerService('anomaly', AnomalyService);
        services.registerService('api-error', APIErrorService);
        services.registerService('system-validation', SystemValidationService);
        services.registerService('registry', RegistryService);
        services.registerService('__registrant', RegistrantService);
        services.registerService('feature-flag', FeatureFlagService);
        services.registerService('token', TokenService);
        services.registerService('auth', AuthService);
        services.registerService('session', SessionService);
        services.registerService('notification', NotificationService);
        services.registerService('script', ScriptService);
        services.registerService('filesystem', FilesystemService);
    }
}
