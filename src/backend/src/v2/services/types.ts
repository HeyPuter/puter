import type { puterClients } from '../clients';
import type { puterStores } from '../stores';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

export type IPuterService<T extends WithLifecycle = WithLifecycle> = new (config: IConfig, clients: LayerInstances<typeof puterClients>, stores: LayerInstances<typeof puterStores>) => T;

export const PuterService = class PuterService implements WithLifecycle {
    constructor (protected config: IConfig, protected clients: LayerInstances<typeof puterClients>, protected stores: LayerInstances<typeof puterStores>) {
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
} satisfies IPuterService<WithLifecycle>;

export type IPuterServiceRegistry = Record<string, IPuterService<WithLifecycle> | (InstanceType<IPuterService<WithLifecycle>> & Record<string, unknown>)>;
