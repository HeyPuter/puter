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

/**
 * `EventsWorkerDeployer` against stubbed layers — no real Cloudflare, no real
 * database — pinning the in-flight keying and the per-app deploy throttle
 * without booting the full test server.
 */

import MockRedis from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import { EVENTS_WORKER_DEPLOYS_PER_HOUR } from './limits.js';
import { EventsWorkerDeployer } from './workerDeploy.js';
import { eventsWorkerScript } from '../../services/events/workerRuntime.js';
import { handlerSetHash } from '../../services/events/workerSource.js';
import type { IConfig } from '../../types.js';

const SOURCE_HASH = 'a'.repeat(64);
const SCRIPT = eventsWorkerScript(
    handlerSetHash([{ name: 'h', sourceHash: SOURCE_HASH }]),
    '',
);

interface Owner {
    ownerUserId: number;
    suspended?: boolean;
}

/** The private layers shape `EventsWorkerDeployer` takes — not exported. */
type Layers = ConstructorParameters<typeof EventsWorkerDeployer>[0];

/** Stub layers whose only real dependency is a fresh redis mock. */
const makeLayers = (owners: Record<string, Owner | null>) => {
    const redis = new MockRedis.Cluster(['redis://localhost:7001']);
    const created: string[] = [];
    const layers = {
        config: {
            events: { workerRuntime: true, internalSecret: 'sekret' },
            // `#namespace()` needs a local-worker shape to resolve without
            // throwing — this stub never reaches a real Cloudflare or
            // Miniflare deploy either way.
            workers: { localServer: true },
        } as IConfig,
        clients: { redis },
        stores: {
            eventHandler: {
                allForApp: async (appUid: string) => [
                    {
                        appUid,
                        name: 'h',
                        source: 'async () => {}',
                        sourceHash: SOURCE_HASH,
                        createdAt: 0,
                        updatedAt: 0,
                    },
                ],
            },
            app: {
                getByUid: async (appUid: string) => {
                    const owner = owners[appUid];
                    return owner === null || owner === undefined
                        ? null
                        : { owner_user_id: owner.ownerUserId };
                },
            },
            user: {
                getById: async (id: number) => {
                    const owner = Object.values(owners).find(
                        (o) => o?.ownerUserId === id,
                    );
                    if (!owner) return null;
                    return {
                        id,
                        uuid: `uuid-${id}`,
                        username: `user-${id}`,
                        suspended: owner.suspended ?? false,
                    };
                },
            },
        },
        services: {},
        drivers: {
            workers: {
                create: async (args: { workerName: string }) => {
                    created.push(args.workerName);
                    return { success: true, errors: [] };
                },
            },
        },
    };
    return { layers: layers as unknown as Layers, created, redis };
};

describe('EventsWorkerDeployer.ensure', () => {
    it('keys in-flight deploys by app and script, not script alone', async () => {
        // Two apps whose handler sets hash identically, and so deploy as the
        // same script; only one has a live owner. Both `ensure()` calls run
        // synchronously back to back — keying the in-flight map by script
        // alone would collapse the second call into the first's outcome.
        const { layers } = makeLayers({
            'app-a': { ownerUserId: 1 },
            'app-b': { ownerUserId: 2, suspended: true },
        });
        const deployer = new EventsWorkerDeployer(layers);

        const [a, b] = await Promise.all([
            deployer.ensure('app-a', SCRIPT),
            deployer.ensure('app-b', SCRIPT),
        ]);
        expect(a).toBe('deployed');
        expect(b).toBe('no-owner');
    });

    it('refuses once the app has deployed past the hourly cap', async () => {
        const { layers, redis } = makeLayers({ 'app-c': { ownerUserId: 3 } });
        const deployer = new EventsWorkerDeployer(layers);
        const hour = new Date().toISOString().slice(0, 13);
        await redis.set(
            `ev:deploys:{app-c}:${hour}`,
            String(EVENTS_WORKER_DEPLOYS_PER_HOUR),
        );

        expect(await deployer.ensure('app-c', SCRIPT)).toBe('throttled');
    });

    it('deploys normally under the cap', async () => {
        const { layers } = makeLayers({ 'app-d': { ownerUserId: 4 } });
        const deployer = new EventsWorkerDeployer(layers);
        expect(await deployer.ensure('app-d', SCRIPT)).toBe('deployed');
    });
});
