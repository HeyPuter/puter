import type { puterClients } from '../clients';
import type { puterStores } from '../stores';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

/**
 * Services may depend on clients, stores, and *prior* services (those declared
 * earlier in the registry). The `services` argument is the accumulating
 * registry — it only contains peers constructed before this one.
 */
export type IPuterService<T extends WithLifecycle = WithLifecycle> = new (
    config: IConfig,
    clients: LayerInstances<typeof puterClients>,
    stores: LayerInstances<typeof puterStores>,
    services: Partial<Record<string, WithLifecycle>>,
) => T;

export const PuterService = class PuterService implements WithLifecycle {
    constructor(
        protected config: IConfig,
        protected clients: LayerInstances<typeof puterClients>,
        protected stores: LayerInstances<typeof puterStores>,
        protected services: Partial<Record<string, WithLifecycle>> = {},
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
} satisfies IPuterService<WithLifecycle>;

export type IPuterServiceRegistry = Record<
    string,
    | IPuterService<WithLifecycle>
    | (InstanceType<IPuterService<WithLifecycle>> & Record<string, unknown>)
>;
