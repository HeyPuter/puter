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
import type { puterServices } from '../services';
import type { IExtensionServiceInstances } from '../services/types';
import type { puterStores } from '../stores';
import type { IExtensionStoreInstances } from '../stores/types';
import type { IConfig, LayerInstances, WithCostsReporting } from '../types';

/**
 * Extension-augmentable driver registry. Extensions add their own driver
 * instance types via TypeScript declaration merging:
 *
 *     declare module '@heyputer/backend/drivers/types' {
 *         interface IExtensionDriverInstances {
 *             myDriver: MyDriver;
 *         }
 *     }
 *
 * Augmentations flow into `this.drivers` (PuterController) and into the
 * `extension.import('driver')` proxy.
 */
export interface IExtensionDriverInstances {
    /**
     * Open index signature so reads of extension-only driver keys return
     * `unknown` instead of a type error. Concrete declaration-merged keys
     * override this for that name.
     */
    [key: string]: unknown;
}

export type IPuterDriver<T extends WithCostsReporting = WithCostsReporting> =
    new (
        config: IConfig,
        clients: LayerInstances<typeof puterClients> &
            IExtensionClientInstances,
        stores: LayerInstances<typeof puterStores> & IExtensionStoreInstances,
        services: LayerInstances<typeof puterServices> &
            IExtensionServiceInstances,
    ) => T;

/**
 * Base class for v2 drivers.
 *
 * A driver implements a named interface (e.g., `puter-chat-completion`) and
 * exposes methods that match the interface contract. Multiple drivers can
 * implement the same interface (e.g., `openai-completion` and `claude` both
 * implement `puter-chat-completion`).
 *
 * **Two ways to declare a driver:**
 *
 * 1. Decorator:
 *    ```ts
 *    @Driver('puter-chat-completion', { name: 'openai', default: true })
 *    class OpenAIChat extends PuterDriver { ... }
 *    ```
 *
 * 2. Imperative (no decorator):
 *    ```ts
 *    class OpenAIChat extends PuterDriver {
 *        readonly driverInterface = 'puter-chat-completion';
 *        readonly driverName = 'openai';
 *        readonly isDefault = true;
 *    }
 *    ```
 */
export const PuterDriver = class PuterDriver implements WithCostsReporting {
    /** The interface this driver implements. Set by `@Driver` or override. */
    declare readonly driverInterface?: string;
    /** Unique name within its interface. Set by `@Driver` or override. */
    declare readonly driverName?: string;
    /** When true, this is the default driver for its interface. */
    declare readonly isDefault?: boolean;

    constructor(
        protected config: IConfig,
        protected clients: LayerInstances<typeof puterClients> &
            IExtensionClientInstances,
        protected stores: LayerInstances<typeof puterStores> &
            IExtensionStoreInstances,
        protected services: LayerInstances<typeof puterServices> &
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
    public getReportedCosts(): Record<string, unknown>[] {
        return [];
    }
} satisfies IPuterDriver<WithCostsReporting>;

export type IPuterDriverRegistry = Record<
    string,
    | IPuterDriver<WithCostsReporting>
    | (InstanceType<IPuterDriver<WithCostsReporting>> & Record<string, unknown>)
>;
