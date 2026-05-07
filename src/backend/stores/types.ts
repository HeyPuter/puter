/**
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
 * Built-in store instance registry. Forward-declared here and populated via
 * declaration merging from `stores/index.ts` to avoid the circular
 * `typeof puterStores` reference (stores extend `PuterStore`, whose
 * `protected stores` field references this type).
 *
 * Consumers see the merged `IPuterStoreInstances & IExtensionStoreInstances`
 * type — built-in keys + extension-augmented keys.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IPuterStoreInstances {}

/**
 * Extension-augmentable store registry. Extensions add their own store
 * instance types via TypeScript declaration merging:
 *
 *     declare module '@heyputer/backend/stores/types' {
 *         interface IExtensionStoreInstances {
 *             myStore: MyStore;
 *         }
 *     }
 *
 * Augmentations flow into `this.stores` (PuterStore, PuterService,
 * PuterController, PuterDriver) and into the `extension.import('store')`
 * proxy.
 */
export interface IExtensionStoreInstances {
    /**
     * Open index signature so reads of extension-only store keys return
     * `unknown` instead of a type error. Concrete declaration-merged keys
     * override this for that name.
     */
    [key: string]: unknown;
}

/**
 * Stores may depend on clients and on *prior* stores (those declared
 * earlier in the registry).
 *
 * Type contract caveat: `stores` is typed as the FULLY-populated registry,
 * even though at construction time only prior stores exist. Same trade-off
 * as `PuterService.services` — handler/lifecycle methods (the dominant
 * read site) run after all stores are wired, so typed access wins. Don't
 * read `this.stores.X` from a store constructor unless `X` is registered
 * earlier.
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
     * locally. Pass `broadcast: true` to also send the same mutation to
     * peer nodes via `outer.cacheUpdate`. Pipelined for cluster-mode safety
     * (no multi-key DEL/MSET that would CROSSSLOT on Valkey).
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
