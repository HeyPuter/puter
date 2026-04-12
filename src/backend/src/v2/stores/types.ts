import type { puterClients } from '../clients';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

export type IPuterStore<T extends WithLifecycle = WithLifecycle> = new (config: IConfig, clients: LayerInstances<typeof puterClients>) => T;

export const PuterStore = class PuterStore implements WithLifecycle {
    constructor (protected config: IConfig, protected clients: LayerInstances<typeof puterClients>) {
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
} satisfies IPuterStore<WithLifecycle>;

export type IPuterStoreRegistry = Record<string, IPuterStore<WithLifecycle> | (InstanceType<IPuterStore<WithLifecycle>> & Record<string, unknown>)>;
