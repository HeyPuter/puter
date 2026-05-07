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
import type {
    IExtensionStoreInstances,
    IPuterStoreInstances,
} from '../stores/types';
import type { IConfig, LayerInstances, WithLifecycle } from '../types';

/**
 * Built-in service instance registry. Forward-declared here and populated
 * via declaration merging from `services/index.ts` to avoid the circular
 * `typeof puterServices` reference (services extend `PuterService`, whose
 * `protected services` field references this type).
 *
 * Consumers see the merged `IPuterServiceInstances & IExtensionServiceInstances`
 * type — built-in keys + extension-augmented keys.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IPuterServiceInstances {}

/**
 * Extension-augmentable service registry. Extensions add their own service
 * instance types via TypeScript declaration merging:
 *
 *     declare module '@heyputer/backend/services/types' {
 *         interface IExtensionServiceInstances {
 *             myService: MyService;
 *         }
 *     }
 *
 * Augmentations flow into `this.services` (PuterController, PuterDriver) and
 * into the `extension.import('service')` proxy. NOT applied to `PuterService`'s
 * own `services` constructor argument — that view is the partial registry of
 * peers declared earlier than this service.
 */
export interface IExtensionServiceInstances {
    /**
     * Open index signature so reads of extension-only service keys return
     * `unknown` instead of a type error. Concrete declaration-merged keys
     * override this for that name.
     */
    [key: string]: unknown;
}

/**
 * Services may depend on clients, stores, and *prior* services (those
 * declared earlier in the registry).
 *
 * Type contract caveat: `services` is typed as the FULLY-populated registry,
 * even though at construction time only prior services exist. This is a
 * deliberate trade-off — almost every `this.services.X` access happens in
 * handler/lifecycle methods (which run after all services are wired up), so
 * the convenience of typed access in those sites outweighs the construction-
 * time inaccuracy. Don't read `this.services.X` from a service constructor
 * unless you've verified `X` is registered earlier in the registry.
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
