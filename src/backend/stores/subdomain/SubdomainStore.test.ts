/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { SubdomainStore } from './SubdomainStore.js';

// ── Test harness ────────────────────────────────────────────────────
//
// Boots one PuterServer (in-memory sqlite + mock redis) and drives the
// live SubdomainStore. These cases are about the read/write cache
// interleaving specifically — the driver-level behaviour is covered by
// SubdomainDriver.test.ts.

let server: PuterServer;
let store: SubdomainStore;

beforeAll(async () => {
    server = await setupTestServer();
    store = server.stores.subdomain as unknown as SubdomainStore;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<number> => {
    const username = `sds-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    return created.id;
};

/** Mirrors `SubdomainStore.#cacheKey` — the read path keys rows by name. */
const cacheKey = (subdomain: string) => `subdomains:name:${subdomain}`;

describe('SubdomainStore cache coherency', () => {
    it('a cache-miss read cannot resurrect a pre-update row', async () => {
        const userId = await makeUser();
        const subdomain = `sds-clobber-${Math.random().toString(36).slice(2, 8)}`;

        const row = await store.create({ userId, subdomain, rootDirId: 111 });

        // Force the next lookup down the cache-miss path, which is where the
        // read populates the cache.
        await server.clients.redis.del(cacheKey(subdomain));

        // Stall just the read path's own `set`. The update path writes
        // through `pipeline()`, so this leaves it untouched and lets the
        // read's write land *after* the update's — the ordering a real
        // Redis round-trip can produce under load.
        let releaseReadWrite: (() => void) | undefined;
        const stalled = new Promise<void>((resolve) => {
            releaseReadWrite = resolve;
        });
        const realSet = server.clients.redis.set.bind(server.clients.redis);
        const setSpy = vi
            .spyOn(server.clients.redis, 'set')
            .mockImplementationOnce(async (...args: unknown[]) => {
                await stalled;
                return realSet(
                    ...(args as Parameters<typeof realSet>),
                );
            });

        try {
            // Read observes root_dir_id 111 and queues a cache write for it.
            const readBack = await store.getBySubdomain(subdomain);
            expect(readBack?.root_dir_id).toBe(111);

            // Update lands (and refreshes the cache) while that write is
            // still in flight.
            await store.update(row.uuid, { root_dir_id: 222 }, { userId });

            // Now let the stale write through.
            releaseReadWrite!();
            await vi.waitFor(() => expect(setSpy).toHaveBeenCalledTimes(1));
            // Drain the mocked write's continuation.
            await new Promise((r) => setImmediate(r));

            const after = await store.getBySubdomain(subdomain);
            expect(after?.root_dir_id).toBe(222);
        } finally {
            releaseReadWrite!();
            setSpy.mockRestore();
        }
    });

    it('update is visible to the next cache-backed read', async () => {
        const userId = await makeUser();
        const subdomain = `sds-update-${Math.random().toString(36).slice(2, 8)}`;
        const row = await store.create({ userId, subdomain, rootDirId: 1 });

        await store.getBySubdomain(subdomain);
        await store.update(row.uuid, { root_dir_id: 2 }, { userId });

        const after = await store.getBySubdomain(subdomain);
        expect(after?.root_dir_id).toBe(2);
    });

    it('delete leaves a negative marker rather than a stale row', async () => {
        const userId = await makeUser();
        const subdomain = `sds-delete-${Math.random().toString(36).slice(2, 8)}`;
        const row = await store.create({ userId, subdomain, rootDirId: 3 });

        await store.getBySubdomain(subdomain);
        await store.deleteByUuid(row.uuid, { userId });

        expect(await store.getBySubdomain(subdomain)).toBeNull();
    });
});
