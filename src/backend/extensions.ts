/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { RequestHandler } from 'express';
import type { puterClients } from './clients';
import {
    EventListener,
    EventMap,
    EventMetadata,
    ListenKey,
    MatchingEvents,
} from './clients/event/types';
import type {
    IExtensionClientInstances,
    IPuterClientRegistry,
} from './clients/types';
import type { puterControllers } from './controllers';
import type {
    IExtensionControllerInstances,
    IPuterControllerRegistry,
} from './controllers/types';
import type {
    RouteDescriptor,
    RouteMethod,
    RouteOptions,
    RoutePath,
} from './core/http/types';
import type { puterDrivers } from './drivers';
import type {
    IExtensionDriverInstances,
    IPuterDriverRegistry,
} from './drivers/types';
import {
    clientsContainers,
    configContainer,
    controllersContainers,
    driversContainers,
    servicesContainers,
    storesContainers,
} from './exports';
import type { puterServices } from './services';
import type {
    IExtensionServiceInstances,
    IPuterServiceRegistry,
} from './services/types';
import type { puterStores } from './stores';
import type {
    IExtensionStoreInstances,
    IPuterStoreRegistry,
} from './stores/types';
import type { IConfig, LayerInstances } from './types';

/**
 * The in-memory registry an extension's module-scope code writes into, and that
 * `PuterServer` drains during boot. Every field is optional at write time — an
 * extension that only needs routes never touches the registries.
 */
export const extensionStore = {
    clients: {} as IPuterClientRegistry,
    stores: {} as IPuterStoreRegistry,
    services: {} as IPuterServiceRegistry,
    controllers: {} as IPuterControllerRegistry,
    drivers: {} as IPuterDriverRegistry,
    globalMiddlewares: [] as RequestHandler[],
    events: {} as Record<string, EventListener[]>,
    /**
     * Extension-declared routes. Shape matches the controller-layer
     * `RouteDescriptor`, so both flow through the same materializer
     * (`PuterServer#materializeRoute`) and inherit the same options →
     * middleware translation (subdomain, auth, body parsers, ...).
     */
    routeHandlers: [] as RouteDescriptor[],
};

/**
 * Internal: normalize `(path, handler)` or `(path, options, handler)` into a
 * single `RouteDescriptor` the server can materialize.
 */
const pushRoute = (
    method: RouteMethod,
    path: RoutePath,
    optionsOrHandler: RouteOptions | RequestHandler,
    maybeHandler?: RequestHandler,
): void => {
    const handler =
        typeof optionsOrHandler === 'function'
            ? optionsOrHandler
            : maybeHandler;
    const options =
        typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
    if (!handler) {
        throw new Error(
            `extension.${method}('${String(path)}', ...) missing handler`,
        );
    }
    extensionStore.routeHandlers.push({ method, path, options, handler });
};

interface ExtensionRouteFn {
    (path: RoutePath, handler: RequestHandler): void;
    (path: RoutePath, options: RouteOptions, handler: RequestHandler): void;
}

const makeRouteFn = (method: RouteMethod): ExtensionRouteFn => {
    return ((
        path: RoutePath,
        optionsOrHandler: RouteOptions | RequestHandler,
        maybeHandler?: RequestHandler,
    ) => {
        pushRoute(method, path, optionsOrHandler, maybeHandler);
    }) as ExtensionRouteFn;
};

/**
 * `extension.use` mirrors `app.use` and supports three shapes: use(handler)
 * use(options, handler) use(path, handler) use(path, options, handler) Pathless
 * calls register global middleware — the server materializer drops the path
 * when calling `app.use` (see `RouteDescriptor.path?`).
 */
interface ExtensionUseFn {
    (handler: RequestHandler): void;
    (options: RouteOptions, handler: RequestHandler): void;
    (path: RoutePath, handler: RequestHandler): void;
    (path: RoutePath, options: RouteOptions, handler: RequestHandler): void;
}

const isRequestHandler = (v: unknown): v is RequestHandler =>
    typeof v === 'function';

const isRoutePath = (v: unknown): v is RoutePath =>
    typeof v === 'string' || v instanceof RegExp || Array.isArray(v);

const makeUseFn = (): ExtensionUseFn => {
    return ((
        a: RoutePath | RouteOptions | RequestHandler,
        b?: RouteOptions | RequestHandler,
        c?: RequestHandler,
    ): void => {
        let path: RoutePath | undefined;
        let options: RouteOptions = {};
        let handler: RequestHandler | undefined;

        if (isRoutePath(a)) {
            path = a;
            if (isRequestHandler(b)) {
                handler = b;
            } else {
                options = (b as RouteOptions) ?? {};
                handler = c;
            }
        } else if (isRequestHandler(a)) {
            handler = a;
        } else {
            options = (a as RouteOptions) ?? {};
            handler = isRequestHandler(b) ? b : undefined;
        }

        if (!handler) {
            throw new Error('extension.use(...) missing handler');
        }
        extensionStore.routeHandlers.push({
            method: 'use',
            ...(path !== undefined ? { path } : {}),
            options,
            handler,
        });
    }) as ExtensionUseFn;
};

/**
 * Global `extension` API available inside every dynamically-loaded extension
 * module. Exposes:
 *
 * - Registry writers: `registerClient`, `registerStore`, `registerService`,
 *   `registerController`, `registerDriver`.
 * - Event subscription: `on(event, handler)`.
 * - Imperative route registration: `get`, `post`, `put`, `delete`, `patch`,
 *   `head`, `options`, `all`, `use`. Each accepts the same `RouteOptions`
 *   vocabulary used by controllers (subdomain, requireAuth, bodyJson, …) so
 *   extension routes get identical gate + parser treatment.
 * - Back-reference lookup: `import('service:foo')` / `'client:bar'` /
 *   `'store:baz'` / `'controller:qux'` / `'driver:fred'` — returns a lazy proxy
 *   to the registered instance (thrown on use-before-init).
 */
/**
 * Wrap a resolved layer instance so that pulling a method off the import comes
 * out _bound_ to the instance. Extensions routinely grab a method as a bare
 * reference — `const { write } = extension.import('service').fs` or `const w =
 * svc.fs.write` — then call it detached; without binding, `this` is `undefined`
 * and the method's private-field access throws on the first line. Getters keep
 * the real instance as their receiver, so private-field reads inside accessors
 * still resolve. Only `get` is trapped; writes, `in`, and descriptor reads fall
 * through to the instance unchanged.
 *
 * Trade-off: each method access returns a fresh bound function, so reference
 * identity is not stable (`svc.fs.write !== svc.fs.write`). That's acceptable
 * for the import surface, where instances are grabbed once and methods called.
 */
const bindLayerMethods = <T>(instance: T): T => {
    if (instance === null || typeof instance !== 'object') {
        return instance;
    }
    return new Proxy(instance as object, {
        get(target, prop) {
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function'
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (value as (...a: any[]) => unknown).bind(target)
                : value;
        },
    }) as T;
};

/**
 * Lazy lookup proxy over one layer's instance container.
 *
 * Extension modules are imported before the layers are constructed, so a name
 * read at module scope is normally still absent. Both levels therefore resolve
 * against the container on _every_ access: `extension.import('client').db`
 * captured at import time keeps working once the real client lands, which is
 * the whole point of the proxy.
 *
 * A name that never gets registered throws on first property read rather than
 * returning `undefined`, so a typo surfaces at the access site instead of
 * silently becoming a no-op. Callers probing for an optional layer entry must
 * do so inside a try/catch.
 */
const makeLayerImportProxy = (
    layer: string,
    containers: Record<string, unknown>,
): object =>
    new Proxy(
        {},
        {
            get: (_target: object, prop: string) => {
                const instance = containers[prop];
                if (instance) return bindLayerMethods(instance);
                return new Proxy(
                    {},
                    {
                        get: (_target2: object, prop2: string) => {
                            const late = containers[prop];
                            if (!late) {
                                throw new Error(
                                    `extension.import('${layer}:${prop}') missing property '${String(prop2)}'`,
                                );
                            }
                            return bindLayerMethods(late)[
                                prop2 as keyof typeof late
                            ];
                        },
                    },
                );
            },
        },
    );

export const extension = {
    // -- Config access -----------------------------------------------
    //
    // Lazy proxy to the server config. Populated by PuterServer during
    // boot, so extensions can read it at request time (not import time).

    get config(): IConfig {
        return configContainer;
    },

    // -- Event subscription -------------------------------------------

    on: <P extends ListenKey>(
        key: P,
        callback: (
            key: MatchingEvents<P>,
            data: EventMap[MatchingEvents<P>],
            meta: EventMetadata,
        ) => Promise<void> | void,
    ) => {
        if (!extensionStore.events[key]) {
            extensionStore.events[key] = [];
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extensionStore.events[key].push(callback as any);
    },

    // -- Registry writers ---------------------------------------------

    registerClient: (
        name: string,
        client: IPuterClientRegistry[keyof IPuterClientRegistry],
    ) => {
        extensionStore.clients[name] = client;
    },
    registerStore: (
        name: string,
        store: IPuterStoreRegistry[keyof IPuterStoreRegistry],
    ) => {
        extensionStore.stores[name] = store;
    },
    registerService: (
        name: string,
        service: IPuterServiceRegistry[keyof IPuterServiceRegistry],
    ) => {
        extensionStore.services[name] = service;
    },
    registerController: (
        name: string,
        controller: IPuterControllerRegistry[keyof IPuterControllerRegistry],
    ) => {
        extensionStore.controllers[name] = controller;
    },
    registerDriver: (
        name: string,
        driver: IPuterDriverRegistry[keyof IPuterDriverRegistry],
    ) => {
        extensionStore.drivers[name] = driver;
    },
    registerGlobalMiddleware: (middleware: RequestHandler) => {
        extensionStore.globalMiddlewares.push(middleware);
    },

    // -- Route registration -------------------------------------------
    //
    // Supports two call shapes per verb:
    //   extension.get('/path', handler)
    //   extension.get('/path', options, handler)
    //
    // The `options` object is the same `RouteOptions` shape controllers use,
    // so everything that works on a controller route (subdomain, requireAuth,
    // requireUserActor, adminOnly, allowedAppIds, middleware, bodyJson,
    // bodyRaw, bodyText, bodyUrlencoded) works here identically.

    get: makeRouteFn('get'),
    post: makeRouteFn('post'),
    put: makeRouteFn('put'),
    delete: makeRouteFn('delete'),
    patch: makeRouteFn('patch'),
    head: makeRouteFn('head'),
    options: makeRouteFn('options'),
    all: makeRouteFn('all'),
    use: makeUseFn(),

    // -- Import proxy -------------------------------------------------

    import: <S extends string>(
        name: S,
    ): S extends 'client' | 'clients'
        ? LayerInstances<typeof puterClients> & IExtensionClientInstances
        : S extends 'store' | 'stores'
          ? LayerInstances<typeof puterStores> & IExtensionStoreInstances
          : S extends 'service' | 'services'
            ? LayerInstances<typeof puterServices> & IExtensionServiceInstances
            : S extends 'controller' | 'controllers'
              ? LayerInstances<typeof puterControllers> &
                    IExtensionControllerInstances
              : S extends 'driver' | 'drivers'
                ? LayerInstances<typeof puterDrivers> &
                      IExtensionDriverInstances
                : never => {
        switch (name) {
            case 'clients':
            case 'client':
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return makeLayerImportProxy('client', clientsContainers) as any;
            case 'stores':
            case 'store':
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return makeLayerImportProxy('store', storesContainers) as any;
            case 'services':
            case 'service':
                return makeLayerImportProxy(
                    'service',
                    servicesContainers,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ) as any;
            case 'controllers':
            case 'controller':
                return makeLayerImportProxy(
                    'controller',
                    controllersContainers,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ) as any;
            case 'drivers':
            case 'driver':
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return makeLayerImportProxy('driver', driversContainers) as any;
            default:
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return undefined as any;
        }
    },
};
