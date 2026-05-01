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
