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
import type {
    IExtensionStoreInstances,
    IPuterStoreInstances,
} from '../stores/types';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

/**
 * Built-in service registry, populated by declaration merging from
 * `services/index.ts` to avoid a circular `typeof puterServices` reference.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IPuterServiceInstances {}

/** Extension-augmentable service registry; see `IExtensionClientInstances`. */
export interface IExtensionServiceInstances {
    [key: string]: unknown;
}

/**
 * `services` is typed as the full registry, but at construction time only
 * services declared earlier exist. Read `this.services.X` from lifecycle or
 * handler methods, not constructors.
 */
export type IPuterService<T extends WithLifecycle = WithLifecycle> = new (
    config: IConfig,
    clients: LayerInstances<typeof puterClients> & IExtensionClientInstances,
    stores: IPuterStoreInstances & IExtensionStoreInstances,
    services: IPuterServiceInstances & IExtensionServiceInstances,
) => T;

export const PuterService = class PuterService implements WithLifecycle {
    constructor(
        protected config: IConfig,
        protected clients: LayerInstances<typeof puterClients> &
            IExtensionClientInstances,
        protected stores: IPuterStoreInstances & IExtensionStoreInstances,
        protected services: IPuterServiceInstances &
            IExtensionServiceInstances = {} as IPuterServiceInstances &
            IExtensionServiceInstances,
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
