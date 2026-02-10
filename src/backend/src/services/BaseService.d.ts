import { DDBClient } from '../clients/dynamodb/DDBClient';
import { DynamoKVStore } from '../clients/dynamodb/DynamoKVStore/DynamoKVStore';
import type { ServerHealthService } from '../modules/core/ServerHealthService';
import { GroupService } from './auth/GroupService';
import SignupService from './auth/SignupService';
import { CleanEmailService } from './CleanEmailService';
import { SqliteDatabaseAccessService } from './database/SqliteDatabaseAccessService';
import { EventService } from './EventService';
import { FeatureFlagService } from './FeatureFlagService';
import { MeteringServiceWrapper } from './MeteringService/MeteringServiceWrapper.mjs';
import type { SUService } from './SUService';
import { UserService } from './UserService';

export interface ServiceResources {
    services: {
        get (name: 'meteringService'): MeteringServiceWrapper;
        get (name: 'puter-kvstore'): DynamoKVStore;
        get (name: 'database'): SqliteDatabaseAccessService;
        get (name: 'server-health'): ServerHealthService;
        get (name: 'su'): SUService;
        get (name: 'dynamo'): DDBClient;
        get (name: 'user'): UserService;
        get (name: 'event'): EventService;
        get (name: 'signup'): SignupService;
        get (name: 'group'): GroupService;
        get (name: 'feature-flag'): FeatureFlagService;
        get (name: 'clean-email'): CleanEmailService;
        get (name: string): unknown;
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
