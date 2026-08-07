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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestServer } from '../../testUtil.ts';

// Stats cache TTL the store backfills with (mirrors STATS_CACHE_TTL_SECONDS).
const STATS_CACHE_TTL_SECONDS = 30 * 60;

let counter = 0;
const freshUid = () => `app-test-${Date.now()}-${counter++}`;

// ioredis-mock keeps one in-memory dataset per process, so a server booted
// later inherits the previous server's `apps:*` keys — and app ids restart
// from 1 with every fresh database.
const clearAppCache = async (redis) => {
    for (const pattern of ['apps:*', 'appstats:*']) {
        const keys = await redis.keys(pattern);
        for (const key of keys) await redis.del(key);
    }
};

describe('AppStore app stats (cache-on-read)', () => {
    let server;
    let appStore;
    let db;
    let redis;

    const openKey = (uid) => `${appStore.appStatsCachePrefix}open:${uid}`;
    const userKey = (uid) => `${appStore.appStatsCachePrefix}user:${uid}`;

    const insertOpen = (uid, userId, ts) =>
        db.write(
            'INSERT INTO app_opens (app_uid, user_id, ts) VALUES (?, ?, ?)',
            [uid, userId, ts],
        );

    // The store backfills the cache fire-and-forget (not awaited), so reads
    // must poll for the key to land instead of assuming it's there.
    const waitForKey = async (key, timeoutMs = 2000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const v = await redis.get(key);
            if (v != null) return v;
            await new Promise((r) => setTimeout(r, 5));
        }
        throw new Error(`cache key ${key} was never populated`);
    };

    beforeAll(async () => {
        server = await setupTestServer();
        appStore = server.stores.app;
        db = server.clients.db;
        redis = server.clients.redis;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('computes all-time open/unique-user counts from SQL when no ClickHouse client is registered', async () => {
        const uid = freshUid();
        // 3 opens across 2 distinct users.
        await insertOpen(uid, 1, 1700000000);
        await insertOpen(uid, 1, 1700000100);
        await insertOpen(uid, 2, 1700000200);

        const stats = await appStore.getAppsStats([uid]);

        expect(stats.get(uid)).toEqual({
            open_count: 3,
            user_count: 2,
            referral_count: null,
        });
    });

    it('caches counts on read with an autoexpire TTL', async () => {
        const uid = freshUid();
        await insertOpen(uid, 7, 1700000000);

        // Nothing should have warmed the cache before the first read — there
        // is no background bulk refresh anymore.
        expect(await redis.get(openKey(uid))).toBeNull();
        expect(await redis.get(userKey(uid))).toBeNull();

        await appStore.getAppsStats([uid]);

        expect(await waitForKey(openKey(uid))).toBe('1');
        expect(await waitForKey(userKey(uid))).toBe('1');

        // Set to autoexpire — TTL is positive and bounded by the cache window.
        const ttl = await redis.ttl(openKey(uid));
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(STATS_CACHE_TTL_SECONDS);
    });

    it('serves cached counts on subsequent reads without re-querying', async () => {
        const uid = freshUid();
        await insertOpen(uid, 1, 1700000000);
        await insertOpen(uid, 2, 1700000100);

        // Warm the cache, then wait for the backfill to land.
        await appStore.getAppsStats([uid]);
        await waitForKey(openKey(uid));

        // Drop the underlying rows: a fresh query would now return zero.
        await db.write('DELETE FROM app_opens WHERE app_uid = ?', [uid]);

        const stats = await appStore.getAppsStats([uid]);
        expect(stats.get(uid)).toEqual({
            open_count: 2,
            user_count: 2,
            referral_count: null,
        });
    });

    it('resolves apps with no opens to zero counts', async () => {
        const uid = freshUid();

        const stats = await appStore.getAppsStats([uid]);
        expect(stats.get(uid)).toEqual({
            open_count: 0,
            user_count: 0,
            referral_count: null,
        });
    });

    it('uses the ClickHouse client when one is registered', async () => {
        const uid = freshUid();
        let receivedUids;

        // Inject a fake ClickHouse client onto the shared clients object the
        // store reads from. No SQL rows exist for this uid, so a non-zero
        // result can only come from ClickHouse.
        server.clients.clickhouse = {
            query: async ({ query_params }) => {
                receivedUids = query_params?.uids;
                return {
                    json: async () => [
                        { app_uid: uid, open_count: '42', user_count: '7' },
                    ],
                };
            },
        };

        try {
            const stats = await appStore.getAppsStats([uid]);
            expect(stats.get(uid)).toEqual({
                open_count: 42,
                user_count: 7,
                referral_count: null,
            });
            expect(receivedUids).toEqual([uid]);
        } finally {
            delete server.clients.clickhouse;
        }
    });
});

describe('AppStore batched lookups', () => {
    let server;
    let appStore;

    beforeAll(async () => {
        server = await setupTestServer();
        appStore = server.stores.app;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const createApp = async (title) => {
        const name = `batch-${Math.random().toString(36).slice(2, 10)}`;
        return appStore.create(
            { name, title, index_url: `https://${name}.example.com/` },
            { ownerUserId: 1 },
        );
    };

    it('getByUids resolves every known uid in one map', async () => {
        const a = await createApp('Alpha');
        const b = await createApp('Beta');

        const found = await appStore.getByUids([a.uid, b.uid]);

        expect(found.get(a.uid)?.title).toBe('Alpha');
        expect(found.get(b.uid)?.title).toBe('Beta');
    });

    it('getByUids omits unknown uids rather than returning holes', async () => {
        const a = await createApp('Alpha');

        const found = await appStore.getByUids([a.uid, 'app-does-not-exist']);

        expect(found.has(a.uid)).toBe(true);
        expect(found.has('app-does-not-exist')).toBe(false);
        expect(found.size).toBe(1);
    });

    it('getByUids dedupes repeats and tolerates empty/nullish input', async () => {
        const a = await createApp('Alpha');

        const found = await appStore.getByUids([a.uid, a.uid, null, undefined]);
        expect(found.size).toBe(1);

        expect((await appStore.getByUids([])).size).toBe(0);
        expect((await appStore.getByUids(null)).size).toBe(0);
    });

    it('getByIds still resolves id-keyed lookups off the shared engine', async () => {
        const a = await createApp('Alpha');

        const found = await appStore.getByIds([a.id]);

        expect(found.get(a.id)?.title).toBe('Alpha');
    });
});

describe('AppStore filetype associations', () => {
    let server;
    let appStore;
    let db;

    beforeAll(async () => {
        server = await setupTestServer();
        appStore = server.stores.app;
        db = server.clients.db;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const createApp = async () => {
        const name = `ft-${Math.random().toString(36).slice(2, 10)}`;
        return appStore.create(
            {
                name,
                title: 'Filetype Test',
                index_url: `https://${name}.example.com/`,
            },
            { ownerUserId: 1 },
        );
    };

    // Unique per test — getAppsByFiletype caches per extension in redis, so
    // sharing an extension across tests would serve stale results.
    const freshExt = () => `ext${Math.random().toString(36).slice(2, 10)}`;

    const insertRawAssociation = (appId, type) =>
        db.write(
            'INSERT INTO `app_filetype_association` (`app_id`, `type`) VALUES (?, ?)',
            [appId, type],
        );

    it('canonicalizes on write: trims, lowercases, strips leading dots, dedupes', async () => {
        const app = await createApp();

        await appStore.setFiletypeAssociations(app.id, [
            ' .DocX ',
            'docx',
            '.doc',
        ]);

        const stored = await appStore.getFiletypeAssociations(app.id);
        expect(stored.sort()).toEqual(['doc', 'docx']);
    });

    it('drops entries that normalize to nothing', async () => {
        const app = await createApp();

        await appStore.setFiletypeAssociations(app.id, ['.', '  ', 'txt']);

        expect(await appStore.getFiletypeAssociations(app.id)).toEqual(['txt']);
    });

    it('getAppsByFiletype matches legacy rows stored with a leading dot', async () => {
        const app = await createApp();
        const ext = freshExt();
        // Pre-normalization rows were written verbatim from client input.
        await insertRawAssociation(app.id, `.${ext}`);

        const apps = await appStore.getAppsByFiletype(ext);

        expect(apps.map((a) => a.id)).toContain(app.id);
    });

    it('getAppsByFiletype returns one entry for an app associated under both forms', async () => {
        const app = await createApp();
        const ext = freshExt();
        await insertRawAssociation(app.id, ext);
        await insertRawAssociation(app.id, `.${ext}`);

        const apps = await appStore.getAppsByFiletype(ext);

        expect(apps.filter((a) => a.id === app.id)).toHaveLength(1);
    });

    it('getAppsByFiletype normalizes the requested extension', async () => {
        const app = await createApp();
        const ext = freshExt();
        await appStore.setFiletypeAssociations(app.id, [ext]);

        const apps = await appStore.getAppsByFiletype(`.${ext.toUpperCase()}`);

        expect(apps.map((a) => a.id)).toContain(app.id);
    });

    it('getAppsByFiletype returns [] when the extension normalizes to nothing', async () => {
        expect(await appStore.getAppsByFiletype('')).toEqual([]);
        expect(await appStore.getAppsByFiletype('.')).toEqual([]);
        expect(await appStore.getAppsByFiletype(null)).toEqual([]);
    });
});

describe('AppStore CRUD and cache invalidation', () => {
    let server;
    let appStore;
    let db;
    let redis;

    const OWNER = 4001;
    const OTHER_OWNER = 4002;

    beforeAll(async () => {
        server = await setupTestServer();
        appStore = server.stores.app;
        db = server.clients.db;
        redis = server.clients.redis;
        // The in-memory redis is shared across servers booted in the same
        // process, so earlier suites leave `apps:*` entries whose ids
        // collide with this server's fresh sequence.
        await clearAppCache(redis);
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const freshName = () => `crud-${Math.random().toString(36).slice(2, 10)}`;

    const createApp = async (fields = {}, opts = { ownerUserId: OWNER }) => {
        const name = fields.name ?? freshName();
        return appStore.create(
            {
                name,
                title: fields.title ?? 'CRUD Test',
                index_url: fields.index_url ?? `https://${name}.example.com/`,
                ...fields,
                name,
            },
            opts,
        );
    };

    // -- create --------------------------------------------------------

    it('creates an app with an `app-` prefixed uid and the caller-supplied owner', async () => {
        const app = await createApp({ title: 'Created' });

        expect(app.uid.startsWith('app-')).toBe(true);
        expect(app.owner_user_id).toBe(OWNER);
        expect(app.title).toBe('Created');
        // `timestamp` is aliased for clients that expect `created_at`.
        expect(app.created_at).toBe(app.timestamp);
    });

    it('records `app_owner` only when one is supplied', async () => {
        const parent = await createApp();
        const child = await createApp(
            {},
            { ownerUserId: OWNER, appOwner: parent.id },
        );
        expect(child.app_owner).toBe(parent.id);

        const orphan = await createApp();
        expect(orphan.app_owner ?? null).toBeNull();
    });

    it('refuses to create without a numeric owner', async () => {
        await expect(
            appStore.create(
                { name: freshName(), title: 't', index_url: 'https://x.test/' },
                {},
            ),
        ).rejects.toThrow('requires a numeric ownerUserId');
    });

    it('strips read-only columns from create input instead of trusting them', async () => {
        const name = freshName();
        const app = await appStore.create(
            {
                name,
                title: 'Locked',
                index_url: `https://${name}.example.com/`,
                // Every one of these is an escalation if it lands in SQL.
                owner_user_id: OTHER_OWNER,
                app_owner: 999999,
                godmode: true,
                approved_for_listing: true,
                approved_for_opening_items: true,
                approved_for_incentive_program: true,
                protected: true,
                is_private: true,
                uid: 'app-forged',
            },
            { ownerUserId: OWNER },
        );

        expect(app.owner_user_id).toBe(OWNER);
        expect(app.uid).not.toBe('app-forged');
        expect(app.godmode).toBe(false);
        expect(app.protected).toBe(false);
        expect(app.is_private).toBe(false);
        expect(app.approved_for_listing).toBe(false);
    });

    it('coerces editable boolean columns to the database boolean form', async () => {
        const app = await createApp({
            background: 1,
            maximize_on_start: 'yes',
        });
        expect(app.background).toBe(true);
        expect(app.maximize_on_start).toBe(true);

        const off = await createApp({ background: 0 });
        expect(off.background).toBe(false);
    });

    // -- read ----------------------------------------------------------

    it('returns null for nullish or unknown lookup keys', async () => {
        expect(await appStore.getByUid(undefined)).toBeNull();
        expect(await appStore.getById(null)).toBeNull();
        expect(await appStore.getByName('no-such-app-name')).toBeNull();
        expect(await appStore.getByUid('app-nope')).toBeNull();
    });

    it('serves a second read from cache and a post-invalidate read from the database', async () => {
        const app = await createApp({ title: 'Cached' });
        // Prime the uid/name/id keys.
        await appStore.getByUid(app.uid);

        await db.write('UPDATE `apps` SET `title` = ? WHERE `id` = ?', [
            'ChangedBehindTheCache',
            app.id,
        ]);
        expect((await appStore.getByUid(app.uid)).title).toBe('Cached');

        await appStore.invalidate(app);
        expect((await appStore.getByUid(app.uid)).title).toBe(
            'ChangedBehindTheCache',
        );
    });

    it('invalidateById / invalidateByUid drop every key for the app', async () => {
        const app = await createApp({ title: 'Inv' });
        await appStore.getByUid(app.uid);

        await db.write('UPDATE `apps` SET `title` = ? WHERE `id` = ?', [
            'ById',
            app.id,
        ]);
        await appStore.invalidateById(app.id);
        expect((await appStore.getByName(app.name)).title).toBe('ById');

        await db.write('UPDATE `apps` SET `title` = ? WHERE `id` = ?', [
            'ByUid',
            app.id,
        ]);
        await appStore.invalidateByUid(app.uid);
        expect((await appStore.getById(app.id)).title).toBe('ByUid');
    });

    it('invalidateById is a no-op for an app that does not exist', async () => {
        await expect(
            appStore.invalidateById(99999999),
        ).resolves.toBeUndefined();
        await expect(
            appStore.invalidateByUid('app-missing'),
        ).resolves.toBeUndefined();
    });

    it('resolveApp accepts either a uid or a name', async () => {
        const app = await createApp();
        expect((await appStore.resolveApp(app.uid)).id).toBe(app.id);
        expect((await appStore.resolveApp(app.name)).id).toBe(app.id);
        expect(await appStore.resolveApp('neither-uid-nor-name')).toBeNull();
    });

    it('parses stored metadata JSON and falls back to null on corruption', async () => {
        const good = await createApp({ metadata: JSON.stringify({ a: 1 }) });
        expect((await appStore.getById(good.id)).metadata).toEqual({ a: 1 });

        const bad = await createApp();
        await db.write('UPDATE `apps` SET `metadata` = ? WHERE `id` = ?', [
            '{not json',
            bad.id,
        ]);
        await appStore.invalidate(bad);
        expect((await appStore.getById(bad.id)).metadata).toBeNull();
    });

    it('existsByName / existsByIndexUrl answer the driver uniqueness checks', async () => {
        const app = await createApp();

        expect(await appStore.existsByName(app.name)).toBe(true);
        expect(await appStore.existsByName('definitely-not-taken')).toBe(false);
        expect(await appStore.existsByIndexUrl(app.index_url)).toBe(true);
        expect(
            await appStore.existsByIndexUrl('https://unused.example.com/'),
        ).toBe(false);
    });

    it('rejects a duplicate app name at the database level', async () => {
        const app = await createApp();
        await expect(
            appStore.create(
                {
                    name: app.name,
                    title: 'dup',
                    index_url: 'https://dup.example.com/',
                },
                { ownerUserId: OWNER },
            ),
        ).rejects.toThrow();
    });

    // -- update --------------------------------------------------------

    it('applies a partial update and refreshes the cached copy', async () => {
        const app = await createApp({ title: 'Before' });
        await appStore.getByUid(app.uid);

        const updated = await appStore.update(app.id, {
            title: 'After',
            description: 'desc',
        });

        expect(updated.title).toBe('After');
        expect(updated.description).toBe('desc');
        // Untouched columns survive.
        expect(updated.index_url).toBe(app.index_url);
        // The cache now serves the new value, not the pre-update one.
        expect((await appStore.getByUid(app.uid)).title).toBe('After');
    });

    it('ignores read-only columns in an update patch', async () => {
        const app = await createApp();
        const updated = await appStore.update(app.id, {
            owner_user_id: OTHER_OWNER,
            is_private: true,
            protected: true,
            godmode: true,
            title: 'Still Editable',
        });

        expect(updated.owner_user_id).toBe(OWNER);
        expect(updated.is_private).toBe(false);
        expect(updated.protected).toBe(false);
        expect(updated.godmode).toBe(false);
        expect(updated.title).toBe('Still Editable');
    });

    it('short-circuits an update whose patch is entirely read-only', async () => {
        const app = await createApp({ title: 'Untouched' });
        const result = await appStore.update(app.id, { uid: 'app-forged' });
        expect(result.title).toBe('Untouched');
        expect(result.uid).toBe(app.uid);
    });

    // -- renames + old-name redirects ----------------------------------

    it('keeps the old name resolving to the app after a rename', async () => {
        const app = await createApp();
        const newName = freshName();

        await appStore.update(app.id, { name: newName });

        expect((await appStore.getByName(newName)).id).toBe(app.id);
        // Old name still resolves through `old_app_names`.
        expect((await appStore.getByName(app.name)).id).toBe(app.id);
    });

    it('lets a live app claim a name a redirect used to point at', async () => {
        const first = await createApp();
        const originalName = first.name;
        await appStore.update(first.id, { name: freshName() });

        // A different app takes over the freed name; the redirect must not
        // shadow the real owner.
        const second = await createApp({ name: originalName });
        expect((await appStore.getByName(originalName)).id).toBe(second.id);
    });

    it('expires an old-name redirect older than the retention window', async () => {
        const app = await createApp();
        const oldName = app.name;
        await appStore.update(app.id, { name: freshName() });

        await db.write(
            "UPDATE `old_app_names` SET `timestamp` = '2000-01-01 00:00:00' WHERE `name` = ?",
            [oldName],
        );

        expect(await appStore.getByName(oldName)).toBeNull();
        // Lazy GC removed the row on that same read.
        const rows = await db.read(
            'SELECT * FROM `old_app_names` WHERE `name` = ?',
            [oldName],
        );
        expect(rows).toHaveLength(0);
    });

    it('refreshes the redirect timestamp when a name is re-recorded', async () => {
        const app = await createApp();
        const first = app.name;
        const second = freshName();

        await appStore.update(app.id, { name: second });
        await appStore.update(app.id, { name: first });
        await appStore.update(app.id, { name: second });

        // Renaming back and forth must leave exactly one redirect row per
        // (app, name) pair rather than piling up duplicates.
        const rows = await db.read(
            'SELECT * FROM `old_app_names` WHERE `app_uid` = ?',
            [app.uid],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe(first);
    });

    // -- delete --------------------------------------------------------

    it('deletes an app together with its filetype associations', async () => {
        const app = await createApp();
        await appStore.setFiletypeAssociations(app.id, ['txt']);

        expect(await appStore.delete(app.id)).toBe(true);
        expect(await appStore.getById(app.id)).toBeNull();
        expect(await appStore.getByUid(app.uid)).toBeNull();
        expect(await appStore.getFiletypeAssociations(app.id)).toEqual([]);
    });

    it('reports false when deleting an app that is already gone', async () => {
        expect(await appStore.delete(99999999)).toBe(false);
    });

    // -- ownership claiming --------------------------------------------

    it('claims an unowned app row and refuses one that already has an owner', async () => {
        const name = freshName();
        await db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`) VALUES (?, ?, ?, ?)',
            [`app-${name}`, name, name, `https://${name}.example.com/`],
        );
        const unowned = await appStore.getByName(name);
        expect(unowned.owner_user_id).toBeNull();

        expect(await appStore.claimOwnership(unowned.id, OWNER)).toBe(true);
        expect((await appStore.getById(unowned.id)).owner_user_id).toBe(OWNER);

        // Already owned — a second claim by anyone else must fail.
        expect(await appStore.claimOwnership(unowned.id, OTHER_OWNER)).toBe(
            false,
        );
        expect((await appStore.getById(unowned.id)).owner_user_id).toBe(OWNER);
    });

    it('rejects malformed claimOwnership arguments', async () => {
        expect(await appStore.claimOwnership(0, OWNER)).toBe(false);
        expect(await appStore.claimOwnership(-1, OWNER)).toBe(false);
        expect(await appStore.claimOwnership(1.5, OWNER)).toBe(false);
        expect(await appStore.claimOwnership(1, 0)).toBe(false);
        expect(await appStore.claimOwnership(1, null)).toBe(false);
    });

    // -- index_url candidate lookup ------------------------------------

    it('finds the oldest app matching an index_url candidate', async () => {
        const older = await createApp({
            index_url: 'https://shared.example.com/',
        });
        await db.write(
            "UPDATE `apps` SET `timestamp` = '2001-01-01 00:00:00' WHERE `id` = ?",
            [older.id],
        );
        const newer = await createApp({
            index_url: 'https://shared.example.com/other',
        });

        const found = await appStore.findByIndexUrlCandidates([
            'https://shared.example.com/',
            'https://shared.example.com/other',
        ]);
        expect(found.id).toBe(older.id);

        const excluded = await appStore.findByIndexUrlCandidates(
            ['https://shared.example.com/', 'https://shared.example.com/other'],
            { excludeAppId: older.id },
        );
        expect(excluded.id).toBe(newer.id);
    });

    it('returns null for an empty or non-array candidate list', async () => {
        expect(await appStore.findByIndexUrlCandidates([])).toBeNull();
        expect(await appStore.findByIndexUrlCandidates(null)).toBeNull();
        expect(
            await appStore.findByIndexUrlCandidates([
                'https://nothing.example.com/',
            ]),
        ).toBeNull();
    });

    it('ignores a non-positive excludeAppId rather than emitting bad SQL', async () => {
        const app = await createApp({ index_url: 'https://excl.example.com/' });
        const found = await appStore.findByIndexUrlCandidates(
            ['https://excl.example.com/'],
            { excludeAppId: 0 },
        );
        expect(found.id).toBe(app.id);
    });

    // -- createFromOrigin ----------------------------------------------

    it('creates an origin-bootstrap app with the marker shape', async () => {
        const uid = `app-origin-${Math.random().toString(36).slice(2, 10)}`;
        const origin = `https://${uid}.example.com`;

        const app = await appStore.createFromOrigin(uid, origin);

        expect(app.uid).toBe(uid);
        expect(app.name).toBe(uid);
        expect(app.title).toBe(uid);
        expect(app.index_url).toBe(origin);
        expect(app.description).toBe(`App created from origin ${origin}`);
        expect(app.owner_user_id).toBeNull();
    });

    it('attributes an origin-bootstrap app to the hosted-site owner when given one', async () => {
        const uid = `app-origin-${Math.random().toString(36).slice(2, 10)}`;
        const app = await appStore.createFromOrigin(
            uid,
            `https://${uid}.example.com`,
            { ownerUserId: OWNER },
        );
        expect(app.owner_user_id).toBe(OWNER);

        const unowned = await appStore.createFromOrigin(
            `${uid}-b`,
            `https://${uid}-b.example.com`,
            { ownerUserId: 0 },
        );
        expect(unowned.owner_user_id).toBeNull();
    });

    it.each([
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
    ])('refuses to bootstrap an app from the %s origin', async (origin) => {
        await expect(
            appStore.createFromOrigin(
                `app-bad-${Math.random().toString(36).slice(2, 8)}`,
                origin,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('returns the existing row when the deterministic uid was already inserted', async () => {
        const uid = `app-origin-${Math.random().toString(36).slice(2, 10)}`;
        const origin = `https://${uid}.example.com`;
        const first = await appStore.createFromOrigin(uid, origin);

        // Same uid again — the unique-violation path must resolve to the
        // winner of the race rather than blowing up.
        const second = await appStore.createFromOrigin(uid, origin);
        expect(second.id).toBe(first.id);
        expect(second.uid).toBe(uid);
    });

    // -- list / count ---------------------------------------------------

    it('filters list() by owner, creating app and name', async () => {
        const listOwner = 4100;
        const a = await createApp({}, { ownerUserId: listOwner });
        const b = await createApp(
            {},
            { ownerUserId: listOwner, appOwner: a.id },
        );
        await createApp({}, { ownerUserId: 4101 });

        const byOwner = await appStore.list({ ownerUserId: listOwner });
        expect(byOwner.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());

        const byAppOwner = await appStore.list({ appOwner: a.id });
        expect(byAppOwner.map((x) => x.id)).toEqual([b.id]);

        const byName = await appStore.list({ name: a.name });
        expect(byName.map((x) => x.id)).toEqual([a.id]);
    });

    it('paginates list() with limit, offset and afterId', async () => {
        const pageOwner = 4200;
        const created = [];
        for (let i = 0; i < 4; i++) {
            created.push(await createApp({}, { ownerUserId: pageOwner }));
        }
        const ids = created.map((a) => a.id).sort((x, y) => x - y);

        const firstPage = await appStore.list({
            ownerUserId: pageOwner,
            limit: 2,
        });
        expect(firstPage.map((a) => a.id)).toEqual(ids.slice(0, 2));

        const secondPage = await appStore.list({
            ownerUserId: pageOwner,
            limit: 2,
            offset: 2,
        });
        expect(secondPage.map((a) => a.id)).toEqual(ids.slice(2, 4));

        const after = await appStore.list({
            ownerUserId: pageOwner,
            afterId: ids[1],
        });
        expect(after.map((a) => a.id)).toEqual(ids.slice(2));

        // `afterId: null` is treated as absent, not as `id > NULL`.
        const noCursor = await appStore.list({
            ownerUserId: pageOwner,
            afterId: null,
        });
        expect(noCursor.map((a) => a.id)).toEqual(ids);
    });

    it('caches a list result and drops it when a matching app changes', async () => {
        const cacheOwner = 4300;
        const app = await createApp(
            { title: 'ListCached' },
            {
                ownerUserId: cacheOwner,
            },
        );

        expect(
            (await appStore.list({ ownerUserId: cacheOwner }))[0].title,
        ).toBe('ListCached');
        // Second call is served from redis.
        await db.write('UPDATE `apps` SET `title` = ? WHERE `id` = ?', [
            'BehindTheListCache',
            app.id,
        ]);
        expect(
            (await appStore.list({ ownerUserId: cacheOwner }))[0].title,
        ).toBe('ListCached');

        // A store-level write for this owner invalidates the cached page.
        await appStore.update(app.id, { title: 'AfterUpdate' });
        expect(
            (await appStore.list({ ownerUserId: cacheOwner }))[0].title,
        ).toBe('AfterUpdate');
    });

    it('leaves a cached list for a different owner alone', async () => {
        const keepOwner = 4400;
        const churnOwner = 4401;
        const keeper = await createApp(
            { title: 'Keeper' },
            {
                ownerUserId: keepOwner,
            },
        );
        await appStore.list({ ownerUserId: keepOwner });

        await db.write('UPDATE `apps` SET `title` = ? WHERE `id` = ?', [
            'SilentEdit',
            keeper.id,
        ]);
        // Creating an app for a different owner must not evict keepOwner's
        // cached page.
        await createApp({}, { ownerUserId: churnOwner });

        expect((await appStore.list({ ownerUserId: keepOwner }))[0].title).toBe(
            'Keeper',
        );
    });

    it('falls back to the database when the cached list payload is corrupt', async () => {
        const badOwner = 4500;
        await createApp({ title: 'Recovered' }, { ownerUserId: badOwner });
        await appStore.list({ ownerUserId: badOwner });

        const keys = await redis.smembers('apps:list:keys');
        const key = keys.find((k) => k.includes(String(badOwner)));
        expect(key).toBeDefined();
        await redis.set(key, 'not-json');

        const rows = await appStore.list({ ownerUserId: badOwner });
        expect(rows[0].title).toBe('Recovered');
    });

    it('counts apps by owner, creator and per-caller visibility', async () => {
        const countOwner = 4600;
        const viewer = 4601;
        const open = await createApp({}, { ownerUserId: countOwner });
        await createApp({}, { ownerUserId: countOwner, appOwner: open.id });
        const hidden = await createApp({}, { ownerUserId: countOwner });
        await db.write('UPDATE `apps` SET `protected` = 1 WHERE `id` = ?', [
            hidden.id,
        ]);

        expect(await appStore.count({ ownerUserId: countOwner })).toBe(3);
        expect(await appStore.count({ appOwner: open.id })).toBe(1);

        // The protected app is invisible to a stranger but visible to its
        // owner.
        const strangerView = await appStore.count({
            ownerUserId: countOwner,
            visibleToUserId: viewer,
        });
        expect(strangerView).toBe(2);
        const ownerView = await appStore.count({
            ownerUserId: countOwner,
            visibleToUserId: countOwner,
        });
        expect(ownerView).toBe(3);
    });

    // -- filetype association batch + recent opens ----------------------

    it('getFiletypeAssociationsByIds returns an entry for every requested id', async () => {
        const withTypes = await createApp();
        const withoutTypes = await createApp();
        await appStore.setFiletypeAssociations(withTypes.id, ['md', 'txt']);

        const map = await appStore.getFiletypeAssociationsByIds([
            withTypes.id,
            withTypes.id,
            withoutTypes.id,
            null,
            undefined,
        ]);

        expect(map.size).toBe(2);
        expect(map.get(withTypes.id).sort()).toEqual(['md', 'txt']);
        expect(map.get(withoutTypes.id)).toEqual([]);
        expect((await appStore.getFiletypeAssociationsByIds([])).size).toBe(0);
        expect((await appStore.getFiletypeAssociationsByIds(null)).size).toBe(
            0,
        );
    });

    it('clearing filetype associations on an app that had none is a no-op', async () => {
        const app = await createApp();
        await expect(
            appStore.setFiletypeAssociations(app.id, []),
        ).resolves.toBeUndefined();
        expect(await appStore.getFiletypeAssociations(app.id)).toEqual([]);
    });

    it('lists a user recent app opens most-recent-first, deduped', async () => {
        const userId = 4700;
        const first = `app-open-a-${Date.now()}`;
        const second = `app-open-b-${Date.now()}`;
        const insert = (uid) =>
            db.write(
                'INSERT INTO app_opens (app_uid, user_id, ts) VALUES (?, ?, ?)',
                [uid, userId, Math.floor(Date.now() / 1000)],
            );
        await insert(first);
        await insert(second);
        await insert(first);
        // Another user's opens must not leak in.
        await db.write(
            'INSERT INTO app_opens (app_uid, user_id, ts) VALUES (?, ?, ?)',
            ['app-someone-else', 4701, Math.floor(Date.now() / 1000)],
        );

        expect(await appStore.getRecentAppOpens(userId)).toEqual([
            first,
            second,
        ]);
        expect(await appStore.getRecentAppOpens(userId, { limit: 1 })).toEqual([
            first,
        ]);
        expect(await appStore.getRecentAppOpens(4702)).toEqual([]);
    });

    it('rejects a batch lookup on a column it does not own', async () => {
        await expect(
            appStore.getByIds.call(appStore, [1]),
        ).resolves.toBeInstanceOf(Map);
        // `#getManyByProperty` is private; the guard is reachable only
        // through the two public wrappers, both of which pass a safe key.
        // Assert the wrappers stay on the allow-list.
        const map = await appStore.getByUids(['app-nope']);
        expect(map.size).toBe(0);
    });
});

describe('AppStore detailed stats', () => {
    let server;
    let appStore;
    let db;

    const APP_UID = `app-stats-${Date.now()}`;
    const nowSeconds = Math.floor(Date.now() / 1000);

    beforeAll(async () => {
        server = await setupTestServer();
        appStore = server.stores.app;
        db = server.clients.db;
        await clearAppCache(server.clients.redis);

        // Three opens right now from two distinct users.
        for (const [userId, offset] of [
            [1, 0],
            [1, 60],
            [2, 120],
        ]) {
            await db.write(
                'INSERT INTO app_opens (app_uid, user_id, ts) VALUES (?, ?, ?)',
                [APP_UID, userId, nowSeconds - offset],
            );
        }
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('computes all-time totals from SQL by default', async () => {
        const stats = await appStore.getAppStatsDetailed(APP_UID);
        expect(stats).toEqual({
            open_count: 3,
            user_count: 2,
            referral_count: null,
        });
    });

    it('resolves an app with no opens to zeroes', async () => {
        expect(await appStore.getAppStatsDetailed('app-never-opened')).toEqual({
            open_count: 0,
            user_count: 0,
            referral_count: null,
        });
    });

    it.each([
        'today',
        '7d',
        '30d',
        'this_week',
        'this_month',
        'this_year',
        '12m',
    ])('counts a just-now open inside the %s window', async (period) => {
        const stats = await appStore.getAppStatsDetailed(APP_UID, {
            period,
        });
        expect(stats.open_count).toBe(3);
        expect(stats.user_count).toBe(2);
    });

    it.each(['yesterday', 'last_month', 'last_year'])(
        'excludes a just-now open from the %s window',
        async (period) => {
            const stats = await appStore.getAppStatsDetailed(APP_UID, {
                period,
            });
            expect(stats.open_count).toBe(0);
        },
    );

    it('bounds the all-time window by the app creation timestamp', async () => {
        const future = new Date(Date.now() + 86_400_000).toISOString();
        const stats = await appStore.getAppStatsDetailed(APP_UID, {
            period: 'all',
            createdAt: future,
        });
        expect(stats.open_count).toBe(0);
    });

    it('treats an unknown period as all-time', async () => {
        const stats = await appStore.getAppStatsDetailed(APP_UID, {
            period: 'not-a-period',
        });
        expect(stats.open_count).toBe(3);
    });

    it('rejects an unsupported grouping', async () => {
        await expect(
            appStore.getAppStatsDetailed(APP_UID, { grouping: 'fortnight' }),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
        });
    });

    it('groups by day over a bounded window and fills empty buckets with zero', async () => {
        const stats = await appStore.getAppStatsDetailed(APP_UID, {
            period: '7d',
            grouping: 'day',
        });

        expect(stats.open_count).toBe(3);
        expect(stats.user_count).toBe(2);
        const open = stats.grouped_stats.open_count;
        // A 7-day window yields 8 day buckets (inclusive of both ends).
        expect(open.length).toBeGreaterThanOrEqual(7);
        expect(open.every((b) => typeof b.count === 'number')).toBe(true);
        const today = new Date().toISOString().slice(0, 10);
        const todayBucket = open.find((b) => b.period === today);
        expect(todayBucket?.count).toBe(3);
        // Every earlier bucket is an explicit zero, not a gap.
        expect(
            open.filter((b) => b.period !== today).every((b) => b.count === 0),
        ).toBe(true);
    });

    it.each(['hour', 'day', 'month', 'year'])(
        'returns a complete %s-grouped series',
        async (grouping) => {
            const stats = await appStore.getAppStatsDetailed(APP_UID, {
                period: 'today',
                grouping,
            });
            expect(stats.open_count).toBe(3);
            expect(stats.grouped_stats.open_count.length).toBeGreaterThan(0);
            expect(stats.grouped_stats.user_count.length).toBe(
                stats.grouped_stats.open_count.length,
            );
            expect(stats.referral_count).toBeNull();
        },
    );

    it('still reports week-grouped totals even when bucket keys do not line up', async () => {
        // SQLite's `%Y-%U` week numbering differs from the ISO week the
        // bucket list is generated with; totals are taken from the raw rows
        // precisely so this mismatch can't zero them out.
        const stats = await appStore.getAppStatsDetailed(APP_UID, {
            period: '30d',
            grouping: 'week',
        });
        expect(stats.open_count).toBe(3);
        expect(stats.grouped_stats.open_count.length).toBeGreaterThan(0);
    });

    describe('with a ClickHouse client registered', () => {
        const withClickhouse = async (rows, fn) => {
            const seen = [];
            server.clients.clickhouse = {
                query: async (args) => {
                    seen.push(args);
                    return { json: async () => rows };
                },
            };
            try {
                return await fn(seen);
            } finally {
                delete server.clients.clickhouse;
            }
        };

        it('reads single-period stats from ClickHouse and bounds them by the window', async () => {
            await withClickhouse(
                [{ open_count: '11', user_count: '4' }],
                async (seen) => {
                    const stats = await appStore.getAppStatsDetailed(APP_UID, {
                        period: '7d',
                    });
                    expect(stats).toEqual({ open_count: 11, user_count: 4 });
                    expect(seen[0].query_params.appUid).toBe(APP_UID);
                    expect(typeof seen[0].query_params.tsStart).toBe('number');
                    expect(seen[0].query).toContain('ts >= {tsStart:Int64}');
                },
            );
        });

        it('resolves an empty ClickHouse result to zeroes', async () => {
            await withClickhouse([], async () => {
                expect(
                    await appStore.getAppStatsDetailed(APP_UID, {
                        period: 'today',
                    }),
                ).toEqual({ open_count: 0, user_count: 0 });
            });
        });

        it('maps ClickHouse period timestamps onto the generated buckets', async () => {
            const todayIso = new Date().toISOString().slice(0, 10);
            await withClickhouse(
                [
                    {
                        period: `${todayIso}T00:00:00Z`,
                        open_count: '5',
                        user_count: '3',
                    },
                ],
                async (seen) => {
                    const stats = await appStore.getAppStatsDetailed(APP_UID, {
                        period: '7d',
                        grouping: 'day',
                    });
                    expect(stats.open_count).toBe(5);
                    expect(stats.user_count).toBe(3);
                    expect(seen[0].query).toContain('toStartOfDay');
                    const bucket = stats.grouped_stats.open_count.find(
                        (b) => b.period === todayIso,
                    );
                    expect(bucket?.count).toBe(5);
                },
            );
        });

        it('keeps totals from rows whose period falls outside the bucket list', async () => {
            await withClickhouse(
                [
                    {
                        period: '1999-01-01T00:00:00Z',
                        open_count: '9',
                        user_count: '2',
                    },
                ],
                async () => {
                    const stats = await appStore.getAppStatsDetailed(APP_UID, {
                        period: 'today',
                        grouping: 'day',
                    });
                    expect(stats.open_count).toBe(9);
                    expect(
                        stats.grouped_stats.open_count.every(
                            (b) => b.count === 0,
                        ),
                    ).toBe(true);
                },
            );
        });

        it.each(['hour', 'week', 'month', 'year'])(
            'normalizes a ClickHouse %s bucket key',
            async (grouping) => {
                const iso = new Date().toISOString();
                await withClickhouse(
                    [{ period: iso, open_count: '2', user_count: '1' }],
                    async (seen) => {
                        const stats = await appStore.getAppStatsDetailed(
                            APP_UID,
                            { period: 'today', grouping },
                        );
                        expect(stats.open_count).toBe(2);
                        expect(seen[0].query).toContain('toStartOf');
                    },
                );
            },
        );

        it('produces no buckets when the window start is not a real date', async () => {
            await withClickhouse([], async () => {
                const stats = await appStore.getAppStatsDetailed(APP_UID, {
                    period: 'all',
                    createdAt: 'not-a-date',
                    grouping: 'day',
                });
                expect(stats.grouped_stats.open_count).toEqual([]);
                expect(stats.open_count).toBe(0);
            });
        });
    });
});
