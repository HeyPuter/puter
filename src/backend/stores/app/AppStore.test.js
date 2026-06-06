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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestServer } from '../../testUtil.ts';

// Stats cache TTL the store backfills with (mirrors STATS_CACHE_TTL_SECONDS).
const STATS_CACHE_TTL_SECONDS = 30 * 60;

let counter = 0;
const freshUid = () => `app-test-${Date.now()}-${counter++}`;

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
