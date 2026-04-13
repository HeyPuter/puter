/* eslint-disable @typescript-eslint/no-explicit-any */
import express from 'express';
import { readdirSync, readFileSync } from 'node:fs';
import { puterClients } from './clients';
import { puterControllers } from './controllers';
import { puterDrivers } from './drivers';
import { clientsContainers, controllersContainers, driversContainers, servicesContainers, storesContainers } from './exports';
import { extensionStore } from './extensions';
import { puterServices } from './services';
import { puterStores } from './stores';
import type { IConfig, LayerInstances, WithLifecycle } from './types';

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
        // TODO DS: configure all the top level middleware and what not here

        this.controllers = {} as typeof this.controllers;
        for ( const [controllerName, ControllerClass] of Object.entries(controllers) ) {
            this.controllers[controllerName] = (typeof ControllerClass === 'object'
                ? ControllerClass
                : (new (ControllerClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            if ( ! controllersContainers[controllerName].registerRoutes ) {
                throw new Error(`Controller ${controllerName} does not have registerRoutes method`);
            } else {
                controllersContainers[controllerName].registerRoutes(this.#app);
            }
            controllersContainers[controllerName] = this.controllers[controllerName];
        }
        for ( const [controllerName, ControllerClass] of Object.entries(extensionStore.controllers) ) {
            this.controllers[controllerName] = (typeof ControllerClass === 'object'
                ? ControllerClass
                : (new (ControllerClass as any)(this.#config, this.clients, this.stores, this.services)) as any);
            if ( ! controllersContainers[controllerName].registerRoutes ) {
                throw new Error(`Controller ${controllerName} does not have registerRoutes method`);
            } else {
                controllersContainers[controllerName].registerRoutes(this.#app);
            }
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

        return true;
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