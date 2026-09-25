/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { puterClients } from '../clients';
import type { IExtensionClientInstances } from '../clients/types';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

/**
 * Built-in store registry, populated by declaration merging from
 * `stores/index.ts` to avoid a circular `typeof puterStores` reference.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IPuterStoreInstances {}

/** Extension-augmentable store registry; see `IExtensionClientInstances`. */
export interface IExtensionStoreInstances {
    [key: string]: unknown;
}

/**
 * `stores` is typed as the full registry, but at construction time only stores
 * declared earlier exist. Read `this.stores.X` from lifecycle or handler
 * methods, not constructors.
 */
export type IPuterStore<T extends WithLifecycle = WithLifecycle> = new (
    config: IConfig,
    clients: LayerInstances<typeof puterClients> & IExtensionClientInstances,
    stores: IPuterStoreInstances & IExtensionStoreInstances,
) => T;

const DEFAULT_BROADCAST_REFRESH_TTL_SECONDS = 15 * 60;

export const PuterStore = class PuterStore implements WithLifecycle {
    constructor(
        protected config: IConfig,
        protected clients: LayerInstances<typeof puterClients> &
            IExtensionClientInstances,
        protected stores: IPuterStoreInstances &
            IExtensionStoreInstances = {} as IPuterStoreInstances &
            IExtensionStoreInstances,
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
     * locally. Pass `broadcast: true` to also send the same mutation to peer
     * nodes via `outer.cacheUpdate`. Pipelined for cluster-mode safety (no
     * multi-key DEL/MSET that would CROSSSLOT on Valkey).
     */
    protected async publishCacheKeys(params: {
        keys: string[];
        serializedData?: string;
        ttlSeconds?: number;
        broadcast?: boolean;
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
            console.warn(
                '[PuterStore] publishCacheKeys failed to update local cache:',
                keys,
            );
        }

        if (!params.broadcast) return;

        try {
            const payload =
                serializedData === undefined
                    ? { cacheKey: keys }
                    : { cacheKey: keys, data: serializedData, ttlSeconds: ttl };
            this.clients.event.emit('outer.cacheUpdate', payload, {});
        } catch {
            console.warn(
                '[PuterStore] publishCacheKeys failed to broadcast cache update:',
                keys,
            );
        }
    }
} satisfies IPuterStore<WithLifecycle>;

export type IPuterStoreRegistry = Record<
    string,
    | IPuterStore<WithLifecycle>
    | (InstanceType<IPuterStore<WithLifecycle>> & Record<string, unknown>)
>;
