import type { Actor } from '@heyputer/backend/src/services/auth/Actor.js';
import type { BaseDatabaseAccessService } from '@heyputer/backend/src/services/database/BaseDatabaseAccessService.d.ts';
import type { MeteringService } from '@heyputer/backend/src/services/MeteringService/MeteringService.ts';
import type { MeteringServiceWrapper } from '@heyputer/backend/src/services/MeteringService/MeteringServiceWrapper.mjs';
import type { DBKVStore } from '@heyputer/backend/src/services/repositories/DBKVStore/DBKVStore.ts';
import type { SUService } from '@heyputer/backend/src/services/SUService.js';
import type { IUser } from '@heyputer/backend/src/services/User.js';
import type { UserService } from '@heyputer/backend/src/services/UserService.d.ts';
import type { RequestHandler } from 'express';
import type FSNodeContext from '../src/backend/src/filesystem/FSNodeContext.js';
import type helpers from '../src/backend/src/helpers.js';
import type * as ExtensionControllerExports from './ExtensionController/src/ExtensionController.ts';

declare global {
    namespace Express {
        interface Request {
            services: { get: <T extends (keyof ServiceNameMap ) | (string & {})>(string: T)=> T extends keyof ServiceNameMap ? ServiceNameMap[T] : unknown }
            actor: Actor,
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

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

export type AddRouteFunction = (path: string, options: EndpointOptions, handler: RequestHandler) => void;

type RouterMethods = {
    [K in HttpMethod]: {
        (path: string, options: EndpointOptions, handler: RequestHandler): void;
        (path: string, handler: RequestHandler, options?: EndpointOptions): void;
    };
};

interface CoreRuntimeModule {
    util: {
        helpers: typeof helpers,
    }
}

interface FilesystemModule {
    FSNodeContext: FSNodeContext,
    selectors: unknown,
}

type StripPrefix<TPrefix extends string, T extends string> = T extends `${TPrefix}.${infer R}` ? R : never;
// TODO DS: define this globally in core to use it there too
interface ServiceNameMap {
    'meteringService': Pick<MeteringServiceWrapper, 'meteringService'> & MeteringService // TODO DS: squash into a single class without wrapper
    'puter-kvstore': DBKVStore
    'su': SUService
    'database': BaseDatabaseAccessService
    'user': UserService
}
interface Extension extends RouterMethods {
    exports: Record<string, unknown>,
    import(module:'core'): CoreRuntimeModule,
    import(module:'fs'): FilesystemModule,
    import(module:'extensionController'): typeof ExtensionControllerExports
    import<T extends `service:${keyof ServiceNameMap}`| (string & {})>(module: T): T extends `service:${infer R extends keyof ServiceNameMap}`
        ? ServiceNameMap[R]
        : unknown;
}

declare global {
    // Declare the extension variable
    const extension: Extension;
    const config: Record<string | number | symbol, unknown>;
    const global_config: Record<string | number | symbol, unknown>;
}
