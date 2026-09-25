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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { NotificationService } from './NotificationService.js';

let server: PuterServer;
let notifications: NotificationService;

/** Collect every emission of `key` until the returned stop() is called. */
const collect = (key: string): { seen: unknown[]; stop: () => void } => {
    const seen: unknown[] = [];
    const handler = (_k: string, data: unknown) => {
        seen.push(data);
    };
    server.clients.event.on(key, handler);
    return {
        seen,
        stop: () => server.clients.event.off?.(key, handler),
    };
};

const waitFor = async (
    predicate: () => boolean,
    timeoutMs = 3000,
): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 10));
    }
};

/** The real write, kept for the spy that counts statements to pass through. */
let dbWrite: (statement: string, params?: unknown) => Promise<unknown>;

const makeUser = async (): Promise<{ id: number; username: string }> => {
    const username = `notif-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        requires_email_confirmation: false,
    });
    return { id: created.id, username };
};

beforeAll(async () => {
    // Retention is opt-in (config.default.json ships without it), so the
    // sweepExpired suite below needs it turned on explicitly.
    server = await setupTestServer({
        notificationRetentionDays: 14,
    } as never);
    notifications = server.services
        .notification as unknown as NotificationService;
    dbWrite = server.clients.db.write.bind(server.clients.db);
});

afterAll(async () => {
    await server?.shutdown();
});

type NotifPush = {
    user_id_list: number[];
    response: { uid: string; notification?: Record<string, unknown> };
};

describe('NotificationService.notify', () => {
    it('pushes each recipient the uid that names their own row', async () => {
        const a = await makeUser();
        const b = await makeUser();

        const pushed = collect('outer.gui.notif.message');

        const uid = await notifications.notify(
            [a.id, b.id],
            { title: 'hello' },
            { type: 'share.received' },
        );

        // One push per recipient, each with a distinct uid — the row uid is
        // UNIQUE table-wide, so a shared batch uid could never name both rows.
        expect(pushed.seen).toHaveLength(2);
        const byUser = new Map(
            (pushed.seen as NotifPush[]).map((p) => [
                p.user_id_list[0],
                p.response,
            ]),
        );
        expect([...byUser.keys()].sort()).toEqual([a.id, b.id].sort());
        expect(byUser.get(a.id)!.notification).toEqual({
            title: 'hello',
            type: 'share.received',
        });
        expect(byUser.get(a.id)!.uid).not.toBe(byUser.get(b.id)!.uid);
        // The returned uid is the first recipient's.
        expect(uid).toBe(byUser.get(a.id)!.uid);

        // Regression: the pushed uid must resolve to a real row, otherwise
        // the client's dismiss (`/notif/mark-ack`) matches nothing and the
        // notification reappears on every reconnect.
        for (const user of [a, b]) {
            const rows = await server.stores.notification.listByUserId(
                user.id,
                {},
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].uid).toBe(byUser.get(user.id)!.uid);
            expect(rows[0].value).toEqual({
                title: 'hello',
                type: 'share.received',
            });
            expect(rows[0].type).toBe('share.received');
            expect(rows[0].audience).toBe('account');
            expect(rows[0].app_uid).toBeNull();
        }

        pushed.stop();
    });

    it('writes the row before it pushes, so no push names a missing row', async () => {
        const user = await makeUser();
        const seenAtPush: unknown[] = [];
        const handler = (_k: string, data: unknown) => {
            const { uid } = (data as NotifPush).response;
            seenAtPush.push(
                server.stores.notification.getByUid(uid, { userId: user.id }),
            );
        };
        server.clients.event.on('outer.gui.notif.message', handler);

        await notifications.notify(
            [user.id],
            { title: 'ordered' },
            { type: 'share.received' },
        );

        expect(seenAtPush).toHaveLength(1);
        expect(await seenAtPush[0]).not.toBeNull();
        server.clients.event.off?.('outer.gui.notif.message', handler);
    });

    it('pushes nothing for a recipient whose insert failed', async () => {
        const good = await makeUser();
        const pushed = collect('outer.gui.notif.message');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // userId 0 is falsy — NotificationStore.create rejects it. The
        // remaining user must still be written and still be pushed to.
        await notifications.notify(
            [0, good.id],
            { title: 'partial' },
            { type: 'share.received' },
        );

        const rows = await server.stores.notification.listByUserId(good.id, {});
        expect(rows).toHaveLength(1);
        // The failed recipient reached no client at all: a uid nobody can
        // acknowledge is worse than no notification.
        expect(
            (pushed.seen as NotifPush[]).map((p) => p.user_id_list[0]),
        ).toEqual([good.id]);
        expect(warn).toHaveBeenCalledWith(
            '[notification] persist failed for user 0',
            expect.anything(),
        );

        warn.mockRestore();
        pushed.stop();
    });

    it('is a no-op push for an empty recipient list', async () => {
        const pushed = collect('outer.gui.notif.message');
        const uid = await notifications.notify(
            [],
            {},
            { type: 'share.received' },
        );
        expect(pushed.seen).toEqual([]);
        // Nothing was written, so there is no uid that would name anything.
        expect(uid).toBeNull();
        pushed.stop();
    });

    it('records the audience and app the registry entry declares', async () => {
        const user = await makeUser();
        const appUid = `app-${uuidv4()}`;

        await notifications.notify(
            [user.id],
            { title: 'subscription ended' },
            { type: 'app.events.ended', appUid },
        );

        const [row] = await server.stores.notification.listByUserId(
            user.id,
            {},
        );
        expect(row.type).toBe('app.events.ended');
        expect(row.audience).toBe('app-user');
        expect(row.app_uid).toBe(appUid);
    });

    it('writes nothing and pushes nothing for an unregistered type', async () => {
        const user = await makeUser();
        const pushed = collect('outer.gui.notif.message');

        await expect(
            notifications.notify(
                [user.id],
                { title: 'nope' },
                // Only reachable from an untyped caller; the registry is the
                // gate either way.
                { type: 'account.invented' as 'share.received' },
            ),
        ).rejects.toThrow('not registered');

        expect(pushed.seen).toEqual([]);
        expect(
            await server.stores.notification.listByUserId(user.id, {}),
        ).toHaveLength(0);
        pushed.stop();
    });

    it('refuses an app uid on an account type and a missing one on an app-scoped type', async () => {
        const user = await makeUser();
        const pushed = collect('outer.gui.notif.message');

        await expect(
            notifications.notify(
                [user.id],
                {},
                { type: 'share.received', appUid: `app-${uuidv4()}` },
            ),
        ).rejects.toThrow('cannot name an app');

        await expect(
            notifications.notify(
                [user.id],
                {},
                { type: 'app.events.suspended' },
            ),
        ).rejects.toThrow('requires an app uid');

        expect(pushed.seen).toEqual([]);
        expect(
            await server.stores.notification.listByUserId(user.id, {}),
        ).toHaveLength(0);
        pushed.stop();
    });
});

describe('NotificationService.notifyUpdate', () => {
    it('rewrites an open row and keeps its type on the payload', async () => {
        const user = await makeUser();
        const uid = await notifications.notify(
            [user.id],
            { title: 'one share' },
            { type: 'share.received' },
        );

        const pushed = collect('outer.gui.notif.message');
        expect(
            await notifications.notifyUpdate(
                uid,
                user.id,
                { title: 'two shares' },
                { type: 'share.received' },
            ),
        ).toBe(true);

        expect(pushed.seen).toHaveLength(1);
        expect((pushed.seen[0] as NotifPush).response.notification).toEqual({
            title: 'two shares',
            type: 'share.received',
        });
        const row = await server.stores.notification.getByUid(uid, {
            userId: user.id,
        });
        // The scope columns belong to the original row and do not move.
        expect(row?.type).toBe('share.received');
        expect(row?.audience).toBe('account');
        pushed.stop();
    });

    it('refuses to fold a type that does not group', async () => {
        const user = await makeUser();
        await expect(
            notifications.notifyUpdate(
                'no-such-uid',
                user.id,
                {},
                { type: 'share.claimed' },
            ),
        ).rejects.toThrow('not groupable');
    });
});

describe('NotificationService.markAcknowledged', () => {
    it("acknowledges the row and pushes an ack to the user's other tabs", async () => {
        const user = await makeUser();
        const row = await server.stores.notification.create({
            userId: user.id,
            value: { source: 'test', title: 'ack me' },
        });
        const acks = collect('outer.gui.notif.ack');

        const acknowledged = await notifications.markAcknowledged(
            row.uid,
            user.id,
        );

        expect(acknowledged).toBe(true);
        expect(acks.seen).toEqual([
            { user_id_list: [user.id], response: { uid: row.uid } },
        ]);
        const fresh = await server.stores.notification.getByUid(row.uid, {
            userId: user.id,
        });
        expect(fresh?.acknowledged).toBeTruthy();
        acks.stop();
    });

    it('emits nothing and reports false for a row already acknowledged', async () => {
        const user = await makeUser();
        const row = await server.stores.notification.create({
            userId: user.id,
            value: { source: 'test', title: 'ack twice' },
        });
        await notifications.markAcknowledged(row.uid, user.id);

        const acks = collect('outer.gui.notif.ack');
        const acknowledgedAgain = await notifications.markAcknowledged(
            row.uid,
            user.id,
        );

        expect(acknowledgedAgain).toBe(false);
        expect(acks.seen).toEqual([]);
        acks.stop();
    });

    it('emits nothing and reports false for a uid naming nobody`s row', async () => {
        const user = await makeUser();
        const acks = collect('outer.gui.notif.ack');

        const acknowledged = await notifications.markAcknowledged(
            'no-such-uid',
            user.id,
        );

        expect(acknowledged).toBe(false);
        expect(acks.seen).toEqual([]);
        acks.stop();
    });
});

describe('NotificationService — unread delivery on connect', () => {
    it('sends unseen notifications once per burst of tab connects and marks them shown', async () => {
        vi.useFakeTimers();
        try {
            const user = await makeUser();
            const first = await server.stores.notification.create({
                userId: user.id,
                value: { source: 'test', title: 'one' },
            });
            const second = await server.stores.notification.create({
                userId: user.id,
                value: { source: 'test', title: 'two' },
            });
            // Already acknowledged — must not be re-delivered.
            const done = await server.stores.notification.create({
                userId: user.id,
                value: { source: 'test', title: 'done' },
            });
            await server.stores.notification.markAcknowledged(
                done.uid,
                user.id,
            );

            const unreads = collect('outer.gui.notif.unreads');
            const acks = collect('outer.gui.notif.ack');
            const updates: string[] = [];
            const write = vi
                .spyOn(server.clients.db, 'write')
                .mockImplementation(async (statement: string, params) => {
                    if (statement.includes('UPDATE `notification`'))
                        updates.push(statement);
                    return dbWrite(statement, params);
                });

            // Three tabs connect in quick succession — the debounce must
            // collapse them into a single delivery.
            for (let i = 0; i < 3; i++) {
                server.clients.event.emit(
                    'web.socket.user-connected',
                    { user: { id: user.id } },
                    {},
                );
            }
            await vi.advanceTimersByTimeAsync(2100);
            // The handler awaits store reads; drain those microtasks.
            await vi.waitFor(() => expect(unreads.seen).toHaveLength(1));

            const payload = unreads.seen[0] as {
                user_id_list: number[];
                response: {
                    unreads: Array<{
                        uid: string;
                        notification: unknown;
                        created_at: unknown;
                    }>;
                };
            };
            expect(payload.user_id_list).toEqual([user.id]);
            expect(payload.response.unreads.map((u) => u.uid).sort()).toEqual(
                [first.uid, second.uid].sort(),
            );
            expect(payload.response.unreads[0].notification).toBeTruthy();
            // Dated, so a client can order and label what it was handed.
            expect(payload.response.unreads[0].created_at).toBeTruthy();

            // Delivered rows are marked shown so a reconnect doesn't repeat them.
            const after = await server.stores.notification.getByUid(first.uid, {
                userId: user.id,
            });
            expect(after?.shown).toBeTruthy();

            // One statement for the batch, however many rows it carried — a
            // round trip per row is a round trip per notification on a path
            // that runs whenever anyone opens the desktop.
            expect(updates).toHaveLength(1);
            // An ack means "stop showing this", which is the opposite of what
            // a replay is doing.
            expect(acks.seen).toEqual([]);

            write.mockRestore();
            acks.stop();
            unreads.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stays silent for a user with nothing unseen', async () => {
        vi.useFakeTimers();
        try {
            const user = await makeUser();
            const unreads = collect('outer.gui.notif.unreads');
            server.clients.event.emit(
                'web.socket.user-connected',
                { user: { id: user.id } },
                {},
            );
            await vi.advanceTimersByTimeAsync(2100);
            await vi.advanceTimersByTimeAsync(100);
            expect(unreads.seen).toHaveLength(0);
            unreads.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it('ignores a connect event with no user id', async () => {
        vi.useFakeTimers();
        try {
            const unreads = collect('outer.gui.notif.unreads');
            server.clients.event.emit(
                'web.socket.user-connected',
                { user: {} },
                {},
            );
            server.clients.event.emit('web.socket.user-connected', {}, {});
            await vi.advanceTimersByTimeAsync(2100);
            expect(unreads.seen).toHaveLength(0);
            unreads.stop();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('NotificationService — shown on delivery', () => {
    it('marks a pushed notification shown only where the recipient is connected', async () => {
        const user = await makeUser();
        const connected = vi
            .spyOn(server.services.socket, 'has')
            .mockReturnValue(true);

        const uid = await notifications.notify(
            [user.id],
            { title: 'receipt' },
            { type: 'share.received' },
        );

        const [row] = await server.stores.notification.listByUserId(user.id, {});
        expect(row.uid).toBe(uid);
        expect(row.shown).toBeTruthy();

        // Nobody there to see it: the row stays unseen so the reconnect
        // replay is what carries it.
        connected.mockReturnValue(false);
        await notifications.notify(
            [user.id],
            { title: 'missed' },
            { type: 'share.received' },
        );
        const unseen = await server.stores.notification.listByUserId(user.id, {
            filter: 'unseen',
        });
        expect(unseen.map((r) => r.value)).toEqual([
            { title: 'missed', type: 'share.received' },
        ]);

        connected.mockRestore();
    });
});

describe('NotificationService.sweepExpired', () => {
    /** Rows aged past the window, written straight in so the age is fixture. */
    const seedExpired = async (
        userId: number,
        count: number,
        days = 20,
    ): Promise<string[]> => {
        const when = new Date(Date.now() - days * 86_400_000)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 19);
        const uids = Array.from({ length: count }, () => uuidv4());
        await server.clients.db.batchWrite(
            uids.map((uid) => ({
                statement:
                    'INSERT INTO `notification` (`uid`, `user_id`, `value`, `created_at`) ' +
                    'VALUES (?, ?, ?, ?)',
                values: [uid, userId, '{}', when],
            })),
        );
        return uids;
    };

    it('removes what has aged out and leaves the mailbox otherwise intact', async () => {
        await notifications.sweepExpired();
        const user = await makeUser();
        const [expired] = await seedExpired(user.id, 1);
        const kept = await server.stores.notification.create({
            userId: user.id,
            value: { title: 'still fresh' },
        });

        expect(await notifications.sweepExpired()).toBe(1);

        expect(await server.stores.notification.getByUid(expired)).toBeNull();
        const unread = await server.stores.notification.listByUserId(user.id, {
            onlyUnacknowledged: true,
        });
        expect(unread.map((r) => r.uid)).toEqual([kept.uid]);
        // Replay only carries what was never shown, and that is unchanged too.
        const unseen = await server.stores.notification.listByUserId(user.id, {
            filter: 'unseen',
        });
        expect(unseen.map((r) => r.uid)).toEqual([kept.uid]);
    });

    it('keeps batching until the window is clean', async () => {
        await notifications.sweepExpired();
        const user = await makeUser();
        // More than one batch takes, so the loop has to come back around.
        await seedExpired(user.id, 600);

        expect(await notifications.sweepExpired()).toBe(600);
        expect(await server.stores.notification.listByUserId(user.id)).toEqual(
            [],
        );
        // Nothing left, so the next pass ends on its first batch.
        expect(await notifications.sweepExpired()).toBe(0);
    });

    it('stops at the pass cap and leaves the rest for the next sweep', async () => {
        await notifications.sweepExpired();
        const user = await makeUser();
        // 50 passes * 500/batch = 25,000 — a backlog past that so the cap,
        // not a short batch, is what ends the first call.
        await seedExpired(user.id, 25_050);

        expect(await notifications.sweepExpired()).toBe(25_000);
        expect(
            await server.stores.notification.listByUserId(user.id),
        ).toHaveLength(50);
        expect(await notifications.sweepExpired()).toBe(50);
    });

    it('sweeps nothing when no retention is configured', async () => {
        const unbounded = await setupTestServer({
            notificationRetentionDays: 0,
        } as never);
        try {
            const service = unbounded.services
                .notification as unknown as NotificationService;
            const created = await unbounded.stores.user.create({
                username: `notif-${Math.random().toString(36).slice(2, 10)}`,
                uuid: uuidv4(),
                password: null,
                email: `retention-${Date.now()}@test.local`,
                requires_email_confirmation: false,
            });
            const when = new Date(Date.now() - 400 * 86_400_000)
                .toISOString()
                .replace('T', ' ')
                .slice(0, 19);
            await unbounded.clients.db.write(
                'INSERT INTO `notification` (`uid`, `user_id`, `value`, `created_at`) ' +
                    'VALUES (?, ?, ?, ?)',
                [uuidv4(), created.id, '{}', when],
            );

            expect(await service.sweepExpired()).toBe(0);
            expect(
                await unbounded.stores.notification.listByUserId(created.id),
            ).toHaveLength(1);
        } finally {
            await unbounded.shutdown();
        }
    });
});
