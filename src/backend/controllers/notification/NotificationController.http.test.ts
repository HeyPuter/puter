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
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

/**
 * Route-level coverage for the notification endpoint. Dismissing is the only
 * mark the desktop performs over HTTP, so this suite is what catches the route
 * going missing or a gate turning a legitimate dismiss away.
 */
describe('notification endpoints over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const post = (path: string, token: string, body: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    const seedNotification = async (username: string) => {
        const user = await env.server.stores.user.getByUsername(username);
        const row = await env.server.stores.notification.create({
            userId: user!.id,
            value: { title: 'dismiss me' },
            type: 'share.received',
        });
        return { userId: user!.id as number, uid: row.uid as string };
    };

    it('dismisses a notification', async () => {
        const owner = env.users.user;
        const { userId, uid } = await seedNotification(owner.username);

        const res = await post('/notif/mark-ack', owner.token, { uid });

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({});
        const after = await env.server.stores.notification.getByUid(uid, {
            userId,
        });
        expect(after?.acknowledged).toBeTruthy();
    });

    it('refuses an anonymous dismiss', async () => {
        const { userId, uid } = await seedNotification(env.users.other.username);

        const res = await fetch(new URL('/notif/mark-ack', env.apiOrigin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ uid }),
        });

        expect(res.status).toBeGreaterThanOrEqual(400);
        const after = await env.server.stores.notification.getByUid(uid, {
            userId,
        });
        expect(after?.acknowledged).toBeFalsy();
    });
});
