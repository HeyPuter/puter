import type { Application } from 'express';
import type { puterClients } from '../clients';
import type { puterServices } from '../services';
import type { puterStores } from '../stores';
import type { IConfig, LayerInstances, WithControllerRegistration } from '../types';

export type IPuterController<T extends WithControllerRegistration = WithControllerRegistration> = new (config: IConfig, clients: LayerInstances<typeof puterClients>, stores: LayerInstances<typeof puterStores>, services: LayerInstances<typeof puterServices> ) => T;

export const PuterController = class PuterController implements WithControllerRegistration {
    constructor (protected config: IConfig, protected clients: LayerInstances<typeof puterClients>, protected stores: LayerInstances<typeof puterStores>, protected services: LayerInstances<typeof puterServices>) {
    }
    public onServerStart () {
        return;
    }
    public onServerPrepareShutdown () {
        return;
    }
    public onServerShutdown () {
        return;
    }
    public registerRoutes (_app: Omit<Application, 'listen'>) {
    }

} satisfies IPuterController<WithControllerRegistration>;

export type IPuterControllerRegistry = Record<string, IPuterController<WithControllerRegistration> | (InstanceType<IPuterController<WithControllerRegistration>> & Record<string, unknown>)>;