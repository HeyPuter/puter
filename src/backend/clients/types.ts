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

import type { IConfig, WithLifecycle } from '../types';
import type { ClickhouseClient } from './clickhouse/ClickhouseClient';

/**
 * Extension-augmentable client registry. Extensions add typed keys by
 * declaration-merging this interface from `@heyputer/backend/clients/types`;
 * the result is what `this.clients` and `extension.import('client')` see. The
 * same pattern applies to the store, service, driver and controller
 * registries.
 */
export interface IExtensionClientInstances {
    /** Unmerged extension keys read as `unknown` rather than erroring. */
    [key: string]: unknown;

    /**
     * Registered by an extension; absent by default, so branch on it and fall
     * back to SQL.
     */
    clickhouse?: ClickhouseClient;
}

export interface IPuterClient<T extends WithLifecycle = WithLifecycle> {
    new (config: IConfig): T;
}

export const PuterClient = class PuterClient implements WithLifecycle {
    constructor(protected config: IConfig) {}
    public onServerStart() {
        return;
    }
    public onServerPrepareShutdown() {
        return;
    }
    public onServerShutdown() {
        return;
    }
} satisfies IPuterClient<WithLifecycle>;

export type IPuterClientRegistry = Record<
    string,
    | IPuterClient<WithLifecycle>
    | (InstanceType<IPuterClient<WithLifecycle>> & Record<string, unknown>)
>;
