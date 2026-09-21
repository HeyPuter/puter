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
import type { puterServices } from '../services';
import type { IExtensionServiceInstances } from '../services/types';
import type { puterStores } from '../stores';
import type { IExtensionStoreInstances } from '../stores/types';
import type {
    DriverConcurrentConfig,
    DriverRateLimitConfig,
    DriverRequireSubscriptionConfig,
} from './meta';
import type { IConfig, LayerInstances, WithCostsReporting } from '../types';

/** Extension-augmentable driver registry; see `IExtensionClientInstances`. */
export interface IExtensionDriverInstances {
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
 * Base class for drivers. A driver implements a named interface (e.g.
 * `puter-chat-completion`); several drivers may implement the same one. Declare
 * it with `@Driver(interface, options)` or by setting the readonly fields below
 * imperatively.
 */
export const PuterDriver = class PuterDriver implements WithCostsReporting {
    /** The interface this driver implements. Set by `@Driver` or override. */
    declare readonly driverInterface?: string;
    /** Unique name within its interface. Set by `@Driver` or override. */
    declare readonly driverName?: string;
    /** When true, this is the default driver for its interface. */
    declare readonly isDefault?: boolean;
    /**
     * Rate-limit policy applied to RPC calls into this driver. Set by
     * `@Driver({ rateLimit: ... })` or declared imperatively. See
     * `DriverRateLimitConfig` in `./meta` for the shape.
     */
    declare readonly rateLimit?: DriverRateLimitConfig;
    /**
     * Concurrent in-flight policy applied to RPC calls into this driver. Set by
     * `@Driver({ concurrent: ... })` or declared imperatively. See
     * `DriverConcurrentConfig` in `./meta` for the shape.
     */
    declare readonly concurrent?: DriverConcurrentConfig;
    /**
     * When true, `/drivers/call` rejects bare account-session ("root") tokens
     * for this driver — callers need an app/worker token or a dashboard-minted
     * API token. Set by `@Driver({ noUserSession: true })` or declared
     * imperatively. See `DriverMeta.noUserSession` in `./meta`.
     */
    declare readonly noUserSession?: boolean;
    /**
     * Subscriber-only methods on this driver. Set by `@Driver({
     * requireSubscription: ... })` or declared imperatively. See
     * `DriverRequireSubscriptionConfig` in `./meta` for the shape.
     */
    declare readonly requireSubscription?: DriverRequireSubscriptionConfig;

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
    public getReportedCosts():
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        | Record<string, any>[] // eslint-disable-next-line @typescript-eslint/no-explicit-any
        | Promise<Record<string, any>[]> {
        return [];
    }
} satisfies IPuterDriver<WithCostsReporting>;

export type IPuterDriverRegistry = Record<
    string,
    | IPuterDriver<WithCostsReporting>
    | (InstanceType<IPuterDriver<WithCostsReporting>> & Record<string, unknown>)
>;
