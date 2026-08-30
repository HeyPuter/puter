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

import { describe, expect, it } from 'vitest';
import type { IConfig } from '../../types.js';
import {
    DeployedEventsWorkerResolver,
    eventsWorkerName,
    type EventsWorkerAddressingDeps,
} from './workerRuntime.js';

const APP = 'app-1111';
const OWNER_UUID = 'uuid-owner';

const deps = (over: {
    config?: Partial<IConfig>;
    app?: { owner_user_id: number } | null;
    owner?: { uuid: string } | null;
    row?: unknown;
}): EventsWorkerAddressingDeps => ({
    config: { extensions: [], port: 4100, ...over.config } as IConfig,
    stores: {
        app: {
            getByUid: () =>
                Promise.resolve(
                    'app' in over ? over.app : { owner_user_id: 7 },
                ),
        },
        user: {
            getById: () =>
                Promise.resolve(
                    'owner' in over ? over.owner : { uuid: OWNER_UUID },
                ),
        },
        subdomain: {
            getBySubdomain: () =>
                Promise.resolve('row' in over ? over.row : { id: 1 }),
        },
    },
});

describe('eventsWorkerName', () => {
    it('is deterministic, deployable, and not derivable from the app alone', () => {
        const name = eventsWorkerName(APP, OWNER_UUID);
        expect(name).toBe(eventsWorkerName(APP, OWNER_UUID));
        // The worker-name grammar the deploy machinery enforces.
        expect(name).toMatch(/^evw-[a-f0-9]{40}$/);
        expect(name).not.toBe(eventsWorkerName(APP, 'uuid-other'));
        expect(name).not.toContain(APP);
    });
});

describe('DeployedEventsWorkerResolver', () => {
    it('resolves a deployed worker to the public worker domain', async () => {
        const resolver = new DeployedEventsWorkerResolver(deps({}));
        await expect(resolver.resolveInvokeUrl(APP)).resolves.toBe(
            `https://${eventsWorkerName(APP, OWNER_UUID)}.puter.work`,
        );
    });

    it('resolves to the local dispatch host when workers run locally', async () => {
        const resolver = new DeployedEventsWorkerResolver(
            deps({ config: { workers: { localServer: true }, port: 4111 } }),
        );
        await expect(resolver.resolveInvokeUrl(APP)).resolves.toBe(
            `http://${eventsWorkerName(APP, OWNER_UUID)}.workers.puter.localhost:4111`,
        );
    });

    it('answers null for every missing link in the chain', async () => {
        for (const broken of [
            deps({ app: null }),
            deps({ owner: null }),
            deps({ row: null }),
        ]) {
            const resolver = new DeployedEventsWorkerResolver(broken);
            await expect(resolver.resolveInvokeUrl(APP)).resolves.toBeNull();
        }
    });
});
