import type APIError from '@heyputer/backend/src/api/APIError.js';
import type { WebServerService } from '@heyputer/backend/src/modules/web/WebServerService.js';
import type query from '@heyputer/backend/src/om/query/query';
import type { Actor } from '@heyputer/backend/src/services/auth/Actor.js';
import type { BaseDatabaseAccessService } from '@heyputer/backend/src/services/database/BaseDatabaseAccessService.d.ts';
import type { GetUserService } from '@heyputer/backend/src/services/GetUserService.js';
import type { EmailService } from '@heyputer/backend/src/services/EmailService.js';
import type { EntityStoreService } from '@heyputer/backend/src/services/EntityStoreService.js';
import type { MeteringService } from '@heyputer/backend/src/services/MeteringService/MeteringService.ts';
import type { MeteringServiceWrapper } from '@heyputer/backend/src/services/MeteringService/MeteringServiceWrapper.mjs';
import type { DynamoKVStore } from '@heyputer/backend/src/services/repositories/DynamoKVStore/DynamoKVStore.ts';
import type { SUService } from '@heyputer/backend/src/services/SUService.js';
import type { IUser } from '@heyputer/backend/src/services/User.js';
import type { UserService } from '@heyputer/backend/src/services/UserService.d.ts';
import type { Context } from '@heyputer/backend/src/util/context.js';
import type kvjs from '@heyputer/kv.js';
import type { RequestHandler } from 'express';
import type FSNodeContext from '../src/backend/src/filesystem/FSNodeContext.js';
import type helpers from '../src/backend/src/helpers.js';
import type * as ExtensionControllerExports from './ExtensionController/src/ExtensionController.ts';

declare global {
    namespace Express {
        interface Request {
            services: {
                get: <T extends keyof ServiceNameMap | (string & {})>(
                    string: T,
                ) => T extends keyof ServiceNameMap ? ServiceNameMap[T] : unknown;
            };
            actor?: Actor;
            rawBody: Buffer;
            /** @deprecated use actor instead */
            user: IUser;
        }
    }
}

interface EndpointOptions {
    allowedMethods?: string[];
    subdomain?: string;
    noauth?: boolean;
    mw?: RequestHandler[];
    otherOpts?: Record<string, unknown> & {
        json?: boolean;
        noReallyItsJson?: boolean;
    };
}

// Driver interface types
interface ParameterDefinition {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    optional: boolean;
}
interface MethodDefinition {
    description: string;
    parameters: Record<string, ParameterDefinition>;
}
interface DriverInterface {
    description: string;
    methods: Record<string, MethodDefinition>;
}

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

export type AddRouteFunction = (
    path: string,
    options: EndpointOptions,
    handler: RequestHandler,
) => void;

export type RouterMethods = {
    [K in HttpMethod]: {
        (path: string, options: EndpointOptions, handler: RequestHandler): void;
        (path: string, handler: RequestHandler, options?: EndpointOptions): void;
    };
};

interface CoreRuntimeModule {
    util: {
        helpers: typeof helpers;
    };
    Context: typeof Context;
    APIError: typeof APIError;
}

interface FilesystemModule {
    FSNodeContext: FSNodeContext;
    selectors: unknown;
}

// TODO DS: define this globally in core to use it there too
interface ServiceNameMap {
    meteringService: Pick<MeteringServiceWrapper, 'meteringService'> &
        MeteringService; // TODO DS: squash into a single class without wrapper
    'puter-kvstore': DynamoKVStore;
    su: SUService;
    database: BaseDatabaseAccessService;
    user: UserService;
    'get-user': GetUserService;
    'web-server': WebServerService;
    'email': EmailService;
    'es:app': EntityStoreService;
}

export interface ExtensionEventTypeMap {
    'metering:registerAvailablePolicies': {
        availablePolicies: unknown[]
    },
    'create.drivers': {
        createDriver: (interface: string, service: string, executors: any) => any;
    };
    'create.permissions': {
        grant_to_everyone: (permission: string) => void;
        grant_to_users: (permission: string) => void;
    };
    'create.interfaces': {
        createInterface: (interface: string, interfaces: DriverInterface) => void;
    };
    'puter.gui.addons': {
        bodyContent: string;
        headContent: string;
        guiParams: {
            env: string;
            app_origin: string;
            api_origin: string;
            gui_origin: string;
            asset_dir: string;
            launch_options: unknown;
            app_name_regex: RegExp;
            app_name_max_length: number;
            app_title_max_length: number;
            hosting_domain: string;
            subdomain_regex: RegExp;
            subdomain_max_length: number;
            domain: string;
            protocol: string;
            api_base_url: string;
            app?: { name: string, uid: string } & Record<string, unknown>;
            [key: string]: unknown;
        };
    };
    'app.changed': {
        app_uid: string;
        action: 'updated' | 'deleted';
    };
}

interface Extension extends RouterMethods {
    exports: Record<string, unknown>;
    span: (<T>(label: string, fn: () => T) => () => T) & {
        run<T>(label: string, fn: () => T): T;
        run<T>(fn: () => T): T;
    };
    config: Record<string | number | symbol, any>;

    on<E extends keyof ExtensionEventTypeMap>(
        name: E,
        listener: (event: ExtensionEventTypeMap[E]) => void | Promise<void>
    ): void;
    on(name: string, listener: (event: unknown) => void | Promise<void>): void

    import(module: 'data'): {
        db: BaseDatabaseAccessService;
        kv: DynamoKVStore;
        cache: kvjs;
    };
    import(module: 'core'): CoreRuntimeModule;
    import(module: 'fs'): FilesystemModule;
    import(module: 'query'): typeof query;
    import(module: 'extensionController'): typeof ExtensionControllerExports;
    import<T extends `service:${keyof ServiceNameMap}` | (string & {})>(
        module: T
    ): T extends `service:${infer R extends keyof ServiceNameMap}`
        ? ServiceNameMap[R]
        : unknown;
}

declare global {
    // Declare the extension variable
    const extension: Extension;
    const config: Record<string | number | symbol, any>;
    const global_config: Record<string | number | symbol, unknown>;
}
