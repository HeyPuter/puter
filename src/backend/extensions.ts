import type { RequestHandler } from 'express';
import type { puterClients } from './clients';
import type { IPuterClientRegistry } from './clients/types';
import type { puterControllers } from './controllers';
import type { IPuterControllerRegistry } from './controllers/types';
import type {
    RouteDescriptor,
    RouteMethod,
    RouteOptions,
    RoutePath,
} from './core/http/types';
import type { puterDrivers } from './drivers';
import type { IPuterDriverRegistry } from './drivers/types';
import {
    clientsContainers,
    configContainer,
    controllersContainers,
    driversContainers,
    servicesContainers,
    storesContainers,
} from './exports';
import type { puterServices } from './services';
import type { IPuterServiceRegistry } from './services/types';
import type { puterStores } from './stores';
import type { IPuterStoreRegistry } from './stores/types';
import type { IConfig, LayerInstances } from './types';

/**
 * The in-memory registry an extension's module-scope code writes into, and
 * that `PuterServer` drains during boot. Every field is optional at write
 * time — an extension that only needs routes never touches the registries.
 */
export const extensionStore = {
    clients: {} as IPuterClientRegistry,
    stores: {} as IPuterStoreRegistry,
    services: {} as IPuterServiceRegistry,
    controllers: {} as IPuterControllerRegistry,
    drivers: {} as IPuterDriverRegistry,
    globalMiddlewares: [] as RequestHandler[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: {} as Record<string, ((...args: any[]) => void)[]>,
    /**
     * Extension-declared routes. Shape matches the controller-layer
     * `RouteDescriptor`, so both flow through the same materializer
     * (`PuterServer#materializeRoute`) and inherit the same options →
     * middleware translation (subdomain, auth, body parsers, ...).
     */
    routeHandlers: [] as RouteDescriptor[],
};

/**
 * Internal: normalize `(path, handler)` or `(path, options, handler)` into
 * a single `RouteDescriptor` the server can materialize.
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
 * `extension.use` mirrors `app.use` and supports three shapes:
 *   use(handler)
 *   use(options, handler)
 *   use(path, handler)
 *   use(path, options, handler)
 * Pathless calls register global middleware — the server materializer
 * drops the path when calling `app.use` (see `RouteDescriptor.path?`).
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
 *   - Registry writers: `registerClient`, `registerStore`, `registerService`,
 *     `registerController`, `registerDriver`.
 *   - Event subscription: `on(event, handler)`.
 *   - Imperative route registration: `get`, `post`, `put`, `delete`, `patch`,
 *     `head`, `options`, `all`, `use`. Each accepts the same `RouteOptions`
 *     vocabulary used by controllers (subdomain, requireAuth, bodyJson, …)
 *     so extension routes get identical gate + parser treatment.
 *   - Back-reference lookup: `import('service:foo')` / `'client:bar'` /
 *     `'store:baz'` / `'controller:qux'` / `'driver:fred'` — returns a lazy
 *     proxy to the registered instance (thrown on use-before-init).
 */
export const extension = {
    // ── Config access ───────────────────────────────────────────────
    //
    // Lazy proxy to the server config. Populated by PuterServer during
    // boot, so extensions can read it at request time (not import time).

    get config(): IConfig {
        return configContainer;
    },

    // ── Event subscription ───────────────────────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on: (event: string, handler: (...args: any[]) => void) => {
        if (!extensionStore.events[event]) {
            extensionStore.events[event] = [];
        }
        extensionStore.events[event].push(handler);
    },

    // ── Registry writers ─────────────────────────────────────────────

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

    // ── Route registration ───────────────────────────────────────────
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

    // ── Import proxy ─────────────────────────────────────────────────

    import: <S extends string>(
        name: S,
    ): S extends 'client'
        ? LayerInstances<typeof puterClients>
        : S extends 'store'
          ? LayerInstances<typeof puterStores>
          : S extends 'service'
            ? LayerInstances<typeof puterServices>
            : S extends 'controller'
              ? LayerInstances<typeof puterControllers>
              : S extends 'driver'
                ? LayerInstances<typeof puterDrivers>
                : never => {
        switch (name) {
            case 'client': {
                const proxyHandler = {
                    get: (_target: object, prop: string) => {
                        const proxiedObj = clientsContainers[prop];
                        if (!proxiedObj) {
                            throw new Error(
                                `Called before initialization: ${name}.${prop}`,
                            );
                        }
                        return proxiedObj;
                    },
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return new Proxy({}, proxyHandler) as any;
            }
            case 'store': {
                const proxyHandler = {
                    get: (_target: object, prop: string) => {
                        const proxiedObj = storesContainers[prop];
                        if (!proxiedObj) {
                            throw new Error(
                                `Called before initialization: ${name}.${prop}`,
                            );
                        }
                        return proxiedObj;
                    },
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return new Proxy({}, proxyHandler) as any;
            }
            case 'service': {
                const proxyHandler = {
                    get: (_target: object, prop: string) => {
                        const proxiedObj = servicesContainers[prop];
                        if (!proxiedObj) {
                            throw new Error(
                                `Called before initialization: ${name}.${prop}`,
                            );
                        }
                        return proxiedObj;
                    },
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return new Proxy({}, proxyHandler) as any;
            }
            case 'controller': {
                const proxyHandler = {
                    get: (_target: object, prop: string) => {
                        const proxiedObj = controllersContainers[prop];
                        if (!proxiedObj) {
                            throw new Error(
                                `Called before initialization: ${name}.${prop}`,
                            );
                        }
                        return proxiedObj;
                    },
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return new Proxy({}, proxyHandler) as any;
            }
            case 'driver': {
                const proxyHandler = {
                    get: (_target: object, prop: string) => {
                        const proxiedObj = driversContainers[prop];
                        if (!proxiedObj) {
                            throw new Error(
                                `Called before initialization: ${name}.${prop}`,
                            );
                        }
                        return proxiedObj;
                    },
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return new Proxy({}, proxyHandler) as any;
            }
            default:
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return undefined as any;
        }
    },
};
