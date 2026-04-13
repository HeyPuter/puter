/* eslint-disable @typescript-eslint/no-explicit-any */
import express from 'express';
import type { Application, RequestHandler } from 'express';
import { readdirSync, readFileSync } from 'node:fs';
import { puterClients } from './clients';
import { puterControllers } from './controllers';
import { createAuthProbe } from './core/http/middleware/authProbe';
import { createErrorHandler } from './core/http/middleware/errorHandler';
import {
    adminOnlyGate,
    allowedAppIdsGate,
    requireAuthGate,
    requireUserActorGate,
    subdomainGate,
} from './core/http/middleware/gates';
import { createNotFoundHandler } from './core/http/middleware/notFoundHandler';
import { PuterRouter } from './core/http/PuterRouter';
import { PREFIX_METADATA_KEY, type RouteDescriptor } from './core/http/types';
import type { AuthService } from './services/auth/AuthService';
import { puterDrivers } from './drivers';
import { clientsContainers, controllersContainers, driversContainers, servicesContainers, storesContainers } from './exports';
import { extensionStore } from './extensions';
import { puterServices } from './services';
import { puterStores } from './stores';
import type { IConfig, LayerInstances, WithControllerRegistration, WithLifecycle } from './types';

export class PuterServer {

    clients!: LayerInstances<typeof puterClients>;
    stores!: LayerInstances<typeof puterStores>;
    services!: LayerInstances<typeof puterServices>;
    controllers!: LayerInstances<typeof puterControllers>;
    drivers!: LayerInstances<typeof puterDrivers>;
    #config: IConfig;
    #app!: ReturnType<typeof express>;
    #server: ReturnType<ReturnType<typeof express>['listen']> | null = null;

    #ready: Promise<boolean>;

    constructor (config: IConfig, clients: typeof puterClients, stores: typeof puterStores, services: typeof puterServices, controllers: typeof puterControllers, drivers: typeof puterDrivers) {

        this.#config = config;
        this.#ready = this.#setupServer(clients, stores, services, controllers, drivers);
    }

    async #setupServer (clients: typeof puterClients, stores: typeof puterStores, services: typeof puterServices, controllers: typeof puterControllers, drivers: typeof puterDrivers) {

        const extensionDirs = this.#config.extensions;
        await this.#importExtensions(extensionDirs);

        this.clients = {} as typeof this.clients;
        for ( const [clientName, ClientClass] of Object.entries(clients) ) {
            this.clients[clientName] = (typeof ClientClass === 'object' ? ClientClass : (new (ClientClass as any)(this.#config)) as any);
            clientsContainers[clientName] = this.clients[clientName];
        }
        for ( const [clientName, ClientClass] of Object.entries(extensionStore.clients) ) {
            this.clients[clientName] = (typeof ClientClass === 'object' ? ClientClass : (new (ClientClass as any)(this.#config)) as any);
            clientsContainers[clientName] = this.clients[clientName];
        }

        this.stores = {} as typeof this.stores;
        for ( const [storeName, StoreClass] of Object.entries(stores) ) {
            this.stores[storeName] = (typeof StoreClass === 'object' ? StoreClass : (new (StoreClass as any)(this.#config, this.clients, this.stores)) as any);
            storesContainers[storeName] = this.stores[storeName];
        }
        for ( const [storeName, StoreClass] of Object.entries(extensionStore.stores) ) {
            this.stores[storeName] = (typeof StoreClass === 'object' ? StoreClass : (new (StoreClass as any)(this.#config, this.clients, this.stores)) as any);
            storesContainers[storeName] = this.stores[storeName];
        }

        this.services = {} as typeof this.services;
        for ( const [serviceName, ServiceClass] of Object.entries(services) ) {
            this.services[serviceName] = (typeof ServiceClass === 'object' ? ServiceClass : (new (ServiceClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            servicesContainers[serviceName] = this.services[serviceName];
        }
        for ( const [serviceName, ServiceClass] of Object.entries(extensionStore.services) ) {
            this.services[serviceName] = (typeof ServiceClass === 'object' ? ServiceClass : (new (ServiceClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            servicesContainers[serviceName] = this.services[serviceName];
        }

        // init express server here
        this.#app = express();
        this.#installGlobalMiddleware();

        this.controllers = {} as typeof this.controllers;
        for ( const [controllerName, ControllerClass] of Object.entries(controllers) ) {
            this.controllers[controllerName] = (typeof ControllerClass === 'object'
                ? ControllerClass
                : (new (ControllerClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            this.#registerControllerRoutes(controllerName, this.controllers[controllerName]);
            controllersContainers[controllerName] = this.controllers[controllerName];
        }
        for ( const [controllerName, ControllerClass] of Object.entries(extensionStore.controllers) ) {
            this.controllers[controllerName] = (typeof ControllerClass === 'object'
                ? ControllerClass
                : (new (ControllerClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            this.#registerControllerRoutes(controllerName, this.controllers[controllerName]);
            controllersContainers[controllerName] = this.controllers[controllerName];
        }

        this.drivers = {} as typeof this.drivers;
        for ( const [driverName, DriverClass] of Object.entries(drivers) ) {
            this.drivers[driverName] = (typeof DriverClass === 'object'
                ? DriverClass
                : (new (DriverClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            driversContainers[driverName] = this.drivers[driverName];
        }
        for ( const [driverName, DriverClass] of Object.entries(extensionStore.drivers) ) {
            this.drivers[driverName] = (typeof DriverClass === 'object'
                ? DriverClass
                : (new (DriverClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            driversContainers[driverName] = this.drivers[driverName];
        }

        // Register extension event listeners
        Object.entries(extensionStore.events).forEach(([event, handlers]) => {
            handlers.forEach(handler => {
                this.clients.event.on(event, handler);
            });
        });

        // TODO DS: register routes properly with options and middleware
        extensionStore.routeHandlers.forEach(({ method, path, handler }) => {
            (this.#app)[method](path, handler);
        });

        // Terminal middleware MUST install last — after every route + extension
        // route is registered, so the catch-all 404 only fires for genuinely
        // unmatched requests, and the error handler is reachable from any
        // thrown error in the stack above it.
        this.#installTerminalMiddleware();

        return true;
    }

    /**
     * Install always-on middleware on the express app, in the order they
     * must run at request time. Ordering note:
     *   - `express.json` must run before `authProbe` so `req.body.auth_token`
     *     is readable.
     *   - `authProbe` never rejects; it only populates `req.actor` if a valid
     *     token is present.
     *   - Per-route gate middleware (requireAuth, adminOnly, ...) lands in
     *     `#materializeRoute` as those options ship.
     */
    #installGlobalMiddleware () {
        this.#app.use(express.json({ limit: '50mb' }));

        const authService = this.services.auth as AuthService | undefined;
        if ( authService ) {
            this.#app.use(createAuthProbe({
                authService,
                cookieName: this.#config.cookie_name,
            }));
        }
    }

    /**
     * Install end-of-pipeline middleware. Order matters:
     *   1. The 404 catch-all runs only when no earlier route matched, so it
     *      must be installed *after* every controller + extension route.
     *   2. The error handler is the express terminal — it catches everything
     *      thrown by routes, gates, and the 404 above. Express 5 auto-forwards
     *      thrown errors (sync and async), so handlers can `throw new HttpError(...)`
     *      without `next(err)` ceremony.
     */
    #installTerminalMiddleware () {
        this.#app.use(createNotFoundHandler());
        this.#app.use(createErrorHandler());
    }

    /**
     * Walk a controller's declared routes (via `PuterRouter`) and register
     * each one against the underlying express app. Per-route option → middleware
     * translation lives here — when we add auth/subdomain/body-parsing
     * options, they get wired in at this single point without touching any
     * controller call site.
     */
    #registerControllerRoutes (controllerName: string, controller: WithControllerRegistration) {
        if ( ! controller.registerRoutes ) {
            throw new Error(`Controller ${controllerName} does not have registerRoutes method`);
        }

        // Controllers annotated with `@Controller('/prefix')` carry the prefix
        // on their prototype; bare (imperative) controllers default to ''.
        const prefix = (controller as unknown as Record<string, unknown>)[PREFIX_METADATA_KEY] as string | undefined;
        const router = new PuterRouter(prefix ?? '');
        controller.registerRoutes(router);

        for ( const route of router.routes ) {
            this.#materializeRoute(this.#app, router.prefix, route);
        }
    }

    #materializeRoute (app: Application, routerPrefix: string, route: RouteDescriptor) {
        const mwChain: RequestHandler[] = [];
        const opts = route.options;

        // Built-in gates, in execution order. Implication graph:
        //   adminOnly       => requireUserActor => requireAuth
        //   allowedAppIds   => requireAuth
        //   requireUserActor => requireAuth
        // We dedupe by only pushing requireAuthGate once when *any* of these
        // are set.

        // 1. Subdomain check first — wrong subdomain calls next('route')
        // and skips the rest of the chain cheaply.
        if ( opts.subdomain !== undefined ) {
            mwChain.push(subdomainGate(opts.subdomain));
        }

        const needsAuth = Boolean(
            opts.requireAuth
            || opts.requireUserActor
            || opts.adminOnly
            || opts.allowedAppIds,
        );
        if ( needsAuth ) mwChain.push(requireAuthGate());

        const needsUserActor = Boolean(opts.requireUserActor || opts.adminOnly);
        if ( needsUserActor ) mwChain.push(requireUserActorGate());

        if ( opts.adminOnly ) {
            const extras = Array.isArray(opts.adminOnly) ? opts.adminOnly : [];
            mwChain.push(adminOnlyGate(extras));
        }

        if ( opts.allowedAppIds ) {
            mwChain.push(allowedAppIdsGate(opts.allowedAppIds));
        }

        // Caller-supplied middleware runs after gates, before the handler.
        if ( opts.middleware ) mwChain.push(...opts.middleware);

        const fullPath = route.path !== undefined
            ? PuterServer.#joinPath(routerPrefix, route.path)
            : undefined;

        if ( route.method === 'use' ) {
            if ( fullPath !== undefined ) {
                app.use(fullPath as any, ...mwChain, route.handler);
            } else {
                app.use(...mwChain, route.handler);
            }
            return;
        }

        if ( fullPath === undefined ) {
            throw new Error(`Route method '${route.method}' requires a path`);
        }

        // All express + WebDAV verbs accept the same (path, ...handlers) shape.
        // The `RouteMethod` union is the allowlist of method names we expose.
        const method = app[route.method as keyof Application] as unknown;
        if ( typeof method !== 'function' ) {
            throw new Error(`Express app does not support method: ${route.method}`);
        }
        (method as (...args: unknown[]) => unknown).call(app, fullPath, ...mwChain, route.handler);
    }

    /**
     * Join a controller's prefix with a route path. RegExp / array paths are
     * passed through unprefixed (consistent with express's behavior and with
     * the v1 extensionController's assumption that decorator paths are strings).
     */
    static #joinPath (prefix: string, path: NonNullable<RouteDescriptor['path']>): string | RegExp | Array<string | RegExp> {
        if ( typeof path !== 'string' ) return path;
        if ( ! prefix ) return path;
        return `${prefix}/${path}`.replace(/\/+/g, '/');
    }

    async #importExtensions (extensionDirs: string[]) {
        for ( const extDir of extensionDirs ) {
            for ( const jsFileOrFolder of readdirSync(extDir) ) {
                // if its a folder, read the package.json to find the main file, otherwise if its a js/ts/mjs file, import it directly
                if ( jsFileOrFolder.endsWith('.js') || jsFileOrFolder.endsWith('.mjs') ) {
                    console.log(`Importing extension file ${extDir}/${jsFileOrFolder}`);
                    await import(`${extDir}/${jsFileOrFolder}`);
                } else if ( ! jsFileOrFolder.includes('.') ) {
                    const packageJson = JSON.parse(readFileSync(`${extDir}/${jsFileOrFolder}/package.json`, 'utf-8'));
                    const mainFile = packageJson.main;
                    console.log(`Importing extension file ${extDir}/${jsFileOrFolder}/${mainFile}`);
                    await import(`${extDir}/${jsFileOrFolder}/${mainFile}`);
                }
            }
        }
    }

    async start () {
        await this.#ready;
        this.#server = this.#app.listen(this.#config.port, () => {
            console.log(`PuterServer is listening on port: ${this.#config.port}`);
            for ( const client of Object.values(this.clients) as WithLifecycle[] ) {
                if ( client.onServerStart ) {
                    client.onServerStart();
                }
            }
            for ( const store of Object.values(this.stores) as WithLifecycle[] ) {
                if ( store.onServerStart ) {
                    store.onServerStart();
                }
            }
            for ( const service of Object.values(this.services) as WithLifecycle[] ) {
                if ( service.onServerStart ) {
                    service.onServerStart();
                }
            }
            for ( const controller of Object.values(this.controllers) as WithLifecycle[] ) {
                if ( controller.onServerStart ) {
                    controller.onServerStart();
                }
            }
            for ( const driver of Object.values(this.drivers) as WithLifecycle[] ) {
                if ( driver.onServerStart ) {
                    driver.onServerStart();
                }
            }
        });

    }

    async prepareShutdown () {
        if ( this.#server ) {
            this.#server.close(() => {
                console.log('PuterServer has stopped accepting new connections');
                for ( const client of Object.values(this.clients) as WithLifecycle[] ) {
                    if ( client.onServerPrepareShutdown ) {
                        client.onServerPrepareShutdown();
                    }
                }
                for ( const store of Object.values(this.stores) as WithLifecycle[] ) {
                    if ( store.onServerPrepareShutdown ) {
                        store.onServerPrepareShutdown();
                    }
                }
                for ( const service of Object.values(this.services) as WithLifecycle[] ) {
                    if ( service.onServerPrepareShutdown ) {
                        service.onServerPrepareShutdown();
                    }
                }
                for ( const controller of Object.values(this.controllers) as WithLifecycle[] ) {
                    if ( controller.onServerPrepareShutdown ) {
                        controller.onServerPrepareShutdown();
                    }
                }
                for ( const driver of Object.values(this.drivers) as WithLifecycle[] ) {
                    if ( driver.onServerPrepareShutdown ) {
                        driver.onServerPrepareShutdown();
                    }
                }
            });
        }
    }

    async shutdown () {
        if ( this.#server ) {
            console.log('PuterServer is shutting down');
            this.#server.closeAllConnections();
            for ( const client of Object.values(this.clients) as WithLifecycle[] ) {
                if ( client.onServerShutdown ) {
                    await client.onServerShutdown();
                }
            }
            for ( const store of Object.values(this.stores) as WithLifecycle[] ) {
                if ( store.onServerShutdown ) {
                    await store.onServerShutdown();
                }
            }
            for ( const service of Object.values(this.services) as WithLifecycle[] ) {
                if ( service.onServerShutdown ) {
                    await service.onServerShutdown();
                }
            }
            for ( const controller of Object.values(this.controllers) as WithLifecycle[] ) {
                if ( controller.onServerShutdown ) {
                    await controller.onServerShutdown();
                }
            }
            for ( const driver of Object.values(this.drivers) as WithLifecycle[] ) {
                if ( driver.onServerShutdown ) {
                    await driver.onServerShutdown();
                }
            }
        }
    }
}