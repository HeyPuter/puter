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

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import type { ResolvedShare } from './ShareService';

describe('ShareNotificationService', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const makeUser = async () => {
        const username = `sn${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        return user;
    };

    const actorFor = (user: { id: number; username: string }): Actor =>
        ({
            user: { id: user.id, username: user.username },
            effectiveApp: null,
        }) as Actor;

    /**
     * A share that granted reach the holder did not already have — the only
     * kind worth interrupting someone for.
     */
    const shareTo = (
        holder: { id: number; username: string },
        over: Partial<ResolvedShare> = {},
    ): ResolvedShare =>
        ({
            uid: 'u',
            mode: 'read',
            path: '/somewhere/file.txt',
            entryUid: 'e',
            isDir: false,
            issuer: { username: 'sender' },
            holder: { username: holder.username },
            holderId: holder.id,
            isNew: true,
            createdAt: null,
            modified: 0,
            size: null,
            ...over,
        }) as ResolvedShare;

    /** Captures what reached the notification layer. */
    const captureNotifications = () => {
        const calls: Array<{
            userIds: number[];
            payload: Record<string, unknown>;
            silent: boolean;
        }> = [];
        vi.spyOn(server.services.notification, 'notify').mockImplementation(
            async (
                userIds: number[],
                payload: Record<string, unknown>,
                opts: { silent?: boolean } = {},
            ) => {
                calls.push({ userIds, payload, silent: Boolean(opts.silent) });
                return 'stub-uid';
            },
        );
        return calls;
    };

    /** The share notifications actually on the recipient's list. */
    const openNotifications = async (userId: number) => {
        const rows = await server.stores.notification.listByUserId(userId, {
            filter: 'unacknowledged',
        });
        return rows.filter(
            (row: { value?: { template?: string } }) =>
                row.value?.template === 'file-shared-with-you',
        );
    };

    it('sends one notification per recipient, counting their items', async () => {
        const sender = actorFor(await makeUser());
        const alice = await makeUser();
        const bob = await makeUser();
        const calls = captureNotifications();

        // Five items across two people is two notifications, not five —
        // sharing a folder's worth of files must not become a mailstorm.
        await server.services.shareNotification.notifyShared(sender, [
            shareTo(alice),
            shareTo(alice),
            shareTo(alice),
            shareTo(bob),
            shareTo(bob),
        ]);

        expect(calls).toHaveLength(2);
        const byUser = new Map(calls.map((c) => [c.userIds[0], c.payload]));
        expect(byUser.get(alice.id)?.fields).toMatchObject({ count: 3 });
        expect(byUser.get(bob.id)?.fields).toMatchObject({ count: 2 });
        expect(byUser.get(alice.id)?.source).toBe('sharing');
    });

    it('says "an item" for one and "items" for several', async () => {
        const sender = actorFor(await makeUser());
        const alice = await makeUser();
        const bob = await makeUser();
        const calls = captureNotifications();

        await server.services.shareNotification.notifyShared(sender, [
            shareTo(alice),
            shareTo(bob),
            shareTo(bob),
        ]);

        const who = sender.user.username;
        const titles = calls.map((c) => String(c.payload.title));
        expect(titles).toContain(`${who} shared an item with you`);
        expect(titles).toContain(`${who} shared 2 items with you`);
    });

    it('does not notify the sender about their own share', async () => {
        const alice = await makeUser();
        const calls = captureNotifications();

        await server.services.shareNotification.notifyShared(actorFor(alice), [
            shareTo(alice),
        ]);

        expect(calls).toHaveLength(0);
    });

    it('stays quiet when nothing succeeded', async () => {
        const sender = actorFor(await makeUser());
        const calls = captureNotifications();
        await server.services.shareNotification.notifyShared(sender, []);
        expect(calls).toHaveLength(0);
    });

    it('swallows a delivery failure rather than surfacing it', async () => {
        const sender = actorFor(await makeUser());
        const alice = await makeUser();
        vi.spyOn(server.services.notification, 'notify').mockRejectedValue(
            new Error('notification backend down'),
        );

        // The share already landed by this point; reporting it as failed would
        // be worse than the recipient not hearing about it.
        await expect(
            server.services.shareNotification.notifyShared(sender, [
                shareTo(alice),
            ]),
        ).resolves.toBeUndefined();
    });

    it('stays quiet about a share that granted no new reach', async () => {
        const sender = actorFor(await makeUser());
        const alice = await makeUser();
        const calls = captureNotifications();

        await server.services.shareNotification.notifyShared(sender, [
            shareTo(alice, { isNew: false }),
        ]);

        expect(calls).toHaveLength(0);
    });

    it('interrupts a pair once per window, recording the rest silently', async () => {
        const sender = actorFor(await makeUser());
        const alice = await makeUser();
        const calls = captureNotifications();

        await server.services.shareNotification.notifyShared(sender, [
            shareTo(alice),
        ]);
        await server.services.shareNotification.notifyShared(sender, [
            shareTo(alice),
        ]);

        // Both are recorded — a suppressed interruption must not lose the
        // share — but only the first one interrupts.
        expect(calls.map((call) => call.silent)).toEqual([false, true]);
    });

    it('folds another sender into a notification the recipient has not dealt with', async () => {
        const alice = actorFor(await makeUser());
        const bob = actorFor(await makeUser());
        const holder = await makeUser();

        await server.services.shareNotification.notifyShared(alice, [
            shareTo(holder),
        ]);
        await server.services.shareNotification.notifyShared(bob, [
            shareTo(holder),
            shareTo(holder),
        ]);

        // Two people sharing with you is one notification that counts them.
        const open = await openNotifications(holder.id);
        expect(open).toHaveLength(1);
        expect(open[0].value.title).toBe(
            `${alice.user.username} and ${bob.user.username} shared 3 items with you`,
        );
        expect(open[0].value.fields.senders).toEqual([
            { username: alice.user.username, count: 1 },
            { username: bob.user.username, count: 2 },
        ]);
    });

    it('records a suppressed share on the open notification, undelivered', async () => {
        const sender = actorFor(await makeUser());
        const holder = await makeUser();

        await server.services.shareNotification.notifyShared(sender, [
            shareTo(holder),
        ]);
        const [first] = await openNotifications(holder.id);
        await server.services.notification.markShown(first.uid, holder.id);

        // Same pair inside the window: no second interruption, but the count
        // has to be right when the recipient looks.
        await server.services.shareNotification.notifyShared(sender, [
            shareTo(holder),
        ]);

        const [folded] = await openNotifications(holder.id);
        expect(folded.uid).toBe(first.uid);
        expect(folded.value.title).toBe(
            `${sender.user.username} shared 2 items with you`,
        );
        // Cleared, so the new wording goes out on the next connect —
        // `#sendUnreads` only carries what was never shown.
        expect(folded.shown).toBeNull();
    });

    it('starts a fresh notification once the last one was dismissed', async () => {
        const alice = actorFor(await makeUser());
        const bob = actorFor(await makeUser());
        const holder = await makeUser();

        await server.services.shareNotification.notifyShared(alice, [
            shareTo(holder),
        ]);
        const [first] = await openNotifications(holder.id);
        await server.services.notification.markAcknowledged(
            first.uid,
            holder.id,
        );

        await server.services.shareNotification.notifyShared(bob, [
            shareTo(holder),
        ]);

        // Dismissed is dealt with; reviving it would put back something the
        // recipient cleared, and it must not carry alice's count either.
        const open = await openNotifications(holder.id);
        expect(open).toHaveLength(1);
        expect(open[0].uid).not.toBe(first.uid);
        expect(open[0].value.title).toBe(
            `${bob.user.username} shared an item with you`,
        );
    });
});

/**
 * The budgets, at settings small enough to reach. Its own server: the limits are
 * read from config, and the point is that they are.
 */
describe('ShareNotificationService budgets', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer({
            share_notify_limits: {
                pairWindowSeconds: 900,
                pairDaily: 20,
                recipientHourly: 2,
                recipientDaily: 50,
            },
        } as never);
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async () => {
        const username = `sb${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        return user;
    };

    const actorFor = (user: { id: number; username: string }): Actor =>
        ({
            user: { id: user.id, username: user.username },
            effectiveApp: null,
        }) as Actor;

    it('stops interrupting a recipient once their own budget is spent, whoever is sharing', async () => {
        const holder = await makeUser();
        const senders = [
            actorFor(await makeUser()),
            actorFor(await makeUser()),
            actorFor(await makeUser()),
        ];
        const silent: boolean[] = [];
        vi.spyOn(server.services.notification, 'notify').mockImplementation(
            async (
                _userIds: number[],
                _payload: Record<string, unknown>,
                opts: { silent?: boolean } = {},
            ) => {
                silent.push(Boolean(opts.silent));
                return 'stub-uid';
            },
        );

        for (const sender of senders) {
            await server.services.shareNotification.notifyShared(sender, [
                {
                    uid: 'u',
                    mode: 'read',
                    path: '/somewhere/file.txt',
                    entryUid: 'e',
                    isDir: false,
                    issuer: { username: sender.user.username },
                    holder: { username: holder.username },
                    holderId: holder.id,
                    isNew: true,
                    createdAt: null,
                    modified: 0,
                    size: null,
                } as ResolvedShare,
            ]);
        }

        // Three different senders, each with an untouched pair budget — what
        // stops the third is the recipient's own hourly ceiling.
        expect(silent).toEqual([false, false, true]);
        vi.restoreAllMocks();
    });
});
