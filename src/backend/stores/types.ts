import type { puterClients } from '../clients';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

/**
 * Stores may depend on clients and on *prior* stores (those declared earlier
 * in the registry). The `stores` argument is the accumulating registry — it
 * only contains peers constructed before this one.
 */
export type IPuterStore<T extends WithLifecycle = WithLifecycle> = new (
    config: IConfig,
    clients: LayerInstances<typeof puterClients>,
    stores: Partial<Record<string, WithLifecycle>>,
) => T;

export const PuterStore = class PuterStore implements WithLifecycle {
    constructor(
        protected config: IConfig,
        protected clients: LayerInstances<typeof puterClients>,
        protected stores: Partial<Record<string, WithLifecycle>> = {},
    ) {}
    public onServerStart() {
        return;
    }
    public onServerPrepareShutdown() {
        return;
    }
    public onServerShutdown() {
        return;
    }
} satisfies IPuterStore<WithLifecycle>;

export type IPuterStoreRegistry = Record<
    string,
    | IPuterStore<WithLifecycle>
    | (InstanceType<IPuterStore<WithLifecycle>> & Record<string, unknown>)
>;
