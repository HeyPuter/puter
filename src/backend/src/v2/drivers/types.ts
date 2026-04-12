import type { puterClients } from '../clients';
import type { puterServices } from '../services';
import type { puterStores } from '../stores';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

export type IPuterDriver<T extends WithLifecycle = WithLifecycle> = new (config: IConfig, clients: LayerInstances<typeof puterClients>, stores: LayerInstances<typeof puterStores>, services: LayerInstances<typeof puterServices> ) => T;

export const PuterDriver = class PuterDriver implements WithLifecycle {
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
} satisfies IPuterDriver<WithLifecycle>;

export type IPuterDriverRegistry = Record<string, IPuterDriver<WithLifecycle> | (InstanceType<IPuterDriver<WithLifecycle>> & Record<string, unknown>)>;
