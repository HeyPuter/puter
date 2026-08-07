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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../core/http/HttpError.js';
import { configContainer } from '../../exports.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { FSEntry, FSEntryCreateInput } from './FSEntry.js';
import { FSEntryStore } from './FSEntryStore.js';

describe('FSEntryStore', () => {
    it('quotes camelCase storage allowance aliases for Postgres', async () => {
        const queries: string[] = [];
        const config: IConfig = {
            port: 0,
            extensions: [],
            is_storage_limited: true,
            storage_capacity: 1000,
        };
        const clients = {
            db: {
                quoteIdentifier: (identifier: string) => `"${identifier}"`,
                read: async (query: string) => {
                    queries.push(query);
                    if (query.includes('SUM(size)')) {
                        return [{ totalUsage: 321 }];
                    }
                    return [{ freeStorage: 654 }];
                },
            },
            event: {
                emitAndWait: async () => undefined,
            },
        };
        const store = new FSEntryStore(
            config,
            clients as ConstructorParameters<typeof FSEntryStore>[1],
            {} as ConstructorParameters<typeof FSEntryStore>[2],
        );

        await expect(store.getUserStorageAllowance(42)).resolves.toEqual({
            curr: 321,
            max: 654,
        });
        expect(queries).toEqual([
            'SELECT COALESCE(SUM(size), 0) AS "totalUsage" FROM fsentries WHERE user_id = ?',
            'SELECT free_storage AS "freeStorage" FROM "user" WHERE id = ? LIMIT 1',
        ]);
    });
});

// ── Integration harness ─────────────────────────────────────────────
//
// The store's interesting behaviour is SQL-shaped: keyset pagination,
// LIKE escaping, INSERT IGNORE recovery, prefix rewrites and the legacy
// NULL-path lineage heal. All of it runs against the real in-memory
// database booted by `setupTestServer()`; fixtures are inserted as rows,
// never by stubbing the store's own methods.

let server: PuterServer;
let store: FSEntryStore;

beforeAll(async () => {
    server = await setupTestServer();
    store = server.stores.fsEntry as FSEntryStore;
});

afterAll(async () => {
    await server?.shutdown();
});

interface StoreUser {
    userId: number;
    username: string;
    home: string;
}

const makeUser = async (): Promise<StoreUser> => {
    const username = `fse-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    return { userId: created.id, username, home: `/${username}` };
};

const createFile = async (
    user: StoreUser,
    path: string,
    over: Partial<FSEntryCreateInput> = {},
): Promise<FSEntry> =>
    store.createEntry({
        userId: user.userId,
        uuid: uuidv4(),
        path,
        size: 1,
        contentType: 'text/plain',
        bucket: 'puter-local',
        bucketRegion: 'us-west-2',
        ...over,
    });

const caught = async (run: () => Promise<unknown>): Promise<HttpError> => {
    const error = await run().then(
        () => null,
        (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
};

/** Drop the `path` column, the legacy state the lineage heal exists for. */
const blankPath = async (uuid: string): Promise<void> => {
    await server.clients.db.write(
        'UPDATE fsentries SET path = NULL WHERE uuid = ?',
        [uuid],
    );
    await store.invalidateEntryCacheByUuid(uuid);
    await server.clients.redis.flushall?.();
};

const pathOf = async (uuid: string): Promise<string | null> => {
    const rows = (await server.clients.db.read(
        'SELECT path FROM fsentries WHERE uuid = ?',
        [uuid],
    )) as Array<{ path: string | null }>;
    return rows[0]?.path ?? null;
};

describe('FSEntryStore path normalization', () => {
    it('rejects an empty or traversing path everywhere it normalizes', async () => {
        const user = await makeUser();

        for (const path of ['   ', '/a/../b']) {
            const error = await caught(() => store.getEntryByPath(path));
            expect(error.statusCode).toBe(400);
        }

        await expect(
            store.getEntryByPath(`${user.home}/`),
        ).resolves.toMatchObject({ path: user.home });
    });
});

describe('FSEntryStore subdomain aggregation', () => {
    it('splits hosting subdomains from worker subdomains and builds addresses', async () => {
        const user = await makeUser();
        const dir = await store.createNonFileEntry({
            userId: user.userId,
            parent: (await store.getEntryByPath(user.home))!,
            name: 'site',
            kind: 'directory',
        });

        for (const subdomain of ['my-site', 'workers.puter.my-worker']) {
            await server.clients.db.write(
                'INSERT INTO subdomains (uuid, subdomain, user_id, root_dir_id) VALUES (?, ?, ?, ?)',
                [uuidv4(), subdomain, user.userId, dir.id],
            );
        }
        await store.invalidateEntryCacheByUuid(dir.uuid);

        const protocol = configContainer.protocol ?? 'https';
        const siteDomain =
            configContainer.static_hosting_domain ?? 'puter.site';

        const refreshed = (await store.getEntryByUuid(dir.uuid))!;
        expect(refreshed.subdomains).toEqual([
            {
                uuid: expect.any(String),
                subdomain: 'my-site',
                address: `${protocol}://my-site.${siteDomain}`,
            },
        ]);
        // Worker rows keep their `workers.puter.` prefix in the row but are
        // advertised on the worker domain under the bare name.
        expect(refreshed.workers).toEqual([
            {
                uuid: expect.any(String),
                subdomain: 'workers.puter.my-worker',
                address: `${protocol}://my-worker.puter.work`,
            },
        ]);
        expect(refreshed.hasWebsite).toBe(true);
    });

    it('reports no website for an entry with no subdomain rows', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/plain.txt`);
        expect(file.subdomains).toEqual([]);
        expect(file.workers).toEqual([]);
        expect(file.hasWebsite).toBe(false);
    });
});

describe('FSEntryStore cache invalidation', () => {
    it('invalidates every key of an entry addressed by path, uuid or id', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/cache.txt`);
        const keys = [
            `prodfsv2:fsentry:id:${file.id}`,
            `prodfsv2:fsentry:uuid:${file.uuid}`,
            `prodfsv2:fsentry:path:any:${file.path}`,
        ];

        for (const [label, invalidate] of [
            [
                'path',
                () =>
                    store.invalidateEntryCacheByPathForUser(
                        user.userId,
                        file.path,
                    ),
            ],
            ['uuid', () => store.invalidateEntryCacheByUuid(file.uuid)],
            ['id', () => store.invalidateEntryCacheById(file.id)],
        ] as Array<[string, () => Promise<void>]>) {
            // Warm the cache, then invalidate through this addressing mode.
            await store.getEntryByUuid(file.uuid);
            await invalidate();
            const remaining = await Promise.all(
                keys.map((key) => server.clients.redis.get(key)),
            );
            expect(remaining, label).toEqual([null, null, null]);
        }
    });

    it('still clears the path key when no row exists at that path', async () => {
        const user = await makeUser();
        const key = `prodfsv2:fsentry:path:any:${user.home}/Documents/stale.txt`;
        await server.clients.redis.setex(key, 60, '{"uuid":"stale"}');

        await store.invalidateEntryCacheByPathForUser(
            user.userId,
            `${user.home}/Documents/stale.txt`,
        );

        await expect(server.clients.redis.get(key)).resolves.toBeNull();
    });

    it('falls back to the cached copy to find the keys of a deleted entry', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/gone.txt`);
        await store.getEntryByUuid(file.uuid);
        await server.clients.db.write('DELETE FROM fsentries WHERE id = ?', [
            file.id,
        ]);

        await store.invalidateEntryCacheByUuid(file.uuid);
        await expect(
            server.clients.redis.get(`prodfsv2:fsentry:path:any:${file.path}`),
        ).resolves.toBeNull();

        // Same for the id-addressed variant, from a re-warmed cache.
        await server.clients.redis.setex(
            `prodfsv2:fsentry:id:${file.id}`,
            60,
            JSON.stringify(file),
        );
        await store.invalidateEntryCacheById(file.id);
        await expect(
            server.clients.redis.get(`prodfsv2:fsentry:id:${file.id}`),
        ).resolves.toBeNull();
    });

    it('ignores invalidation calls with no usable identifier', async () => {
        await expect(
            store.invalidateEntryCacheByUuid(''),
        ).resolves.toBeUndefined();
        await expect(
            store.invalidateEntryCacheByUuid(null as unknown as string),
        ).resolves.toBeUndefined();
        await expect(
            store.invalidateEntryCacheById(Number.NaN),
        ).resolves.toBeUndefined();
        await expect(
            store.invalidateEntryCacheById('7' as unknown as number),
        ).resolves.toBeUndefined();
    });

    it('clears the uuid key for an entry that was never cached or stored', async () => {
        const uuid = uuidv4();
        await expect(
            store.invalidateEntryCacheByUuid(uuid),
        ).resolves.toBeUndefined();
        await expect(
            store.invalidateEntryCacheById(-1),
        ).resolves.toBeUndefined();
    });
});

describe('FSEntryStore legacy NULL-path healing', () => {
    it('resolves and backfills a path-less row looked up by path', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/heal.txt`);
        await blankPath(file.uuid);

        const resolved = await store.getEntryByPath(
            `${user.home}/Documents/heal.txt`,
        );

        expect(resolved?.uuid).toBe(file.uuid);
        expect(resolved?.path).toBe(`${user.home}/Documents/heal.txt`);
        await expect(pathOf(file.uuid)).resolves.toBe(
            `${user.home}/Documents/heal.txt`,
        );
    });

    it('returns null when a path segment cannot be resolved', async () => {
        const user = await makeUser();
        await expect(
            store.getEntryByPath(`${user.home}/Documents/nowhere/deep.txt`),
        ).resolves.toBeNull();
    });

    it('heals upward from a uuid or id lookup', async () => {
        const user = await makeUser();
        const byUuid = await createFile(user, `${user.home}/Documents/up1.txt`);
        const byId = await createFile(user, `${user.home}/Documents/up2.txt`);
        await blankPath(byUuid.uuid);
        await blankPath(byId.uuid);

        await expect(store.getEntryByUuid(byUuid.uuid)).resolves.toMatchObject({
            path: `${user.home}/Documents/up1.txt`,
        });
        await expect(store.getEntryById(byId.id)).resolves.toMatchObject({
            path: `${user.home}/Documents/up2.txt`,
        });
    });

    it('leaves an entry alone when its ancestor chain is broken', async () => {
        const user = await makeUser();
        const orphan = await createFile(
            user,
            `${user.home}/Documents/orphan.txt`,
        );
        await server.clients.db.write(
            'UPDATE fsentries SET path = NULL, parent_uid = ? WHERE uuid = ?',
            ['does-not-exist', orphan.uuid],
        );
        await server.clients.redis.flushall?.();

        await expect(store.getEntryByUuid(orphan.uuid)).resolves.toMatchObject({
            uuid: orphan.uuid,
            path: null,
        });
    });

    it('heals path-less rows surfaced by a batched id lookup and by search', async () => {
        const user = await makeUser();
        const file = await createFile(
            user,
            `${user.home}/Documents/batch-heal.txt`,
        );
        await blankPath(file.uuid);

        const byIds = await store.getEntriesByIds([file.id, file.id]);
        expect(byIds.get(file.id)?.path).toBe(
            `${user.home}/Documents/batch-heal.txt`,
        );

        await blankPath(file.uuid);
        const found = await store.searchByNameForUser(
            user.userId,
            'batch-heal',
        );
        expect(found[0]?.path).toBe(`${user.home}/Documents/batch-heal.txt`);
    });
});

describe('FSEntryStore batched lookups', () => {
    it('dedupes ids, drops non-numeric ones and omits misses', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/ids.txt`);

        await expect(store.getEntriesByIds([])).resolves.toEqual(new Map());
        await expect(
            store.getEntriesByIds(null as unknown as number[]),
        ).resolves.toEqual(new Map());
        await expect(
            store.getEntriesByIds(['x' as unknown as number]),
        ).resolves.toEqual(new Map());

        const result = await store.getEntriesByIds([
            file.id,
            file.id,
            9_999_999,
        ]);
        expect([...result.keys()]).toEqual([file.id]);

        // A second call is served from the warm cache.
        const cached = await store.getEntriesByIds([file.id]);
        expect(cached.get(file.id)?.uuid).toBe(file.uuid);
    });

    it('maps paths to entries and skips unknown ones', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/p1.txt`);

        await expect(store.getEntriesByPaths([])).resolves.toEqual(new Map());

        const result = await store.getEntriesByPaths([
            `${user.home}/Documents/p1.txt`,
            `${user.home}/Documents/p1.txt`,
            `${user.home}/Documents/absent.txt`,
        ]);
        expect([...result.keys()]).toEqual([`${user.home}/Documents/p1.txt`]);
        expect(result.get(`${user.home}/Documents/p1.txt`)?.uuid).toBe(
            file.uuid,
        );

        // Warm-cache path.
        const again = await store.getEntriesByPaths([
            `${user.home}/Documents/p1.txt`,
        ]);
        expect(again.size).toBe(1);
    });

    it('hides entries outside the caller namespace unless crossNamespace is set', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        const file = await createFile(owner, `${owner.home}/Documents/ns.txt`);

        const [ownView] = await store.getEntriesByPathsForUser(owner.userId, [
            file.path,
        ]);
        expect(ownView?.uuid).toBe(file.uuid);

        const [foreignView] = await store.getEntriesByPathsForUser(
            other.userId,
            [file.path],
        );
        expect(foreignView).toBeNull();

        const [crossView] = await store.getEntriesByPathsForUser(
            other.userId,
            [file.path],
            { crossNamespace: true },
        );
        expect(crossView?.uuid).toBe(file.uuid);
    });

    it('returns null for every path when the caller user does not exist', async () => {
        const owner = await makeUser();
        const file = await createFile(owner, `${owner.home}/Documents/nx.txt`);

        const [view] = await store.getEntriesByPathsForUser(9_999_999, [
            file.path,
        ]);
        expect(view).toBeNull();
    });
});

describe('FSEntryStore directory resolution', () => {
    it('creates a missing chain only when asked, and reports what it created', async () => {
        const user = await makeUser();

        const missing = await caught(() =>
            store.resolveParentDirectory(
                user.userId,
                `${user.home}/Documents/a/b`,
                false,
            ),
        );
        expect(missing.statusCode).toBe(404);

        const created = await store.resolveParentDirectory(
            user.userId,
            `${user.home}/Documents/a/b`,
            true,
        );
        expect(created.path).toBe(`${user.home}/Documents/a/b`);
        expect(created.isDir).toBe(true);

        // Second call resolves the existing directory instead of creating it.
        const resolved = await store.resolveParentDirectory(
            user.userId,
            `${user.home}/Documents/a/b`,
            true,
        );
        expect(resolved.uuid).toBe(created.uuid);
    });

    it('refuses to treat a file as a directory', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/afile`);

        const direct = await caught(() =>
            store.resolveParentDirectory(
                user.userId,
                `${user.home}/Documents/afile`,
                true,
            ),
        );
        expect(direct.statusCode).toBe(409);
        expect(direct.message).toContain('Path is not a directory');

        const nested = await caught(() =>
            store.resolveParentDirectory(
                user.userId,
                `${user.home}/Documents/afile/deeper`,
                true,
            ),
        );
        expect(nested.statusCode).toBe(409);
    });

    it('reports the directories a batch had to create, once each', async () => {
        const user = await makeUser();

        const { parentEntries, createdDirectoryEntries } =
            await store.resolveParentDirectoriesBatchWithCreated(user.userId, [
                {
                    parentPath: `${user.home}/Documents/x/y`,
                    createPaths: true,
                },
                {
                    parentPath: `${user.home}/Documents/x/z`,
                    createPaths: true,
                },
            ]);

        expect(parentEntries.map((entry) => entry.path)).toEqual([
            `${user.home}/Documents/x/y`,
            `${user.home}/Documents/x/z`,
        ]);
        expect(
            createdDirectoryEntries.map((entry) => entry.path).sort(),
        ).toEqual([
            `${user.home}/Documents/x`,
            `${user.home}/Documents/x/y`,
            `${user.home}/Documents/x/z`,
        ]);
    });

    it('returns nothing for an empty batch', async () => {
        await expect(
            store.resolveParentDirectoriesBatch(1, []),
        ).resolves.toEqual([]);
        await expect(store.ensureDirectoriesForUser(1, [])).resolves.toEqual(
            [],
        );
        await expect(
            store.resolveParentDirectoriesBatchWithCreated(1, []),
        ).resolves.toEqual({ parentEntries: [], createdDirectoryEntries: [] });
    });

    it('fails the batch when a requested parent is absent or is a file', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/blocker`);

        const absent = await caught(() =>
            store.resolveParentDirectoriesBatch(user.userId, [
                {
                    parentPath: `${user.home}/Documents/absent`,
                    createPaths: false,
                },
            ]),
        );
        expect(absent.statusCode).toBe(404);

        const notADir = await caught(() =>
            store.resolveParentDirectoriesBatch(user.userId, [
                {
                    parentPath: `${user.home}/Documents/blocker`,
                    createPaths: false,
                },
            ]),
        );
        expect(notADir.statusCode).toBe(409);
    });

    it('ensures directories and refuses the root path', async () => {
        const user = await makeUser();

        const entries = await store.ensureDirectoriesForUser(user.userId, [
            { path: `${user.home}/Documents/ens/deep`, createPaths: true },
        ]);
        expect(entries[0]?.path).toBe(`${user.home}/Documents/ens/deep`);

        const root = await caught(() =>
            store.ensureDirectoriesForUser(user.userId, [
                { path: '/', createPaths: true },
            ]),
        );
        expect(root.statusCode).toBe(400);
        expect(root.message).toBe('Cannot create root directory');
    });

    it('fails when an ensured directory is missing or occupied by a file', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/occupier`);

        const missing = await caught(() =>
            store.ensureDirectoriesForUser(user.userId, [
                {
                    path: `${user.home}/Documents/never`,
                    createPaths: false,
                },
            ]),
        );
        expect(missing.statusCode).toBe(404);
        expect(missing.message).toContain('Directory path does not exist');

        const occupied = await caught(() =>
            store.ensureDirectoriesForUser(user.userId, [
                {
                    path: `${user.home}/Documents/occupier`,
                    createPaths: false,
                },
            ]),
        );
        expect(occupied.statusCode).toBe(409);
    });
});

describe('FSEntryStore entry creation', () => {
    it('rejects writes at or directly under the root path', async () => {
        const user = await makeUser();

        const root = await caught(() => createFile(user, '/'));
        expect(root.legacyCode).toBe('cannot_write_to_root');

        const topLevel = await caught(() => createFile(user, '/toplevel.txt'));
        expect(topLevel.statusCode).toBe(400);
        expect(topLevel.message).toBe('Cannot write directly under root path');
    });

    it('rejects a negative size', async () => {
        const user = await makeUser();
        const error = await caught(() =>
            createFile(user, `${user.home}/Documents/neg.txt`, { size: -1 }),
        );
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('Invalid size');
    });

    it('returns nothing for an empty batch', async () => {
        await expect(store.batchCreateEntries([])).resolves.toEqual([]);
    });

    it('rejects a batch that names the same target twice for one user', async () => {
        const user = await makeUser();
        const input = (): FSEntryCreateInput => ({
            userId: user.userId,
            uuid: uuidv4(),
            path: `${user.home}/Documents/twice.txt`,
            size: 1,
            bucket: 'puter-local',
            bucketRegion: 'us-west-2',
        });

        const error = await caught(() =>
            store.batchCreateEntries([input(), input()]),
        );
        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('duplicate target path');
    });

    it('creates entries for several users in one batch', async () => {
        const first = await makeUser();
        const second = await makeUser();

        const entries = await store.batchCreateEntries([
            {
                userId: first.userId,
                uuid: uuidv4(),
                path: `${first.home}/Documents/multi.txt`,
                size: 2,
                bucket: 'puter-local',
                bucketRegion: 'us-west-2',
            },
            {
                userId: second.userId,
                uuid: uuidv4(),
                path: `${second.home}/Documents/multi.txt`,
                size: 3,
                bucket: 'puter-local',
                bucketRegion: 'us-west-2',
            },
        ]);

        expect(entries.map((entry) => entry.userId)).toEqual([
            first.userId,
            second.userId,
        ]);
        expect(entries.map((entry) => entry.size)).toEqual([2, 3]);
    });

    it('overwrites an existing file in place, keeping its row id', async () => {
        const user = await makeUser();
        const original = await createFile(
            user,
            `${user.home}/Documents/ow.txt`,
            { size: 1 },
        );

        const [updated] = await store.batchCreateEntries([
            {
                userId: user.userId,
                uuid: uuidv4(),
                path: `${user.home}/Documents/ow.txt`,
                size: 42,
                overwrite: true,
                isPublic: true,
                immutable: true,
                thumbnail: 'data:image/png;base64,AA',
                bucket: 'puter-local',
                bucketRegion: 'us-west-2',
            },
        ]);

        expect(updated?.id).toBe(original.id);
        expect(updated?.size).toBe(42);
        expect(updated?.isPublic).toBe(true);
        expect(updated?.immutable).toBe(true);
        expect(updated?.thumbnail).toBe('data:image/png;base64,AA');
    });

    it('refuses to clobber an existing entry without overwrite, or a directory with it', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/keep.txt`);
        await store.ensureDirectoriesForUser(user.userId, [
            { path: `${user.home}/Documents/keepdir`, createPaths: true },
        ]);

        const noOverwrite = await caught(() =>
            createFile(user, `${user.home}/Documents/keep.txt`),
        );
        expect(noOverwrite.statusCode).toBe(409);
        expect(noOverwrite.legacyCode).toBe('conflict');

        const overDir = await caught(() =>
            createFile(user, `${user.home}/Documents/keepdir`, {
                overwrite: true,
            }),
        );
        expect(overDir.legacyCode).toBe('cannot_overwrite_a_directory');
    });

    it('propagates the underlying failure when an overwrite update fails', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/upfail.txt`);

        const db = server.clients.db;
        const originalWrite = (Object.getPrototypeOf(db) as typeof db).write;
        const writeSpy = vi
            .spyOn(db, 'write')
            .mockImplementation(async (sql: string, params?: unknown[]) => {
                if (sql.includes('UPDATE fsentries')) {
                    throw new Error('update rejected');
                }
                return originalWrite.call(db, sql, params);
            });

        await expect(
            createFile(user, `${user.home}/Documents/upfail.txt`, {
                overwrite: true,
            }),
        ).rejects.toThrow('update rejected');

        writeSpy.mockRestore();
    });

    it('creates a directory, shortcut, symlink and empty file', async () => {
        const user = await makeUser();
        const parent = (await store.getEntryByPath(`${user.home}/Documents`))!;
        const target = await createFile(user, `${user.home}/Documents/t.txt`);

        const directory = await store.createNonFileEntry({
            userId: user.userId,
            parent,
            name: 'nfe-dir',
            kind: 'directory',
            isPublic: false,
            metadata: '{"a":1}',
        });
        expect(directory).toMatchObject({
            isDir: true,
            isPublic: false,
            metadata: '{"a":1}',
            size: 0,
        });

        const shortcut = await store.createNonFileEntry({
            userId: user.userId,
            parent,
            name: 'nfe-shortcut',
            kind: 'shortcut',
            shortcutTo: target.id,
        });
        expect(shortcut).toMatchObject({
            isShortcut: true,
            shortcutTo: target.id,
            isPublic: null,
        });

        const symlink = await store.createNonFileEntry({
            userId: user.userId,
            parent,
            name: 'nfe-symlink',
            kind: 'symlink',
            symlinkPath: target.path,
            immutable: true,
        });
        expect(symlink).toMatchObject({
            isSymlink: true,
            symlinkPath: target.path,
            immutable: true,
        });

        const empty = await store.createNonFileEntry({
            userId: user.userId,
            parent,
            name: 'nfe-empty',
            kind: 'empty-file',
        });
        expect(empty).toMatchObject({
            isDir: false,
            bucket: null,
            size: 0,
        });
    });

    it('places a child of the root parent without doubling the slash', async () => {
        const user = await makeUser();
        const home = (await store.getEntryByPath(user.home))!;
        const child = await store.createNonFileEntry({
            userId: user.userId,
            parent: { ...home, path: '/' },
            name: `root-child-${user.username}`,
            kind: 'directory',
        });
        expect(child.path).toBe(`/root-child-${user.username}`);
    });
});

describe('FSEntryStore timestamps and updates', () => {
    it('touches only the requested timestamps, and all three by default', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/ts.txt`);
        await server.clients.db.write(
            'UPDATE fsentries SET accessed = 0, modified = 0, created = 0 WHERE uuid = ?',
            [file.uuid],
        );
        await store.invalidateEntryCacheByUuid(file.uuid);

        const partial = await store.touchEntryTimestamps(file.uuid, {
            setAccessed: true,
        });
        expect(partial.accessed).toBeGreaterThan(0);
        expect(partial.modified).toBe(0);
        expect(partial.created).toBe(0);

        // The previous touch left a warm cache entry; the returned row must
        // still reflect the new timestamps rather than that cached copy.
        const all = await store.touchEntryTimestamps(file.uuid, {});
        expect(all.modified).toBeGreaterThan(0);
        expect(all.created).toBeGreaterThan(0);
        await expect(store.getEntryByUuid(file.uuid)).resolves.toMatchObject({
            modified: all.modified,
            created: all.created,
        });
    });

    it('reports a missing entry after a touch that matched nothing', async () => {
        const error = await caught(() =>
            store.touchEntryTimestamps(uuidv4(), { setModified: true }),
        );
        expect(error.statusCode).toBe(404);
        expect(error.message).toBe('Entry not found after touch');
    });

    it('patches every supported column', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/patch.txt`);

        const updated = await store.updateEntry(file.uuid, {
            name: 'patched.txt',
            path: `${user.home}/Documents/patched.txt`,
            thumbnail: 'thumb',
            metadata: '{"m":1}',
            isPublic: true,
            immutable: true,
            layout: 'list',
            sortBy: 'size',
            sortOrder: 'desc',
            size: 99,
            accessed: 1234,
            modified: 5678,
        });

        expect(updated).toMatchObject({
            name: 'patched.txt',
            path: `${user.home}/Documents/patched.txt`,
            thumbnail: 'thumb',
            metadata: '{"m":1}',
            isPublic: true,
            immutable: true,
            layout: 'list',
            sortBy: 'size',
            sortOrder: 'desc',
            size: 99,
            accessed: 1234,
            modified: 5678,
        });
    });

    it('clears a nullable column when the patch sets it to null', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/nul.txt`, {
            isPublic: true,
        });

        const updated = await store.updateEntry(file.uuid, {
            isPublic: null,
            metadata: null,
            thumbnail: null,
            associatedAppId: null,
            parentId: file.parentId,
            parentUid: file.parentUid,
        });
        expect(updated.isPublic).toBeNull();
        expect(updated.metadata).toBeNull();
    });

    it('reports a missing entry after an update that matched nothing', async () => {
        const error = await caught(() =>
            store.updateEntry(uuidv4(), { name: 'x' }),
        );
        expect(error.statusCode).toBe(404);
        expect(error.message).toBe('Entry not found after update');
    });

    it('updates a thumbnail only for the owning user', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        const file = await createFile(owner, `${owner.home}/Documents/th.txt`);

        const updated = await store.updateEntryThumbnailByUuidForUser(
            owner.userId,
            file.uuid,
            'data:image/png;base64,BB',
        );
        expect(updated.thumbnail).toBe('data:image/png;base64,BB');

        const foreign = await caught(() =>
            store.updateEntryThumbnailByUuidForUser(
                other.userId,
                file.uuid,
                'hijacked',
            ),
        );
        expect(foreign.statusCode).toBe(404);
        // The owner's thumbnail is untouched.
        await expect(store.getEntryByUuid(file.uuid)).resolves.toMatchObject({
            thumbnail: 'data:image/png;base64,BB',
        });
    });
});

describe('FSEntryStore listing and pagination', () => {
    let user: StoreUser;
    let parent: FSEntry;

    beforeAll(async () => {
        user = await makeUser();
        parent = await store.createNonFileEntry({
            userId: user.userId,
            parent: (await store.getEntryByPath(`${user.home}/Documents`))!,
            name: 'listing',
            kind: 'directory',
        });
        await createFile(user, `${parent.path}/a.txt`, { size: 30 });
        await createFile(user, `${parent.path}/b.txt`, { size: 20 });
        await createFile(user, `${parent.path}/c.txt`, { size: 10 });
        await store.createNonFileEntry({
            userId: user.userId,
            parent,
            name: 'sub',
            kind: 'directory',
        });
        await createFile(user, `${parent.path}/sub/deep.txt`, { size: 5 });
    });

    it('sorts children by each supported column', async () => {
        const byName = await store.listChildren(parent.uuid, {
            sortBy: 'name',
        });
        expect(byName.map((entry) => entry.name)).toEqual([
            'a.txt',
            'b.txt',
            'c.txt',
            'sub',
        ]);

        const bySize = await store.listChildren(parent.uuid, {
            sortBy: 'size',
            sortOrder: 'desc',
        });
        expect(bySize[0]?.name).toBe('a.txt');

        const byType = await store.listChildren(parent.uuid, {
            sortBy: 'type',
            sortOrder: 'desc',
        });
        expect(byType[0]?.isDir).toBe(true);

        const byModified = await store.listChildren(parent.uuid, {
            sortBy: 'modified',
        });
        expect(byModified).toHaveLength(4);
    });

    it('applies limit and offset', async () => {
        const page = await store.listChildren(parent.uuid, {
            limit: 2,
            offset: 1,
            sortBy: 'name',
        });
        expect(page.map((entry) => entry.name)).toEqual(['b.txt', 'c.txt']);

        // A zero limit clamps to one row, a negative offset clamps to zero.
        const clamped = await store.listChildren(parent.uuid, {
            limit: 0,
            offset: -5,
            sortBy: 'name',
        });
        expect(clamped.map((entry) => entry.name)).toEqual(['a.txt']);
    });

    it('walks children with a keyset cursor', async () => {
        const first = await store.listChildrenPage(parent.uuid, { limit: 2 });
        expect(first.entries.map((entry) => entry.name)).toEqual([
            'a.txt',
            'b.txt',
        ]);
        expect(first.cursor).toBeTruthy();

        const second = await store.listChildrenPage(parent.uuid, {
            limit: 2,
            cursor: first.cursor,
        });
        expect(second.entries.map((entry) => entry.name)).toEqual([
            'c.txt',
            'sub',
        ]);
        expect(second.cursor).toBeUndefined();
    });

    it('paginates each nullable sort column without dropping rows', async () => {
        for (const sortBy of ['size', 'modified', 'type'] as const) {
            const page = await store.listChildrenPage(parent.uuid, {
                limit: 2,
                sortBy,
                sortOrder: 'desc',
            });
            const rest = await store.listChildrenPage(parent.uuid, {
                limit: 2,
                sortBy,
                sortOrder: 'desc',
                cursor: page.cursor,
            });
            expect(page.entries.length + rest.entries.length, sortBy).toBe(4);
        }
    });

    it('rejects a cursor that was minted for a different sort', async () => {
        const first = await store.listChildrenPage(parent.uuid, {
            limit: 1,
            sortBy: 'name',
            sortOrder: 'asc',
        });

        const wrongField = await caught(() =>
            store.listChildrenPage(parent.uuid, {
                limit: 1,
                sortBy: 'size',
                cursor: first.cursor,
            }),
        );
        expect(wrongField.statusCode).toBe(400);
        expect(wrongField.message).toBe('cursor does not match requested sort');

        const wrongOrder = await caught(() =>
            store.listChildrenPage(parent.uuid, {
                limit: 1,
                sortOrder: 'desc',
                cursor: first.cursor,
            }),
        );
        expect(wrongOrder.statusCode).toBe(400);
    });

    it('counts direct children', async () => {
        await expect(store.countChildren(parent.uuid)).resolves.toBe(4);
        await expect(store.countChildren(uuidv4())).resolves.toBe(0);
    });

    it('lists and counts descendants, refusing to walk from root', async () => {
        const descendants = await store.listDescendantsByPath(
            user.userId,
            parent.path,
        );
        expect(descendants.map((entry) => entry.name).sort()).toEqual([
            'a.txt',
            'b.txt',
            'c.txt',
            'deep.txt',
            'sub',
        ]);
        await expect(
            store.countDescendantsByPath(user.userId, parent.path),
        ).resolves.toBe(5);

        const rootList = await caught(() =>
            store.listDescendantsByPath(user.userId, '/'),
        );
        expect(rootList.statusCode).toBe(400);
        await expect(
            store.countDescendantsByPath(user.userId, '/'),
        ).resolves.toBe(0);
    });

    it('limits a descendant page by depth and pages it by path', async () => {
        const shallow = await store.listDescendantsPage(
            user.userId,
            parent.path,
            { maxDepth: 1 },
        );
        expect(shallow.entries.map((entry) => entry.name).sort()).toEqual([
            'a.txt',
            'b.txt',
            'c.txt',
            'sub',
        ]);

        const firstPage = await store.listDescendantsPage(
            user.userId,
            parent.path,
            { maxDepth: 5, limit: 2 },
        );
        expect(firstPage.entries).toHaveLength(2);
        const nextPage = await store.listDescendantsPage(
            user.userId,
            parent.path,
            { maxDepth: 5, limit: 10, cursor: firstPage.cursor },
        );
        expect(nextPage.entries).toHaveLength(3);
        expect(nextPage.cursor).toBeUndefined();

        const rootPage = await caught(() =>
            store.listDescendantsPage(user.userId, '/', { maxDepth: 1 }),
        );
        expect(rootPage.statusCode).toBe(400);
    });

    it('counts descendants to a depth', async () => {
        await expect(
            store.countDescendantsToDepth(user.userId, parent.path, 1),
        ).resolves.toBe(4);
        await expect(
            store.countDescendantsToDepth(user.userId, parent.path, 5),
        ).resolves.toBe(5);
        await expect(
            store.countDescendantsToDepth(user.userId, '/', 1),
        ).resolves.toBe(0);
    });

    it('sums the subtree size, including from the root prefix', async () => {
        await expect(
            store.getSubtreeSize(user.userId, parent.path),
        ).resolves.toBe(65);
        await expect(
            store.getSubtreeSize(user.userId, '/'),
        ).resolves.toBeGreaterThanOrEqual(65);
    });
});

describe('FSEntryStore search', () => {
    it('returns nothing for a blank query', async () => {
        const user = await makeUser();
        await expect(
            store.searchByNameForUser(user.userId, '   '),
        ).resolves.toEqual([]);
    });

    it('treats LIKE wildcards in the query as literal characters', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/100%.txt`);
        await createFile(user, `${user.home}/Documents/decoy.txt`);

        const found = await store.searchByNameForUser(user.userId, '100%');
        expect(found.map((entry) => entry.name)).toEqual(['100%.txt']);
    });

    it('restricts results to a path scope and caps the limit', async () => {
        const user = await makeUser();
        await store.ensureDirectoriesForUser(user.userId, [
            { path: `${user.home}/Documents/scope`, createPaths: true },
        ]);
        await createFile(user, `${user.home}/Documents/scope/inside.txt`);
        await createFile(user, `${user.home}/Desktop/inside.txt`);

        const scoped = await store.searchByNameForUser(
            user.userId,
            'inside',
            5000,
            `${user.home}/Documents/scope`,
        );
        expect(scoped.map((entry) => entry.path)).toEqual([
            `${user.home}/Documents/scope/inside.txt`,
        ]);

        const unscoped = await store.searchByNameForUser(user.userId, 'inside');
        expect(unscoped).toHaveLength(2);
    });

    it('does not return another user’s files', async () => {
        const owner = await makeUser();
        const other = await makeUser();
        await createFile(owner, `${owner.home}/Documents/secret-doc.txt`);

        await expect(
            store.searchByNameForUser(other.userId, 'secret-doc'),
        ).resolves.toEqual([]);
    });
});

describe('FSEntryStore home and prefix rewrites', () => {
    it('finds the home row by parentage, not by path', async () => {
        const user = await makeUser();
        const root = await store.getRootEntryForUser(user.userId);
        expect(root?.path).toBe(user.home);
        await expect(store.getRootEntryForUser(9_999_999)).resolves.toBeNull();
    });

    it('renames the home row and cascades to descendants', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/moved.txt`);
        const newName = `${user.username}-renamed`;

        const renamed = await store.renameUserHome(user.userId, newName);

        expect(renamed?.path).toBe(`/${newName}`);
        expect(renamed?.name).toBe(newName);
        const descendant = await store.getEntryByPath(
            `/${newName}/Documents/moved.txt`,
        );
        expect(descendant).not.toBeNull();
    });

    it('is a no-op when the home row already matches, and null for an unknown user', async () => {
        const user = await makeUser();
        const first = await store.renameUserHome(user.userId, user.username);
        expect(first?.path).toBe(user.home);
        await expect(
            store.renameUserHome(9_999_999, 'nobody'),
        ).resolves.toBeNull();
    });

    it('rewrites a path prefix and reports how many rows moved', async () => {
        const user = await makeUser();
        await store.ensureDirectoriesForUser(user.userId, [
            { path: `${user.home}/Documents/old/inner`, createPaths: true },
        ]);
        await createFile(user, `${user.home}/Documents/old/inner/f.txt`);

        const affected = await store.updatePathPrefixForUser(
            user.userId,
            `${user.home}/Documents/old`,
            `${user.home}/Documents/new`,
        );

        expect(affected).toBe(2);
        expect(
            await store.getEntryByPath(
                `${user.home}/Documents/new/inner/f.txt`,
            ),
        ).not.toBeNull();
    });

    it('refuses a prefix rewrite involving root and no-ops on an unchanged prefix', async () => {
        const user = await makeUser();

        const fromRoot = await caught(() =>
            store.updatePathPrefixForUser(user.userId, '/', user.home),
        );
        expect(fromRoot.statusCode).toBe(400);

        const toRoot = await caught(() =>
            store.updatePathPrefixForUser(user.userId, user.home, '/'),
        );
        expect(toRoot.statusCode).toBe(400);

        await expect(
            store.updatePathPrefixForUser(user.userId, user.home, user.home),
        ).resolves.toBe(0);
    });
});

describe('FSEntryStore deletion', () => {
    it('deletes one entry and clears its cache keys', async () => {
        const user = await makeUser();
        const file = await createFile(user, `${user.home}/Documents/del.txt`);
        await store.getEntryByUuid(file.uuid);

        await store.deleteEntry(file);

        await expect(store.getEntryByUuid(file.uuid)).resolves.toBeNull();
        await expect(
            server.clients.redis.get(`prodfsv2:fsentry:uuid:${file.uuid}`),
        ).resolves.toBeNull();
    });

    it('deletes a batch and no-ops on an empty one', async () => {
        const user = await makeUser();
        const entries = [
            await createFile(user, `${user.home}/Documents/d1.txt`),
            await createFile(user, `${user.home}/Documents/d2.txt`),
        ];

        await store.deleteEntries([]);
        await store.deleteEntries(entries);

        for (const entry of entries) {
            await expect(store.getEntryByUuid(entry.uuid)).resolves.toBeNull();
        }
    });
});

describe('FSEntryStore pending upload sessions', () => {
    const makeSession = (
        user: StoreUser,
        over: Record<string, unknown> = {},
    ) => ({
        sessionId: uuidv4(),
        userId: user.userId,
        appId: null,
        parentUid: 'parent-uid',
        parentPath: `${user.home}/Documents`,
        targetName: 'p.txt',
        targetPath: `${user.home}/Documents/p.txt`,
        overwriteTargetUid: null,
        contentType: 'text/plain',
        size: 4,
        checksumSha256: null,
        uploadMode: 'single' as const,
        multipartUploadId: null,
        multipartPartSize: null,
        multipartPartCount: null,
        storageProvider: 's3',
        bucket: 'puter-local',
        bucketRegion: 'us-west-2',
        objectKey: uuidv4(),
        metadataJson: '{}',
        expiresAt: Date.now() + 60_000,
        ...over,
    });

    it('creates a session and reads it back by id', async () => {
        const user = await makeUser();
        const input = makeSession(user);

        const created = await store.createPendingEntry(input);
        expect(created).toMatchObject({
            sessionId: input.sessionId,
            status: 'pending',
            objectKey: input.objectKey,
        });

        await expect(
            store.getPendingEntryBySessionId(input.sessionId),
        ).resolves.toMatchObject({ sessionId: input.sessionId });
        await expect(
            store.getPendingEntryBySessionId(uuidv4()),
        ).resolves.toBeNull();
    });

    it('returns an ordered array for a batch read, with holes for misses', async () => {
        const user = await makeUser();
        const first = makeSession(user);
        const second = makeSession(user, {
            targetPath: `${user.home}/Documents/p2.txt`,
        });
        await store.batchCreatePendingEntries([first, second]);
        await expect(store.batchCreatePendingEntries([])).resolves.toEqual([]);

        const read = await store.getPendingEntriesBySessionIds([
            second.sessionId,
            'missing',
            first.sessionId,
        ]);
        expect(read.map((session) => session?.sessionId ?? null)).toEqual([
            second.sessionId,
            null,
            first.sessionId,
        ]);
        await expect(store.getPendingEntriesBySessionIds([])).resolves.toEqual(
            [],
        );
    });

    it('records completed, failed and aborted transitions', async () => {
        const user = await makeUser();
        const completed = makeSession(user);
        const failed = makeSession(user);
        const aborted = makeSession(user);
        await store.batchCreatePendingEntries([completed, failed, aborted]);

        await store.markPendingEntryCompleted(completed.sessionId);
        await store.markPendingEntryFailed(failed.sessionId, 'upload broke');
        await store.abortPendingEntry(aborted.sessionId, 'caller aborted');

        await expect(
            store.getPendingEntryBySessionId(completed.sessionId),
        ).resolves.toMatchObject({ status: 'completed', failureReason: null });
        await expect(
            store.getPendingEntryBySessionId(failed.sessionId),
        ).resolves.toMatchObject({
            status: 'failed',
            failureReason: 'upload broke',
        });
        await expect(
            store.getPendingEntryBySessionId(aborted.sessionId),
        ).resolves.toMatchObject({
            status: 'aborted',
            failureReason: 'caller aborted',
        });
    });

    it('ignores status transitions for unknown or empty session lists', async () => {
        await expect(
            store.markPendingEntriesFailed([], 'x'),
        ).resolves.toBeUndefined();
        await expect(
            store.markPendingEntryFailed(uuidv4(), 'x'),
        ).resolves.toBeUndefined();
    });

    it('creates the real entry when a session completes', async () => {
        const user = await makeUser();
        const session = makeSession(user);
        await store.createPendingEntry(session);

        const entry = await store.completePendingEntry(session.sessionId, {
            userId: user.userId,
            uuid: session.objectKey,
            path: session.targetPath,
            size: 4,
            bucket: 'puter-local',
            bucketRegion: 'us-west-2',
        });

        expect(entry).toMatchObject({
            uuid: session.objectKey,
            path: session.targetPath,
            size: 4,
        });
        await expect(
            store.getPendingEntryBySessionId(session.sessionId),
        ).resolves.toMatchObject({ status: 'completed' });
    });

    it('completes a batch of sessions in one pass', async () => {
        const user = await makeUser();
        const first = makeSession(user, {
            targetPath: `${user.home}/Documents/bp1.txt`,
        });
        const second = makeSession(user, {
            targetPath: `${user.home}/Documents/bp2.txt`,
        });
        await store.batchCreatePendingEntries([first, second]);

        await expect(store.batchCompletePendingEntries([])).resolves.toEqual(
            [],
        );
        const entries = await store.batchCompletePendingEntries([
            {
                sessionId: first.sessionId,
                finalData: {
                    userId: user.userId,
                    uuid: first.objectKey,
                    path: first.targetPath,
                    size: 1,
                    bucket: 'puter-local',
                    bucketRegion: 'us-west-2',
                },
            },
            {
                sessionId: second.sessionId,
                finalData: {
                    userId: user.userId,
                    uuid: second.objectKey,
                    path: second.targetPath,
                    size: 2,
                    bucket: 'puter-local',
                    bucketRegion: 'us-west-2',
                },
            },
        ]);

        expect(entries.map((entry) => entry.path)).toEqual([
            first.targetPath,
            second.targetPath,
        ]);
        for (const session of [first, second]) {
            await expect(
                store.getPendingEntryBySessionId(session.sessionId),
            ).resolves.toMatchObject({ status: 'completed' });
        }
    });
});

describe('FSEntryStore storage allowance', () => {
    it('adds a bonus contributed by a storage.quota.bonus listener', async () => {
        const user = await makeUser();
        await createFile(user, `${user.home}/Documents/q.txt`, { size: 7 });

        const bonus = (
            _key: string,
            event: { userId: number; extra: number },
        ) => {
            if (event.userId === user.userId) event.extra = 500;
        };
        server.clients.event.on('storage.quota.bonus', bonus);

        const allowance = await store.getUserStorageAllowance(user.userId);
        expect(allowance.curr).toBe(7);
        expect(allowance.max).toBeGreaterThan(500);

        server.clients.event.off?.('storage.quota.bonus', bonus);
    });
});

describe('FSEntryStore lost-insert recovery', () => {
    /**
     * Drop the batch INSERT carrying `uuid` and optionally let a competing
     * writer land its own row first: exactly the state INSERT IGNORE leaves
     * behind when two writers race for the same `(parent_id, name)`.
     */
    const loseInsertRace = (
        uuid: string,
        winnerWrites?: () => Promise<void>,
    ) => {
        const db = server.clients.db;
        const originalWrite = (Object.getPrototypeOf(db) as typeof db).write;
        return vi
            .spyOn(db, 'write')
            .mockImplementation(async (sql: string, params?: unknown[]) => {
                const carriesOurRow = (params ?? []).includes(uuid);
                if (/INTO\s+`?fsentries`?/i.test(sql) && carriesOurRow) {
                    await winnerWrites?.();
                    return { affectedRows: 0 };
                }
                return originalWrite.call(db, sql, params);
            });
    };

    const insertCompetitor = async (
        user: StoreUser,
        parentPath: string,
        name: string,
        isDir: boolean,
    ): Promise<void> => {
        const parent = (await store.getEntryByPath(parentPath))!;
        await server.clients.db.write(
            `INSERT INTO fsentries
             (uuid, user_id, parent_id, parent_uid, name, path, is_dir, created, modified, accessed, size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                uuidv4(),
                user.userId,
                parent.id,
                parent.uuid,
                name,
                `${parentPath}/${name}`,
                server.clients.db.booleanValue(isDir),
                0,
                0,
                0,
                isDir ? 0 : 5,
            ],
        );
    };

    it('reports a conflict when the row vanished and nothing took its place', async () => {
        const user = await makeUser();
        const uuid = uuidv4();
        const spy = loseInsertRace(uuid);

        const error = await caught(() =>
            store.batchCreateEntries([
                {
                    userId: user.userId,
                    uuid,
                    path: `${user.home}/Documents/lost.txt`,
                    size: 1,
                    bucket: 'puter-local',
                    bucketRegion: 'us-west-2',
                },
            ]),
        );

        expect(error.statusCode).toBe(409);
        expect(error.message).toContain('Entry already exists at');
        spy.mockRestore();
    });

    it('reports a conflict when the race winner is a directory', async () => {
        const user = await makeUser();
        const uuid = uuidv4();
        const spy = loseInsertRace(uuid, () =>
            insertCompetitor(user, `${user.home}/Documents`, 'wonbydir', true),
        );

        const error = await caught(() =>
            store.batchCreateEntries([
                {
                    userId: user.userId,
                    uuid,
                    path: `${user.home}/Documents/wonbydir`,
                    size: 1,
                    overwrite: true,
                    bucket: 'puter-local',
                    bucketRegion: 'us-west-2',
                },
            ]),
        );

        expect(error.legacyCode).toBe('cannot_overwrite_a_directory');
        spy.mockRestore();
    });

    it('reports a conflict when the race winner is a file and overwrite was not asked for', async () => {
        const user = await makeUser();
        const uuid = uuidv4();
        const spy = loseInsertRace(uuid, () =>
            insertCompetitor(
                user,
                `${user.home}/Documents`,
                'wonbyfile.txt',
                false,
            ),
        );

        const error = await caught(() =>
            store.batchCreateEntries([
                {
                    userId: user.userId,
                    uuid,
                    path: `${user.home}/Documents/wonbyfile.txt`,
                    size: 1,
                    bucket: 'puter-local',
                    bucketRegion: 'us-west-2',
                },
            ]),
        );

        expect(error.statusCode).toBe(409);
        expect(error.legacyCode).toBe('conflict');
        spy.mockRestore();
    });

    it('updates the race winner in place when overwrite was requested', async () => {
        const user = await makeUser();
        const uuid = uuidv4();
        const spy = loseInsertRace(uuid, () =>
            insertCompetitor(
                user,
                `${user.home}/Documents`,
                'recovered.txt',
                false,
            ),
        );

        const [entry] = await store.batchCreateEntries([
            {
                userId: user.userId,
                uuid,
                path: `${user.home}/Documents/recovered.txt`,
                size: 77,
                overwrite: true,
                thumbnail: 'thumb',
                bucket: 'puter-local',
                bucketRegion: 'us-west-2',
            },
        ]);
        spy.mockRestore();

        // The winner's row survived; our payload was written onto it.
        expect(entry?.uuid).not.toBe(uuid);
        expect(entry?.size).toBe(77);
        expect(entry?.thumbnail).toBe('thumb');
        await expect(
            store.getEntryByPath(`${user.home}/Documents/recovered.txt`),
        ).resolves.toMatchObject({ size: 77, uuid: entry?.uuid });
    });
});
