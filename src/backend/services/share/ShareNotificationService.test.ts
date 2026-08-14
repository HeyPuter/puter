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
        const calls: Array<{ userIds: number[]; payload: Record<string, unknown> }> = [];
        vi.spyOn(server.services.notification, 'notify').mockImplementation(
            async (userIds: number[], payload: Record<string, unknown>) => {
                calls.push({ userIds, payload });
                return 'stub-uid';
            },
        );
        return calls;
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

    it('notifies a pair once per window, not once per re-share', async () => {
        const sender = actorFor(await makeUser());
        const alice = await makeUser();
        const calls = captureNotifications();

        await server.services.shareNotification.notifyShared(sender, [
            shareTo(alice),
        ]);
        await server.services.shareNotification.notifyShared(sender, [
            shareTo(alice),
        ]);

        expect(calls).toHaveLength(1);
    });
});
