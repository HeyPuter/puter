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
    server = await setupTestServer();
    notifications = server.services
        .notification as unknown as NotificationService;
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
        const persisted = collect('outer.gui.notif.persisted');

        const uid = await notifications.notify([a.id, b.id], {
            source: 'test',
            title: 'hello',
        });

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
            source: 'test',
            title: 'hello',
        });
        expect(byUser.get(a.id)!.uid).not.toBe(byUser.get(b.id)!.uid);
        // The returned uid is the first recipient's.
        expect(uid).toBe(byUser.get(a.id)!.uid);

        await waitFor(() => persisted.seen.length === 2);

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
            expect(rows[0].value).toEqual({ source: 'test', title: 'hello' });
        }

        pushed.stop();
        persisted.stop();
    });

    it('persists the surviving recipients when one insert fails', async () => {
        const good = await makeUser();
        const persisted = collect('outer.gui.notif.persisted');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // userId 0 is falsy — NotificationStore.create rejects it. The
        // remaining user must still be written and still report persisted.
        await notifications.notify([0, good.id], {
            source: 'test',
            title: 'partial',
        });

        await waitFor(() =>
            persisted.seen.some(
                (d) => (d as NotifPush).user_id_list[0] === good.id,
            ),
        );
        const rows = await server.stores.notification.listByUserId(good.id, {});
        expect(rows).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(
            '[notification] persist failed for user 0',
            expect.anything(),
        );

        warn.mockRestore();
        persisted.stop();
    });

    it('is a no-op push for an empty recipient list', async () => {
        const pushed = collect('outer.gui.notif.message');
        const uid = await notifications.notify([], { source: 'test' });
        expect(pushed.seen).toEqual([]);
        expect(uid).toMatch(/^[0-9a-f-]{8}-/);
        pushed.stop();
    });
});

describe('NotificationService.markAcknowledged / markShown', () => {
    it("acknowledges the row and pushes an ack to the user's other tabs", async () => {
        const user = await makeUser();
        const row = await server.stores.notification.create({
            userId: user.id,
            value: { source: 'test', title: 'ack me' },
        });
        const acks = collect('outer.gui.notif.ack');

        await notifications.markAcknowledged(row.uid, user.id);

        expect(acks.seen).toEqual([
            { user_id_list: [user.id], response: { uid: row.uid } },
        ]);
        const fresh = await server.stores.notification.getByUid(row.uid, {
            userId: user.id,
        });
        expect(fresh?.acknowledged).toBeTruthy();
        acks.stop();
    });

    it('marks the row shown and pushes an ack', async () => {
        const user = await makeUser();
        const row = await server.stores.notification.create({
            userId: user.id,
            value: { source: 'test', title: 'show me' },
        });
        const acks = collect('outer.gui.notif.ack');

        await notifications.markShown(row.uid, user.id);

        expect(acks.seen).toEqual([
            { user_id_list: [user.id], response: { uid: row.uid } },
        ]);
        const fresh = await server.stores.notification.getByUid(row.uid, {
            userId: user.id,
        });
        expect(fresh?.shown).toBeTruthy();
        expect(fresh?.acknowledged).toBeFalsy();
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
                response: { unreads: Array<{ uid: string }> };
            };
            expect(payload.user_id_list).toEqual([user.id]);
            expect(payload.response.unreads.map((u) => u.uid).sort()).toEqual(
                [first.uid, second.uid].sort(),
            );
            expect(payload.response.unreads[0].notification).toBeTruthy();

            // Delivered rows are marked shown so a reconnect doesn't repeat them.
            const after = await server.stores.notification.getByUid(first.uid, {
                userId: user.id,
            });
            expect(after?.shown).toBeTruthy();

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

describe('NotificationService — delivery receipts', () => {
    it('marks a notification shown once the socket fan-out reports delivery', async () => {
        const user = await makeUser();
        const uid = await notifications.notify([user.id], {
            source: 'test',
            title: 'receipt',
        });

        // What SocketService emits after pushing `notif.message` to a room.
        server.clients.event.emit(
            'sent-to-user.notif.message',
            { user_id: user.id, response: { uid } },
            {},
        );

        // The receipt waits on the pending insert before updating the row,
        // so the row exists and ends up shown.
        await vi.waitFor(async () => {
            const rows = await server.stores.notification.listByUserId(
                user.id,
                {},
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].shown).toBeTruthy();
        });
    });

    it('ignores a receipt missing the uid or the user id', async () => {
        const user = await makeUser();
        // Neither of these should throw or touch the store.
        server.clients.event.emit(
            'sent-to-user.notif.message',
            { user_id: user.id, response: {} },
            {},
        );
        server.clients.event.emit(
            'sent-to-user.notif.message',
            { response: { uid: 'x' } },
            {},
        );
        server.clients.event.emit('sent-to-user.notif.message', undefined, {});
        const rows = await server.stores.notification.listByUserId(user.id, {});
        expect(rows).toHaveLength(0);
    });
});
