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

const DEFAULT_BROADCAST_REFRESH_TTL_SECONDS = 15 * 60;

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

    /**
     * Refresh (pass `serializedData`) or invalidate (omit it) cache keys
     * locally AND broadcast the same mutation to peer nodes via
     * `outer.cacheUpdate`. Pipelined for cluster-mode safety (no
     * multi-key DEL/MSET that would CROSSSLOT on Valkey).
     */
    protected async publishCacheKeys(params: {
        keys: string[];
        serializedData?: string;
        ttlSeconds?: number;
    }): Promise<void> {
        const { keys, serializedData } = params;
        if (keys.length === 0) return;

        const ttl = Math.max(
            1,
            Math.floor(
                params.ttlSeconds ?? DEFAULT_BROADCAST_REFRESH_TTL_SECONDS,
            ),
        );

        try {
            const pipeline = this.clients.redis.pipeline();
            if (serializedData === undefined) {
                for (const key of keys) pipeline.del(key);
            } else {
                for (const key of keys) {
                    pipeline.set(key, serializedData, 'EX', ttl);
                }
            }
            await pipeline.exec();
        } catch {
            // Best-effort local cache write.
        }

        try {
            const payload =
                serializedData === undefined
                    ? { cacheKey: keys }
                    : { cacheKey: keys, data: serializedData, ttlSeconds: ttl };
            this.clients.event.emit('outer.cacheUpdate', payload, {});
        } catch {
            // Best-effort broadcast.
        }
    }
} satisfies IPuterStore<WithLifecycle>;

export type IPuterStoreRegistry = Record<
    string,
    | IPuterStore<WithLifecycle>
    | (InstanceType<IPuterStore<WithLifecycle>> & Record<string, unknown>)
>;
