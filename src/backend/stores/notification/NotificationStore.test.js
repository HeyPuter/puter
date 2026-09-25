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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestServer } from '../../testUtil.ts';

describe('NotificationStore', () => {
    let server;
    let store;
    let user;
    let other;

    const makeUser = async () => {
        const username = `notif-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        });
    };

    beforeAll(async () => {
        server = await setupTestServer();
        store = server.stores.notification;
        user = await makeUser();
        other = await makeUser();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    // -- create + read -------------------------------------------------

    it('creates a notification and returns it with the value parsed back', async () => {
        const created = await store.create({
            userId: user.id,
            value: { type: 'friend-request', from: 'someone' },
        });

        expect(created.uid).toBeTruthy();
        expect(created.user_id).toBe(user.id);
        expect(created.value).toEqual({
            type: 'friend-request',
            from: 'someone',
        });
        expect(created.acknowledged).toBeNull();
    });

    it('accepts a pre-serialized value and defaults a missing one to {}', async () => {
        const serialized = await store.create({
            userId: user.id,
            value: JSON.stringify({ a: 1 }),
        });
        expect(serialized.value).toEqual({ a: 1 });

        const empty = await store.create({ userId: user.id });
        expect(empty.value).toEqual({});
    });

    it('keeps a non-JSON string value as a string', async () => {
        const created = await store.create({
            userId: user.id,
            value: 'plain text',
        });
        expect(created.value).toBe('plain text');
    });

    it('rejects a create with no user', async () => {
        await expect(store.create({ value: {} })).rejects.toThrow(
            'userId is required',
        );
    });

    // -- scope tuple ---------------------------------------------------

    it('persists the scope tuple it was given', async () => {
        const appUid = `app-${uuidv4()}`;
        const created = await store.create({
            userId: user.id,
            value: { title: 'Deploy failed' },
            type: 'app.worker.deployFailed',
            audience: 'developer',
            appUid,
        });

        expect(created.type).toBe('app.worker.deployFailed');
        expect(created.audience).toBe('developer');
        expect(created.app_uid).toBe(appUid);

        const reread = await store.getByUid(created.uid, { userId: user.id });
        expect(reread.app_uid).toBe(appUid);
    });

    it('defaults a caller that names no scope to an unattributed account row', async () => {
        const created = await store.create({
            userId: user.id,
            value: { title: 'Legacy' },
        });
        expect(created.type).toBe('');
        expect(created.audience).toBe('account');
        expect(created.app_uid).toBeNull();
    });

    it('carries the scope tuple through listing', async () => {
        const u = await makeUser();
        const appUid = `app-${uuidv4()}`;
        await store.create({
            userId: u.id,
            value: {},
            type: 'share.received',
            audience: 'account',
        });
        await store.create({
            userId: u.id,
            value: {},
            type: 'app.events.ended',
            audience: 'app-user',
            appUid,
        });

        const byType = Object.fromEntries(
            (await store.listByUserId(u.id)).map((r) => [
                r.type,
                { audience: r.audience, appUid: r.app_uid },
            ]),
        );
        expect(byType['share.received']).toEqual({
            audience: 'account',
            appUid: null,
        });
        expect(byType['app.events.ended']).toEqual({
            audience: 'app-user',
            appUid,
        });
    });

    it('returns null for an unknown uid', async () => {
        expect(await store.getByUid('no-such-notification')).toBeNull();
    });

    it('will not hand one user another user notification when scoped', async () => {
        const mine = await store.create({ userId: user.id, value: { x: 1 } });

        // Unscoped lookup finds it (internal callers)...
        expect((await store.getByUid(mine.uid))?.uid).toBe(mine.uid);
        // ...but a user-scoped lookup by the wrong user does not.
        expect(await store.getByUid(mine.uid, { userId: other.id })).toBeNull();
        expect((await store.getByUid(mine.uid, { userId: user.id }))?.uid).toBe(
            mine.uid,
        );
    });

    // -- listing -------------------------------------------------------

    it('lists only the requesting user notifications', async () => {
        const listUser = await makeUser();
        const a = await store.create({ userId: listUser.id, value: { i: 1 } });
        await store.create({ userId: other.id, value: { i: 2 } });

        const rows = await store.listByUserId(listUser.id);
        expect(rows.map((r) => r.uid)).toEqual([a.uid]);
    });

    it('filters by acknowledged / unacknowledged / unseen', async () => {
        const u = await makeUser();
        const acked = await store.create({ userId: u.id, value: { n: 'a' } });
        const shown = await store.create({ userId: u.id, value: { n: 's' } });
        const fresh = await store.create({ userId: u.id, value: { n: 'f' } });

        await store.markAcknowledged(acked.uid, u.id);
        await store.markShown(shown.uid, u.id);

        const uids = (rows) => rows.map((r) => r.uid).sort();

        expect(uids(await store.listByUserId(u.id))).toEqual(
            [acked.uid, shown.uid, fresh.uid].sort(),
        );
        expect(
            uids(await store.listByUserId(u.id, { onlyUnacknowledged: true })),
        ).toEqual([shown.uid, fresh.uid].sort());
        expect(
            uids(await store.listByUserId(u.id, { filter: 'unacknowledged' })),
        ).toEqual([shown.uid, fresh.uid].sort());
        expect(
            uids(await store.listByUserId(u.id, { filter: 'unseen' })),
        ).toEqual([fresh.uid]);
        expect(
            uids(await store.listByUserId(u.id, { filter: 'acknowledged' })),
        ).toEqual([acked.uid]);
    });

    it('narrows a listing to one audience/app slice', async () => {
        const u = await makeUser();
        const appUid = `app-${uuidv4()}`;
        const account = await store.create({ userId: u.id, value: {} });
        const mine = await store.create({
            userId: u.id,
            value: {},
            audience: 'app-user',
            appUid,
        });
        const unattributed = await store.create({
            userId: u.id,
            value: {},
            audience: 'app-user',
        });

        const uids = (rows) => rows.map((r) => r.uid).sort();

        expect(
            uids(
                await store.listByUserId(u.id, {
                    scope: { audiences: ['app-user'], appUid },
                }),
            ),
        ).toEqual([mine.uid]);
        // `null` asks for the rows naming no app, not for any app.
        expect(
            uids(
                await store.listByUserId(u.id, {
                    scope: { audiences: ['app-user'], appUid: null },
                }),
            ),
        ).toEqual([unattributed.uid]);
        expect(
            uids(
                await store.listByUserId(u.id, {
                    scope: {
                        audiences: ['app-user', 'developer'],
                        appUid: null,
                    },
                    filter: 'unseen',
                }),
            ),
        ).toEqual([unattributed.uid]);
        expect(
            uids(
                await store.listByUserId(u.id, {
                    scope: { audiences: ['account'], appUid: null },
                }),
            ),
        ).toEqual([account.uid]);
        expect(
            await store.listByUserId(u.id, {
                scope: { audiences: [], appUid: null },
            }),
        ).toEqual([]);
        // `undefined` is "any app" — a session's own generic slice, which
        // spans both the named app and the unattributed row.
        expect(
            uids(
                await store.listByUserId(u.id, {
                    scope: { audiences: ['app-user'], appUid: undefined },
                }),
            ),
        ).toEqual([mine.uid, unattributed.uid].sort());
    });

    it('ignores an unrecognised filter and returns everything', async () => {
        const u = await makeUser();
        await store.create({ userId: u.id, value: {} });
        expect(
            await store.listByUserId(u.id, { filter: 'nonsense' }),
        ).toHaveLength(1);
    });

    it('honours the limit and coerces junk limits back to the default', async () => {
        const u = await makeUser();
        for (let i = 0; i < 3; i++) {
            await store.create({ userId: u.id, value: { i } });
        }

        expect(await store.listByUserId(u.id, { limit: 2 })).toHaveLength(2);
        expect(await store.listByUserId(u.id, { limit: 0 })).toHaveLength(0);
        expect(await store.listByUserId(u.id, { limit: -5 })).toHaveLength(0);
        expect(await store.listByUserId(u.id, { limit: 2.9 })).toHaveLength(2);
        expect(await store.listByUserId(u.id, { limit: 'lots' })).toHaveLength(
            3,
        );
    });

    // -- scoped replay pages --------------------------------------------

    it('scopes a replay page to one app, to no app, or to any app', async () => {
        const u = await makeUser();
        const appUid = `app-${uuidv4()}`;
        const mine = await store.create({
            userId: u.id,
            value: {},
            audience: 'developer',
            appUid,
        });
        const unattributed = await store.create({
            userId: u.id,
            value: {},
            audience: 'developer',
        });

        const uids = (rows) => rows.map((r) => r.uid).sort();

        expect(
            uids(await store.listScoped(u.id, { audience: 'developer', appUid })),
        ).toEqual([mine.uid]);
        // `null` is the rows naming no app, not "any app".
        expect(
            uids(
                await store.listScoped(u.id, {
                    audience: 'developer',
                    appUid: null,
                }),
            ),
        ).toEqual([unattributed.uid]);
        // `undefined` is a session's own generic slice: every app at once.
        expect(
            uids(
                await store.listScoped(u.id, {
                    audience: 'developer',
                    appUid: undefined,
                }),
            ),
        ).toEqual([mine.uid, unattributed.uid].sort());
    });

    // -- mutations -----------------------------------------------------

    it('acknowledges only once and only for the owning user', async () => {
        const u = await makeUser();
        const n = await store.create({ userId: u.id, value: {} });

        expect(await store.markAcknowledged(n.uid, other.id)).toBe(false);
        expect(await store.markAcknowledged(n.uid, u.id)).toBe(true);
        // Already acknowledged — no second state change.
        expect(await store.markAcknowledged(n.uid, u.id)).toBe(false);

        const row = await store.getByUid(n.uid, { userId: u.id });
        expect(typeof row.acknowledged).toBe('number');
    });

    it('marks shown only once and only for the owning user', async () => {
        const u = await makeUser();
        const n = await store.create({ userId: u.id, value: {} });

        expect(await store.markShown(n.uid, other.id)).toBe(false);
        expect(await store.markShown(n.uid, u.id)).toBe(true);
        expect(await store.markShown(n.uid, u.id)).toBe(false);

        // Shown is not dismissed — the row stays unacknowledged.
        const row = await store.getByUid(n.uid, { userId: u.id });
        expect(row.acknowledged).toBeNull();
    });

    // -- retention -----------------------------------------------------

    /**
     * Age a row by rewriting `created_at`. The format is what every engine
     * writes for a timestamp column, so the comparison the sweep makes is the
     * one production makes.
     */
    const backdate = async (uid, days) => {
        const when = new Date(Date.now() - days * 86_400_000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19);
        await server.clients.db.write(
            'UPDATE `notification` SET `created_at` = ? WHERE `uid` = ?',
            [when, uid],
        );
    };

    /** Clear anything an earlier test aged, so counts below are exact. */
    const drain = async () => {
        while ((await store.deleteCreatedBefore(14, 500)) > 0);
    };

    it('deletes rows past the window and leaves the ones inside it', async () => {
        await drain();
        const u = await makeUser();
        const old = await store.create({ userId: u.id, value: { n: 'old' } });
        const alsoOld = await store.create({ userId: u.id, value: { n: '2' } });
        const recent = await store.create({
            userId: u.id,
            value: { n: 'new' },
        });
        await backdate(old.uid, 20);
        await backdate(alsoOld.uid, 15);
        await backdate(recent.uid, 13);

        expect(await store.deleteCreatedBefore(14, 500)).toBe(2);
        expect(await store.getByUid(old.uid)).toBeNull();
        expect(await store.getByUid(alsoOld.uid)).toBeNull();
        expect((await store.getByUid(recent.uid))?.uid).toBe(recent.uid);
    });

    it('takes acknowledged rows and unacknowledged ones alike', async () => {
        await drain();
        const u = await makeUser();
        const acked = await store.create({ userId: u.id, value: {} });
        const never = await store.create({ userId: u.id, value: {} });
        await store.markAcknowledged(acked.uid, u.id);
        await backdate(acked.uid, 20);
        await backdate(never.uid, 20);

        expect(await store.deleteCreatedBefore(14, 500)).toBe(2);
        expect(await store.listByUserId(u.id)).toEqual([]);
    });

    it('stops at the batch size so the caller can keep going', async () => {
        await drain();
        const u = await makeUser();
        for (let i = 0; i < 5; i++) {
            const row = await store.create({ userId: u.id, value: { i } });
            await backdate(row.uid, 20);
        }

        expect(await store.deleteCreatedBefore(14, 2)).toBe(2);
        expect(await store.deleteCreatedBefore(14, 2)).toBe(2);
        expect(await store.deleteCreatedBefore(14, 2)).toBe(1);
        expect(await store.deleteCreatedBefore(14, 2)).toBe(0);
    });

    it('deletes nothing for a window or batch that is not a positive count', async () => {
        await drain();
        const u = await makeUser();
        const n = await store.create({ userId: u.id, value: {} });
        await backdate(n.uid, 40);

        for (const [days, limit] of [
            [0, 500],
            [-1, 500],
            ['forever', 500],
            [14, 0],
            [14, -5],
        ]) {
            expect(await store.deleteCreatedBefore(days, limit)).toBe(0);
        }
        expect((await store.getByUid(n.uid))?.uid).toBe(n.uid);
    });

    it('will not delete another user notification', async () => {
        const u = await makeUser();
        const n = await store.create({ userId: u.id, value: {} });

        expect(await store.deleteByUid(n.uid, other.id)).toBe(false);
        expect(await store.getByUid(n.uid)).not.toBeNull();

        expect(await store.deleteByUid(n.uid, u.id)).toBe(true);
        expect(await store.getByUid(n.uid)).toBeNull();
    });
});
