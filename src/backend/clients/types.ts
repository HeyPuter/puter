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

import type { IConfig, WithLifecycle } from '../types';

/**
 * Extension-augmentable client registry. Extensions add their own client
 * instance types via TypeScript declaration merging:
 *
 *     declare module '@heyputer/backend/clients/types' {
 *         interface IExtensionClientInstances {
 *             myClient: MyClient;
 *         }
 *     }
 *
 * Augmentations flow into `this.clients` everywhere it's typed (PuterStore,
 * PuterService, PuterController, PuterDriver) and into the
 * `extension.import('client')` proxy.
 */
export interface IExtensionClientInstances {
    /**
     * Open index signature so reads of extension-only client keys return
     * `unknown` instead of a type error. Concrete declaration-merged keys
     * override this for that name.
     */
    [key: string]: unknown;
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
