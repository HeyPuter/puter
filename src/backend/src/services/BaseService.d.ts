import type { ErrorService } from '@heyputer/backend/src/modules/core/ErrorService';
import type { DriverService } from '@heyputer/backend/src/services/drivers/DriverService';
import type { DynamoKVStore } from '@heyputer/backend/src/services/DynamoKVStore/DynamoKVStore';
import type { DDBClient } from '../clients/dynamodb/DDBClient';
import type { ServerHealthService } from '../modules/core/ServerHealthService/ServerHealthService';
import type { WebServerService } from '../modules/web/WebServerService';
import type { GroupService } from './auth/GroupService';
import type { SignupService } from './auth/SignupService';
import type { CleanEmailService } from './CleanEmailService';
import type { SqliteDatabaseAccessService } from './database/SqliteDatabaseAccessService';
import type { IDynamoKVStoreWrapper } from './DynamoKVStore/DynamoKVStoreWrapper';
import type { Emailservice } from './EmailService';
import type { EntityStoreService } from './EntityStoreService';
import type { EventService } from './EventService';
import type { FeatureFlagService } from './FeatureFlagService';
import type { GetUserService } from './GetUserService';
import type { MeteringService } from './MeteringService/MeteringService';
import type { MeteringServiceWrapper } from './MeteringService/MeteringServiceWrapper.mjs';
import type { SUService } from './SUService';
import type { UserService } from './UserService';

export interface ServicesMap {
    su: SUService;
    user: UserService;
    'get-user': GetUserService;
    'web-server': WebServerService;
    email: Emailservice;
    'es:app': EntityStoreService;
    meteringService: MeteringService & MeteringServiceWrapper;
    'puter-kvstore': DynamoKVStore & IDynamoKVStoreWrapper;
    database: SqliteDatabaseAccessService;
    'server-health': ServerHealthService;
    su: SUService;
    dynamo: DDBClient;
    user: UserService;
    event: EventService;
    signup: SignupService;
    group: GroupService;
    'feature-flag': FeatureFlagService;
    'clean-email': CleanEmailService;
    'error-service': ErrorService;
    driver: DriverService;
}

export interface ServiceResources {
    services: {
        get<T extends `${keyof ServicesMap}` | (string & {})>(
            name: T
        ): T extends `${infer R extends keyof ServicesMap}`
            ? ServicesMap[R]
            : unknown;
    };
    config: Record<string, any> & { services?: Record<string, any>; server_id?: string };
    name?: string;
    args?: any;
    context: { get (key: string): any };
}

export type EventHandler = (id: string, ...args: any[]) => any;

export interface Logger {
    debug: (...args: any[]) => any;
    info: (...args: any[]) => any;
    [key: string]: any;
}

export class BaseService {
    constructor (service_resources: ServiceResources, ...a: any[]);

    args: any;
    service_name: string;
    services: ServiceResources['services'];
    config: Record<string, any>;
    global_config: ServiceResources['config'];
    context: ServiceResources['context'];
    log: Logger;
    errors: any;

    as (interfaceName: string): Record<string, unknown>;

    run_as_early_as_possible (): Promise<void>;
    construct (): Promise<void>;
    init (): Promise<void>;
    __on (id: string, args: any[]): Promise<any>;
    protected __get_event_handler (id: string): EventHandler;

    protected _run_as_early_as_possible? (args?: any): any;
    protected _construct? (args?: any): any;
    protected _init? (args?: any): any;
    protected _get_merged_static_object? (key: string): Record<string, any>;

    static LOG_DEBUG?: boolean;
    static CONCERN?: string;
}

export default BaseService;
