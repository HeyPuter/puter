import type { RequestHandler } from 'express';
import type { IPuterClientRegistry } from './clients/types';
import type { IPuterControllerRegistry } from './controllers/types';
import type { IPuterDriverRegistry } from './drivers/types';
import { clientsContainers, controllersContainers, driversContainers, servicesContainers, storesContainers } from './exports';
import type { IPuterServiceRegistry } from './services/types';
import type { IPuterStoreRegistry } from './stores/types';

export const extensionStore = {
    clients: {} as IPuterClientRegistry,
    stores: {} as IPuterStoreRegistry,
    services: {} as IPuterServiceRegistry,
    controllers: {} as IPuterControllerRegistry,
    drivers: {} as IPuterDriverRegistry,
    events: {} as Record<string, ((eventData: unknown, metadata: object) => void)[]>,
    routeHandlers: [] as { method: string; path: string; handler: RequestHandler, options: unknown, middleware: unknown }[],
};
export const extension = {
    // TODO DS: type eventData somehow
    on: (event: string, handler: (eventData: unknown, metadata: object) => void ) => {
        if ( ! extensionStore.events[event] ) {
            extensionStore.events[event] = [];
        }
        extensionStore.events[event].push(handler);
    },
    registerClient: (name: string, client: IPuterClientRegistry[keyof IPuterClientRegistry]) => {
        extensionStore.clients[name] = client;
    },
    registerStore: (name: string, store: IPuterStoreRegistry[keyof IPuterStoreRegistry]) => {
        extensionStore.stores[name] = store;
    },
    registerService: (name: string, service: IPuterServiceRegistry[keyof IPuterServiceRegistry]) => {
        extensionStore.services[name] = service;
    },
    registerController: (name: string, controller: IPuterControllerRegistry[keyof IPuterControllerRegistry]) => {
        extensionStore.controllers[name] = controller;
    },
    registerDriver: (name: string, driver: IPuterDriverRegistry[keyof IPuterDriverRegistry]) => {
        extensionStore.drivers[name] = driver;
    },

    get: (path: string, handler: RequestHandler, options: unknown, middleware: unknown) => {
        extensionStore.routeHandlers.push({ method: 'get', path, handler, options, middleware });
    },
    post: (path: string, handler: RequestHandler, options: unknown, middleware: unknown) => {
        extensionStore.routeHandlers.push({ method: 'post', path, handler, options, middleware });
    },
    put: (path: string, handler: RequestHandler, options: unknown, middleware: unknown) => {
        extensionStore.routeHandlers.push({ method: 'put', path, handler, options, middleware });
    },
    delete: (path: string, handler: RequestHandler, options: unknown, middleware: unknown) => {
        extensionStore.routeHandlers.push({ method: 'delete', path, handler, options, middleware });
    },
    patch: (path: string, handler: RequestHandler, options: unknown, middleware: unknown) => {
        extensionStore.routeHandlers.push({ method: 'patch', path, handler, options, middleware });
    },
    use: (path: string, handler: RequestHandler, options: unknown, middleware: unknown) => {
        extensionStore.routeHandlers.push({ method: 'use', path, handler, options, middleware });
    },
    import: (name: string) => {
        const container = name.split(':')[0];
        switch ( container ) {
            case 'client':{
                const proxyHandler = {
                    get: (_target, prop: string) => {
                        const proxiedObj =  clientsContainers[prop];
                        if ( ! proxiedObj ) {
                            throw new Error(`Called before initialization: ${name}.${prop}`);
                        }
                        return proxiedObj;
                    } };
                return new Proxy({}, proxyHandler);
            }
            case 'store':{
                const proxyHandler = {
                    get: (_target, prop: string) => {
                        const proxiedObj =  storesContainers[prop];
                        if ( ! proxiedObj ) {
                            throw new Error(`Called before initialization: ${name}.${prop}`);
                        }
                        return proxiedObj;
                    } };
                return new Proxy({}, proxyHandler);
            }
            case 'service':{
                const proxyHandler = {
                    get: (_target, prop: string) => {
                        const proxiedObj =  servicesContainers[prop];
                        if ( ! proxiedObj ) {
                            throw new Error(`Called before initialization: ${name}.${prop}`);
                        }
                        return proxiedObj;
                    } };
                return new Proxy({}, proxyHandler);
            }
            case 'controller':{
                const proxyHandler = {
                    get: (_target, prop: string) => {
                        const proxiedObj =  controllersContainers[prop];
                        if ( ! proxiedObj ) {
                            throw new Error(`Called before initialization: ${name}.${prop}`);
                        }
                        return proxiedObj;
                    } };
                return new Proxy({}, proxyHandler);
            }
            case 'driver':{
                const proxyHandler = {
                    get: (_target, prop: string) => {
                        const proxiedObj =  driversContainers[prop];
                        if ( ! proxiedObj ) {
                            throw new Error(`Called before initialization: ${name}.${prop}`);
                        }
                        return proxiedObj;
                    } };
                return new Proxy({}, proxyHandler);
            }
            default:
                throw new Error(`Unknown import ${name}`);
        }
    },
};

globalThis.extension = extension;