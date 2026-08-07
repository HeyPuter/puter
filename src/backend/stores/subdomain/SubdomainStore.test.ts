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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import {
    WORKER_SUBDOMAIN_PREFIX,
    type SubdomainStore,
} from './SubdomainStore.js';

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
                return realSet(...(args as Parameters<typeof realSet>));
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

describe('SubdomainStore app_owner filtering', () => {
    const makeApp = async (ownerUserId: number) => {
        const name = `sds-app-${Math.random().toString(36).slice(2, 10)}`;
        return await server.stores.app.create(
            {
                name,
                title: name,
                index_url: `https://${name}.example.com/`,
            },
            { ownerUserId },
        );
    };

    const seed = async (
        userId: number,
        prefix: string,
        appOwner: number | null,
    ) => {
        const subdomain = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
        await store.create({ userId, subdomain, rootDirId: null, appOwner });
        return subdomain;
    };

    it('matches rows owned by any app in `appIds`', async () => {
        const userId = await makeUser();
        const prefix = `sds-multi-${Math.random().toString(36).slice(2, 6)}.`;
        const appA = await makeApp(userId);
        const appB = await makeApp(userId);
        const appC = await makeApp(userId);

        const a = await seed(userId, prefix, appA.id);
        const b = await seed(userId, prefix, appB.id);
        const c = await seed(userId, prefix, appC.id);
        const unowned = await seed(userId, prefix, null);

        const rows = await store.listByUserIdAndPrefix(userId, prefix, {
            appIds: [appA.id, appB.id],
        });
        const names = rows.map((r) => r.subdomain);
        expect(names).toContain(a);
        expect(names).toContain(b);
        expect(names).not.toContain(c);
        expect(names).not.toContain(unowned);

        const count = await store.countByUserIdAndPrefix(userId, prefix, {
            appIds: [appA.id, appB.id],
        });
        expect(count).toBe(2);
    });

    // An empty allow-list means "no app may own these rows". Degrading to an
    // unfiltered query here would hand a caller every worker the user has.
    it('matches nothing for an empty `appIds`', async () => {
        const userId = await makeUser();
        const prefix = `sds-empty-${Math.random().toString(36).slice(2, 6)}.`;
        const app = await makeApp(userId);
        await seed(userId, prefix, app.id);
        await seed(userId, prefix, null);

        expect(
            await store.listByUserIdAndPrefix(userId, prefix, { appIds: [] }),
        ).toEqual([]);
        expect(
            await store.countByUserIdAndPrefix(userId, prefix, { appIds: [] }),
        ).toBe(0);
    });

    it('counts only rows older than `createdBefore`', async () => {
        const userId = await makeUser();
        const prefix = `sds-aged-${Math.random().toString(36).slice(2, 6)}.`;
        const old = await seed(userId, prefix, null);
        await seed(userId, prefix, null);

        // `ts` defaults to now for both, so one is backdated to put the two
        // on opposite sides of the cutoff.
        await server.clients.db.write(
            'UPDATE `subdomains` SET `ts` = ? WHERE `subdomain` = ?',
            ['2020-01-15 12:00:00', old],
        );

        expect(
            await store.countByUserIdAndPrefix(userId, prefix, {
                createdBefore: '2020-02-01 00:00:00',
            }),
        ).toBe(1);
        // Older than everything, including the backdated row.
        expect(
            await store.countByUserIdAndPrefix(userId, prefix, {
                createdBefore: '2019-01-01 00:00:00',
            }),
        ).toBe(0);
        // Omitting it stays unfiltered.
        expect(await store.countByUserIdAndPrefix(userId, prefix)).toBe(2);
    });
});

// ── Listing, counting and scoping ───────────────────────────────────

describe('SubdomainStore listing and counting', () => {
    const prefix = () => `pfx${Math.random().toString(36).slice(2, 8)}-`;

    const createFor = async (
        userId: number,
        subdomain: string,
        extra: Record<string, unknown> = {},
    ) => store.create({ userId, subdomain, ...extra } as never);

    // `app_owner` is a FK onto `apps`, so the owning app has to exist.
    const makeApp = async (ownerUserId: number): Promise<number> => {
        const name = `sd-app-${Math.random().toString(36).slice(2, 10)}`;
        const app = await server.stores.app.create(
            { name, title: name, index_url: `https://${name}.example.com/` },
            { ownerUserId },
        );
        return app.id as number;
    };

    it('lists a user own subdomains, ordered by id, and never another user rows', async () => {
        const mine = await makeUser();
        const theirs = await makeUser();
        const p = prefix();
        const a = await createFor(mine, `${p}a`);
        const b = await createFor(mine, `${p}b`);
        await createFor(theirs, `${p}c`);

        const rows = await store.listByUserId(mine);
        expect(rows.map((r) => r.subdomain)).toEqual([
            a.subdomain,
            b.subdomain,
        ]);
        expect(await store.count({ userId: mine })).toBe(2);
    });

    it('paginates with limit, offset and afterId', async () => {
        const userId = await makeUser();
        const p = prefix();
        const created = [];
        for (const suffix of ['a', 'b', 'c', 'd']) {
            created.push(await createFor(userId, `${p}${suffix}`));
        }
        const all = await store.listByUserId(userId);
        const ids = all.map((r) => r.id);

        expect(
            (await store.listByUserId(userId, { limit: 2 })).map((r) => r.id),
        ).toEqual(ids.slice(0, 2));
        expect(
            (await store.listByUserId(userId, { limit: 2, offset: 2 })).map(
                (r) => r.id,
            ),
        ).toEqual(ids.slice(2));
        expect(
            (await store.listByUserId(userId, { afterId: ids[1] })).map(
                (r) => r.id,
            ),
        ).toEqual(ids.slice(2));
        // `offset: 0` must not append an OFFSET clause.
        expect(
            (await store.listByUserId(userId, { limit: 4, offset: 0 })).length,
        ).toBe(4);
    });

    it('filters by app owner and excludes a prefix', async () => {
        const userId = await makeUser();
        const p = prefix();
        const appId = await makeApp(userId);
        await createFor(userId, `${p}plain`);
        await createFor(userId, `${WORKER_SUBDOMAIN_PREFIX}${p}worker`);
        await createFor(userId, `${p}owned`, { appOwner: appId });

        const excluded = await store.listByUserId(userId, {
            excludePrefix: WORKER_SUBDOMAIN_PREFIX,
        });
        expect(
            excluded.every(
                (r) => !r.subdomain.startsWith(WORKER_SUBDOMAIN_PREFIX),
            ),
        ).toBe(true);
        expect(
            await store.count({
                userId,
                excludePrefix: WORKER_SUBDOMAIN_PREFIX,
            }),
        ).toBe(2);

        const owned = await store.listByUserId(userId, { appOwner: appId });
        expect(owned.map((r) => r.subdomain)).toEqual([`${p}owned`]);
        expect(await store.count({ userId, appOwner: appId })).toBe(1);
        // `appOwner: null` is "no filter", not "app_owner IS NULL".
        expect(await store.count({ userId, appOwner: null })).toBe(3);
    });

    it('listAll spans every user and counts with no filters at all', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const p = prefix();
        await createFor(a, `${p}one`);
        await createFor(b, `${p}two`);

        const rows = await store.listAll({ limit: 5000 });
        const names = rows.map((r) => r.subdomain);
        expect(names).toContain(`${p}one`);
        expect(names).toContain(`${p}two`);
        expect(await store.count()).toBeGreaterThanOrEqual(2);
    });

    it('countByUserId and existsBySubdomain answer the quota checks', async () => {
        const userId = await makeUser();
        const p = prefix();
        await createFor(userId, `${p}x`);

        expect(Number(await store.countByUserId(userId))).toBe(1);
        expect(await store.existsBySubdomain(`${p}x`)).toBe(true);
        expect(await store.existsBySubdomain(`${p}missing`)).toBe(false);
    });

    it('resolves custom domains by exact match and by listing', async () => {
        const userId = await makeUser();
        const p = prefix();
        const row = await createFor(userId, `${p}dom`);
        await store.update(row.uuid, { domain: `${p}example.com` });

        expect((await store.getByDomain(`${p}example.com`))?.uuid).toBe(
            row.uuid,
        );
        expect(await store.getByDomain('nobody.example')).toBeNull();
        expect(
            (await store.listByDomain(`${p}example.com`)).map(
                (r: { uuid: string }) => r.uuid,
            ),
        ).toEqual([row.uuid]);
    });

    it('lists and counts by prefix, scoped to the owner', async () => {
        const userId = await makeUser();
        const other = await makeUser();
        const p = prefix();
        await createFor(userId, `${p}one`);
        await createFor(userId, `${p}two`);
        await createFor(other, `${p}three`);

        expect(
            (await store.listByUserIdAndPrefix(userId, p)).map(
                (r) => r.subdomain,
            ),
        ).toEqual([`${p}one`, `${p}two`]);
        expect(await store.countByUserIdAndPrefix(userId, p)).toBe(2);

        // Missing user or prefix short-circuits to an empty result.
        expect(await store.listByUserIdAndPrefix(0, p)).toEqual([]);
        expect(
            await store.listByUserIdAndPrefix(
                userId,
                null as unknown as string,
            ),
        ).toEqual([]);
        expect(await store.countByUserIdAndPrefix(0, p)).toBe(0);
        expect(
            await store.countByUserIdAndPrefix(
                userId,
                null as unknown as string,
            ),
        ).toBe(0);
    });

    it('narrows a prefix listing by a single app id and paginates it', async () => {
        const userId = await makeUser();
        const p = prefix();
        const ownerAppId = await makeApp(userId);
        const otherAppId = await makeApp(userId);
        await createFor(userId, `${p}a`, { appOwner: ownerAppId });
        await createFor(userId, `${p}b`, { appOwner: ownerAppId });
        await createFor(userId, `${p}c`, { appOwner: otherAppId });

        expect(
            (
                await store.listByUserIdAndPrefix(userId, p, {
                    appId: ownerAppId,
                })
            ).map((r) => r.subdomain),
        ).toEqual([`${p}a`, `${p}b`]);
        expect(
            await store.countByUserIdAndPrefix(userId, p, {
                appId: ownerAppId,
            }),
        ).toBe(2);

        const page = await store.listByUserIdAndPrefix(userId, p, {
            limit: 1,
            offset: 1,
        });
        expect(page.map((r) => r.subdomain)).toEqual([`${p}b`]);

        const all = await store.listByUserIdAndPrefix(userId, p);
        const afterFirst = await store.listByUserIdAndPrefix(userId, p, {
            afterId: all[0].id,
        });
        expect(afterFirst.map((r) => r.subdomain)).toEqual([`${p}b`, `${p}c`]);
    });
});

// ── Reads, writes and scoping guards ────────────────────────────────

describe('SubdomainStore reads and writes', () => {
    it('getByUuid honours the owner scope', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        const row = await store.create({
            userId: owner,
            subdomain: `sc${Math.random().toString(36).slice(2, 8)}`,
        } as never);

        expect((await store.getByUuid(row.uuid))?.uuid).toBe(row.uuid);
        expect((await store.getByUuid(row.uuid, { userId: owner }))?.uuid).toBe(
            row.uuid,
        );
        expect(await store.getByUuid(row.uuid, { userId: other })).toBeNull();
        expect(await store.getByUuid('no-such-uuid')).toBeNull();
    });

    it('getByUuid can bypass the replica on a read-after-write', async () => {
        const owner = await makeUser();
        const row = await store.create({
            userId: owner,
            subdomain: `pr${Math.random().toString(36).slice(2, 8)}`,
        } as never);
        expect((await store.getByUuid(row.uuid, { primary: true }))?.uuid).toBe(
            row.uuid,
        );
    });

    it('getBySubdomain rejects an empty name and heals a stale negative marker', async () => {
        expect(await store.getBySubdomain('')).toBeNull();

        const owner = await makeUser();
        const name = `heal${Math.random().toString(36).slice(2, 8)}`;
        // Poison the cache with a negative marker, then create the row.
        expect(await store.getBySubdomain(name)).toBeNull();
        await store.create({ userId: owner, subdomain: name } as never);

        // A `primary` read skips the cache and repairs it.
        expect(
            (await store.getBySubdomain(name, { primary: true }))?.subdomain,
        ).toBe(name);
        expect((await store.getBySubdomain(name))?.subdomain).toBe(name);
    });

    it('requires a user and a name to create', async () => {
        await expect(store.create({ subdomain: 'x' } as never)).rejects.toThrow(
            'userId and subdomain are required',
        );
        await expect(store.create({ userId: 1 } as never)).rejects.toThrow(
            'userId and subdomain are required',
        );
    });

    it('short-circuits an update whose patch is entirely read-only', async () => {
        const owner = await makeUser();
        const name = `ro${Math.random().toString(36).slice(2, 8)}`;
        const row = await store.create({
            userId: owner,
            subdomain: name,
        } as never);

        const result = await store.update(row.uuid, {
            uuid: 'forged',
            user_id: 999,
        });
        expect(result?.uuid).toBe(row.uuid);
        expect(result?.user_id).toBe(owner);
    });

    it('will not let another user update or delete a subdomain', async () => {
        const owner = await makeUser();
        const attacker = await makeUser();
        const name = `own${Math.random().toString(36).slice(2, 8)}`;
        const row = await store.create({
            userId: owner,
            subdomain: name,
        } as never);

        expect(
            await store.update(
                row.uuid,
                { root_dir_id: 1234 },
                { userId: attacker },
            ),
        ).toBeNull();
        expect(
            (await store.getByUuid(row.uuid))?.root_dir_id ?? null,
        ).toBeNull();

        await store.deleteByUuid(row.uuid, { userId: attacker });
        expect(await store.getByUuid(row.uuid)).not.toBeNull();

        await store.deleteByUuid(row.uuid, { userId: owner });
        expect(await store.getByUuid(row.uuid)).toBeNull();
    });

    it('deleting an unknown uuid is a no-op', async () => {
        await expect(
            store.deleteByUuid('no-such-uuid'),
        ).resolves.toBeUndefined();
    });
});
