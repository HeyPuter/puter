import APIError from '@heyputer/backend/src/api/APIError.js';
import type { WebServerService } from '@heyputer/backend/src/modules/web/WebServerService.js';
import query from '@heyputer/backend/src/om/query/query';
import type { Actor } from '@heyputer/backend/src/services/auth/Actor.js';
import type { BaseDatabaseAccessService } from '@heyputer/backend/src/services/database/BaseDatabaseAccessService.d.ts';
import type { MeteringService } from '@heyputer/backend/src/services/MeteringService/MeteringService.ts';
import type { MeteringServiceWrapper } from '@heyputer/backend/src/services/MeteringService/MeteringServiceWrapper.mjs';
import { DynamoKVStore } from '@heyputer/backend/src/services/repositories/DynamoKVStore/DynamoKVStore.ts';
import type { SUService } from '@heyputer/backend/src/services/SUService.js';
import type { IUser } from '@heyputer/backend/src/services/User.js';
import type { UserService } from '@heyputer/backend/src/services/UserService.d.ts';
import { Context } from '@heyputer/backend/src/util/context.js';
import type { RequestHandler } from 'express';
import type FSNodeContext from '../src/backend/src/filesystem/FSNodeContext.js';
import type helpers from '../src/backend/src/helpers.js';
import type * as ExtensionControllerExports from './ExtensionController/src/ExtensionController.ts';
declare global {
    namespace Express {
        interface Request {
            services: { get: <T extends (keyof ServiceNameMap) | (string & {})>(string: T) => T extends keyof ServiceNameMap ? ServiceNameMap[T] : unknown }
            actor: Actor,
            rawBody: Buffer,
            /** @deprecated use actor instead */
            user: IUser
        }
    }
}

interface EndpointOptions {
    allowedMethods?: string[]
    subdomain?: string
    noauth?: boolean
    mw?: RequestHandler[]
    otherOpts?: Record<string, unknown> & {
        json?: boolean
        noReallyItsJson?: boolean
    }
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

export type AddRouteFunction = (path: string, options: EndpointOptions, handler: RequestHandler) => void;

export type RouterMethods = {
    [K in HttpMethod]: {
        (path: string, options: EndpointOptions, handler: RequestHandler): void;
        (path: string, handler: RequestHandler, options?: EndpointOptions): void;
    };
};

interface CoreRuntimeModule {
    util: {
        helpers: typeof helpers,
    }
    Context: typeof Context,
    APIError: typeof APIError
}

interface FilesystemModule {
    FSNodeContext: FSNodeContext,
    selectors: unknown,
}

type StripPrefix<TPrefix extends string, T extends string> = T extends `${TPrefix}.${infer R}` ? R : never;
// TODO DS: define this globally in core to use it there too
interface ServiceNameMap {
    'meteringService': Pick<MeteringServiceWrapper, 'meteringService'> & MeteringService // TODO DS: squash into a single class without wrapper
    'puter-kvstore': DynamoKVStore
    'su': SUService
    'database': BaseDatabaseAccessService
    'user': UserService
    'web-server': WebServerService
}
interface Extension extends RouterMethods {
    exports: Record<string, unknown>,
    span: (<T>(label: string, fn: () => T) => () => T) & {
        run<T>(label: string, fn: () => T): T;
        run<T>(fn: () => T): T;
    },
    config: Record<string | number | symbol, any>,
    on<T extends unknown[]>(event: string, listener: (...args: T) => void): void, // TODO DS: type events better
    on(event: 'create.drivers', listener: (event: { createDriver: (interface: string, service: string, executors: any) => any }) => void),
    on(event: 'create.permissions', listener: (event: { grant_to_everyone: (permission: string) => void, grant_to_users: (permission: string) => void }) => void)
    on(event: 'create.interfaces', listener: (event: { createInterface: (interface: string, interfaces: DriverInterface) => void }) => void)
    import(module: 'data'): { db: BaseDatabaseAccessService, kv: DynamoKVStore, cache: unknown } // TODO DS: type cache better
    import(module: 'core'): CoreRuntimeModule,
    import(module: 'fs'): FilesystemModule,
    import(module: 'query'): typeof query,
    import(module: 'extensionController'): typeof ExtensionControllerExports
    import<T extends `service:${keyof ServiceNameMap}` | (string & {})>(module: T): T extends `service:${infer R extends keyof ServiceNameMap}`
        ? ServiceNameMap[R]
        : unknown;
}

declare global {
    // Declare the extension variable
    const extension: Extension;
    const config: Record<string | number | symbol, any>;
    const global_config: Record<string | number | symbol, unknown>;
}
