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
import { setupTestServer } from '../../testUtil.ts';

let server;
let appStore;
let db;
let redis;

beforeAll(async () => {
    server = await setupTestServer();
    appStore = server.stores.app;
    db = server.clients.db;
    redis = server.clients.redis;
    // ioredis-mock is shared across servers in one process; ids restart.
    for (const key of await redis.keys('apps:*')) await redis.del(key);
});

afterAll(async () => {
    await server?.shutdown();
});

let ownerSeq = 7100;
const freshOwner = () => ownerSeq++;
const slug = () => Math.random().toString(36).slice(2, 10);

const createApp = (ownerUserId, fields = {}, opts = {}) => {
    const name = `cl-${slug()}`;
    return appStore.create(
        {
            name,
            title: name,
            index_url: `https://${name}.example.com/`,
            ...fields,
        },
        { ownerUserId, ...opts },
    );
};

const rawMetadata = async (id) => {
    const [row] = await db.read('SELECT `metadata` FROM `apps` WHERE `id` = ?', [
        id,
    ]);
    const value = row?.metadata;
    return typeof value === 'string' ? JSON.parse(value) : (value ?? null);
};

/** Replica reads of `apps` (and filetypes) return `stale`; the primary is real. */
const withLaggingReplica = async (stale, fn) => {
    const realRead = db.read.bind(db);
    // SQLite's `pread` goes through `read`; keep it on the real one.
    const preadSpy = vi.spyOn(db, 'pread').mockImplementation(realRead);
    const readSpy = vi
        .spyOn(db, 'read')
        .mockImplementation(async (sql, params) =>
            /FROM `apps`/.test(sql)
                ? stale.apps.map((r) => ({ ...r }))
                : /FROM `app_filetype_association`/.test(sql)
                  ? stale.filetypes.map((r) => ({ ...r }))
                  : realRead(sql, params),
        );
    try {
        return await fn();
    } finally {
        readSpy.mockRestore();
        preadSpy.mockRestore();
    }
};

const settle = () => new Promise((r) => setTimeout(r, 20));

// Ends the post-write window in which reads go to the primary and nothing is
// cached. ioredis-mock mishandles a pipelined SET on a key whose EX lapsed, so
// tests drop the markers instead of waiting them out.
const endChangeWindow = async () => {
    for (const key of await redis.keys('apps:*:deleted')) await redis.del(key);
};

describe('AppStore hosted-site app lookup cache', () => {
    const candidatesFor = (app) => [
        app.index_url,
        app.index_url.replace(/\/$/, ''),
    ];
    const countLookups = async (fn) => {
        const read = vi.spyOn(db, 'read');
        const pread = vi.spyOn(db, 'pread');
        const isLookup = ([sql]) =>
            /`owner_user_id` = \?/.test(sql) && /`index_url` IN/.test(sql);
        try {
            const result = await fn();
            return {
                result,
                reads: read.mock.calls.filter(isLookup).length,
                preads: pread.mock.calls.filter(isLookup).length,
            };
        } finally {
            read.mockRestore();
            pread.mockRestore();
        }
    };

    it('serves repeat lookups from the cache, misses included', async () => {
        const owner = freshOwner();
        const app = await createApp(owner);
        const other = `https://cl-none-${slug()}.example.com/`;
        await endChangeWindow();

        const { result, reads } = await countLookups(async () => {
            const out = [];
            for (let i = 0; i < 3; i++) {
                out.push(
                    await appStore.listOwnedByIndexUrlCandidates(
                        owner,
                        candidatesFor(app),
                    ),
                );
                out.push(
                    await appStore.listOwnedByIndexUrlCandidates(owner, [
                        other,
                    ]),
                );
                await settle();
            }
            return out;
        });

        expect(reads).toBe(2);
        expect(result[0].map((r) => r.uid)).toEqual([app.uid]);
        expect(result[4].map((r) => r.uid)).toEqual([app.uid]);
        expect(result[5]).toEqual([]);
    });

    it('sees a privacy flip made by direct SQL plus invalidateByUid on the next lookup', async () => {
        const owner = freshOwner();
        const app = await createApp(owner);
        await endChangeWindow();
        const before = await appStore.listOwnedByIndexUrlCandidates(
            owner,
            candidatesFor(app),
        );
        await settle();
        expect(Number(before[0].is_private)).toBe(0);

        await db.write('UPDATE `apps` SET `is_private` = 1 WHERE `uid` = ?', [
            app.uid,
        ]);
        await appStore.invalidateByUid(app.uid);
        // Past the window, only the generation keeps the old entry out.
        await endChangeWindow();

        const after = await appStore.listOwnedByIndexUrlCandidates(
            owner,
            candidatesFor(app),
            { requirePrivate: true },
        );
        expect(after.map((r) => r.uid)).toEqual([app.uid]);
        const unfiltered = await appStore.listOwnedByIndexUrlCandidates(
            owner,
            candidatesFor(app),
        );
        expect(Number(unfiltered[0].is_private)).toBe(1);
    });

    it('finds an app created after a cached miss', async () => {
        const owner = freshOwner();
        const name = `cl-${slug()}`;
        const url = `https://${name}.example.com/`;
        expect(
            await appStore.listOwnedByIndexUrlCandidates(owner, [url]),
        ).toEqual([]);
        await settle();

        const app = await createApp(owner, { name, index_url: url });
        await endChangeWindow();
        const found = await appStore.listOwnedByIndexUrlCandidates(owner, [
            url,
        ]);
        expect(found.map((r) => r.uid)).toEqual([app.uid]);
    });

    it('reads the primary right after a change and caches nothing a lagging replica served', async () => {
        const owner = freshOwner();
        const app = await createApp(owner);
        await endChangeWindow();
        const [stale] = await db.read(
            'SELECT `id`, `uid`, `name`, `title`, `is_private`, `owner_user_id`, `index_url` FROM `apps` WHERE `id` = ?',
            [app.id],
        );

        await db.write('UPDATE `apps` SET `is_private` = 1 WHERE `uid` = ?', [
            app.uid,
        ]);
        await appStore.invalidateByUid(app.uid);
        const result = await withLaggingReplica(
            { apps: [stale], filetypes: [] },
            async () => {
                const rows = await appStore.listOwnedByIndexUrlCandidates(
                    owner,
                    candidatesFor(app),
                );
                await settle();
                return rows;
            },
        );
        expect(Number(result[0].is_private)).toBe(1);
        expect(await redis.keys(`apps:hosted:v1:${owner}:*`)).toEqual([]);
    });

    it('keys entries by owner, candidate set and requirePrivate', async () => {
        const owner = freshOwner();
        const app = await createApp(owner);
        await endChangeWindow();
        await appStore.listOwnedByIndexUrlCandidates(owner, candidatesFor(app));
        await settle();

        expect(
            await appStore.listOwnedByIndexUrlCandidates(
                owner,
                candidatesFor(app),
                { requirePrivate: true },
            ),
        ).toEqual([]);
        expect(
            await appStore.listOwnedByIndexUrlCandidates(
                freshOwner(),
                candidatesFor(app),
            ),
        ).toEqual([]);
        expect(
            (
                await appStore.listOwnedByIndexUrlCandidates(
                    owner,
                    [...candidatesFor(app)].reverse(),
                )
            ).map((r) => r.uid),
        ).toEqual([app.uid]);
    });
});

describe('AppStore filetype associations on the cached row', () => {
    const filetypeReads = (spy) =>
        spy.mock.calls.filter(([sql]) =>
            /FROM `app_filetype_association`/.test(sql),
        ).length;

    it('caches associations with the row and refreshes them after a change', async () => {
        const app = await createApp(freshOwner());
        await appStore.setFiletypeAssociations(app.id, ['txt', '.MD']);
        await endChangeWindow();

        expect(
            (await appStore.getByUid(app.uid)).filetype_associations.sort(),
        ).toEqual(['md', 'txt']);
        await settle();

        const read = vi.spyOn(db, 'read');
        try {
            const warm = await appStore.getById(app.id);
            expect(warm.filetype_associations.sort()).toEqual(['md', 'txt']);
            expect(filetypeReads(read)).toBe(0);
        } finally {
            read.mockRestore();
        }

        await appStore.setFiletypeAssociations(app.id, ['csv']);
        expect((await appStore.getByUid(app.uid)).filetype_associations).toEqual(
            ['csv'],
        );
        expect(
            (await appStore.getByNames([app.name])).get(app.name)
                .filetype_associations,
        ).toEqual(['csv']);
    });

    it('does not cache associations a lagging replica still serves after a change', async () => {
        const app = await createApp(freshOwner());
        await appStore.setFiletypeAssociations(app.id, ['txt']);
        const [staleRow] = await db.read(
            'SELECT * FROM `apps` WHERE `id` = ?',
            [app.id],
        );
        await appStore.setFiletypeAssociations(app.id, ['csv']);

        const fresh = await withLaggingReplica(
            {
                apps: [staleRow],
                filetypes: [{ app_id: app.id, type: 'txt' }],
            },
            async () => {
                const row = await appStore.getByUid(app.uid);
                await settle();
                return row;
            },
        );
        expect(fresh.filetype_associations).toEqual(['csv']);
        expect(
            JSON.parse((await redis.get(`apps:uid:${app.uid}`)) ?? 'null'),
        ).toBeNull();
    });
});
