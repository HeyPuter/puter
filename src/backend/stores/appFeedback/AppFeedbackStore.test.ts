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
import { v4 as uuidv4 } from 'uuid';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { AppFeedbackStore } from './AppFeedbackStore.js';

// Runs against the real in-memory database, so the SQL (and the engine's
// boolean/bigint representations) is exercised rather than described.

let server: PuterServer;
let store: AppFeedbackStore;

beforeAll(async () => {
    server = await setupTestServer();
    store = server.stores.appFeedback;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async (): Promise<number> => {
    const username = `fdbk-store-${Math.random().toString(36).slice(2, 10)}`;
    const user = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
    });
    return user.id;
};

const makeApp = async (ownerUserId: number) => {
    const name = `fdbk-store-app-${Math.random().toString(36).slice(2, 10)}`;
    return await server.stores.app.create(
        {
            name,
            title: `Feedback Store Test ${name}`,
            index_url: `https://${name}.example.com`,
        },
        { ownerUserId },
    );
};

// Each test gets its own user and app so the counts can't see other tests'
// rows — the table is shared across the whole file.
const makeScope = async () => {
    const ownerId = await makeUser();
    const [app, userId] = await Promise.all([makeApp(ownerId), makeUser()]);
    return { app, userId };
};

const readRow = async (id: number) => {
    const rows = (await server.clients.db.read(
        'SELECT * FROM `app_feedback` WHERE `id` = ?',
        [id],
    )) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
};

// Backdate a row so window-scoped counts can be tested without waiting.
const setCreatedAt = async (id: number, createdAt: number) => {
    await server.clients.db.write(
        'UPDATE `app_feedback` SET `created_at` = ? WHERE `id` = ?',
        [createdAt, id],
    );
};

const HOUR = 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

describe('AppFeedbackStore.create', () => {
    it('inserts a row with a fresh uid, email_sent false, and a unix timestamp', async () => {
        const { app, userId } = await makeScope();
        const before = now();

        const created = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'hello dev',
        });

        expect(created.id).toBeGreaterThan(0);
        expect(created.uid).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );

        const row = (await readRow(created.id))!;
        expect(row).toMatchObject({
            uid: created.uid,
            app_uid: app.uid,
            message: 'hello dev',
        });
        // Engine-agnostic reads: pg returns BIGINT as string and BOOLEAN as
        // boolean, sqlite returns numbers for both.
        expect(Number(row.app_id)).toBe(app.id);
        expect(Number(row.user_id)).toBe(userId);
        expect(Boolean(row.email_sent)).toBe(false);
        expect(Number(row.created_at)).toBeGreaterThanOrEqual(before);
        expect(Number(row.created_at)).toBeLessThanOrEqual(now());
    });

    it('persists source_env / source_origin and defaults them to null', async () => {
        const { app, userId } = await makeScope();

        const withSource = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'from the web',
            sourceEnv: 'web',
            sourceOrigin: 'https://example.com',
        });
        expect(await readRow(withSource.id)).toMatchObject({
            source_env: 'web',
            source_origin: 'https://example.com',
        });

        const withoutSource = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'from the desktop',
        });
        expect(await readRow(withoutSource.id)).toMatchObject({
            source_env: null,
            source_origin: null,
        });
    });

    it('gives every row a distinct uid', async () => {
        const { app, userId } = await makeScope();
        const rows = await Promise.all(
            [1, 2, 3].map((n) =>
                store.create({
                    appId: app.id,
                    appUid: app.uid,
                    userId,
                    message: `msg ${n}`,
                }),
            ),
        );
        expect(new Set(rows.map((r) => r.uid)).size).toBe(3);
    });
});

describe('AppFeedbackStore counts', () => {
    it('countByUserSince counts only this user and only inside the window', async () => {
        const { app, userId } = await makeScope();
        const otherUserId = await makeUser();
        const since = now() - 24 * HOUR;

        const recent = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'recent',
        });
        const old = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'old',
        });
        await setCreatedAt(old.id, since - HOUR);
        await store.create({
            appId: app.id,
            appUid: app.uid,
            userId: otherUserId,
            message: 'someone else',
        });

        expect(await store.countByUserSince(userId, since)).toBe(1);
        // The boundary is inclusive — a row exactly at `since` still counts.
        const row = (await readRow(recent.id))!;
        expect(
            await store.countByUserSince(userId, Number(row.created_at)),
        ).toBe(1);
        expect(await store.countByUserSince(otherUserId, since)).toBe(1);
    });

    it('countByUserSince spans apps, countByUserAndAppSince does not', async () => {
        const { app, userId } = await makeScope();
        const otherApp = await makeApp(await makeUser());
        const since = now() - 24 * HOUR;

        for (const target of [app, app, otherApp]) {
            await store.create({
                appId: target.id,
                appUid: target.uid,
                userId,
                message: 'hi',
            });
        }

        expect(await store.countByUserSince(userId, since)).toBe(3);
        expect(await store.countByUserAndAppSince(userId, app.id, since)).toBe(
            2,
        );
        expect(
            await store.countByUserAndAppSince(userId, otherApp.id, since),
        ).toBe(1);
    });

    it('countEmailedByAppSince counts only emailed rows in the window', async () => {
        const { app, userId } = await makeScope();
        const since = now() - 24 * HOUR;

        const emailed = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'emailed',
        });
        await store.markEmailSent(emailed.id);
        // Not emailed.
        await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'stored only',
        });
        // Emailed, but yesterday.
        const stale = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'emailed long ago',
        });
        await store.markEmailSent(stale.id);
        await setCreatedAt(stale.id, since - HOUR);

        expect(await store.countEmailedByAppSince(app.id, since)).toBe(1);
    });

    it('returns 0 rather than null when an app has no feedback', async () => {
        const { app, userId } = await makeScope();
        const since = now() - 24 * HOUR;
        expect(await store.countEmailedByAppSince(app.id, since)).toBe(0);
        expect(await store.countByUserSince(userId, since)).toBe(0);
        expect(await store.countByUserAndAppSince(userId, app.id, since)).toBe(
            0,
        );
    });
});

describe('AppFeedbackStore email-sent claim', () => {
    it('marks and unmarks a single row, and the count follows', async () => {
        const { app, userId } = await makeScope();
        const since = now() - 24 * HOUR;
        const row = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'claimed',
        });
        const sibling = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'untouched',
        });

        await store.markEmailSent(row.id);
        expect(Boolean((await readRow(row.id))!.email_sent)).toBe(true);
        expect(Boolean((await readRow(sibling.id))!.email_sent)).toBe(false);
        expect(await store.countEmailedByAppSince(app.id, since)).toBe(1);

        await store.unmarkEmailSent(row.id);
        expect(Boolean((await readRow(row.id))!.email_sent)).toBe(false);
        expect(await store.countEmailedByAppSince(app.id, since)).toBe(0);
    });
});

describe('AppFeedbackStore.deleteById', () => {
    it('removes the row and leaves the rest of the app alone', async () => {
        const { app, userId } = await makeScope();
        const since = now() - 24 * HOUR;
        const doomed = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'rolled back',
        });
        const kept = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'kept',
        });

        await store.deleteById(doomed.id);

        expect(await readRow(doomed.id)).toBeNull();
        expect(await readRow(kept.id)).not.toBeNull();
        expect(await store.countByUserSince(userId, since)).toBe(1);
    });

    it('is a no-op for an id that no longer exists', async () => {
        const { app, userId } = await makeScope();
        const row = await store.create({
            appId: app.id,
            appUid: app.uid,
            userId,
            message: 'gone',
        });
        await store.deleteById(row.id);
        await expect(store.deleteById(row.id)).resolves.toBeUndefined();
    });
});
