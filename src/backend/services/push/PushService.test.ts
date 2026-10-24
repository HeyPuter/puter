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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';

describe('PushService device cleanup', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const devices = () => server.stores.pushDevice;

    const makeUser = async () => {
        const username = `ps${Math.random().toString(36).slice(2, 9)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const user = await server.stores.user.getByUsername(username);
        if (!user) throw new Error('test user missing');
        return user;
    };

    const register = (userId: number, sessionUid: string) =>
        devices().register({
            userId,
            sessionUid,
            platform: 'web',
            token: `https://push.example.test/${Math.random().toString(36).slice(2)}`,
        });

    const newSession = async (userId: number): Promise<string> => {
        const row = (await server.stores.session.create(userId)) as {
            uuid: string;
        };
        return row.uuid;
    };

    const setLastSeen = async (uid: string, seconds: number) => {
        await server.clients.db.write(
            'UPDATE `push_device` SET `last_seen_at` = ? WHERE `uid` = ?',
            [seconds, uid],
        );
    };

    it('removes a revoked session’s devices and keeps the rest', async () => {
        const user = await makeUser();
        const revoked = await newSession(user.id);
        const kept = await newSession(user.id);
        const gone = await register(user.id, revoked);
        const stays = await register(user.id, kept);

        await server.services.auth.revokeSession(revoked);

        await vi.waitFor(async () => {
            expect(await devices().getByUid(gone.uid)).toBeNull();
        });
        expect(await devices().getByUid(stays.uid)).not.toBeNull();
    });

    it('removes every session named in one revoke, for that user only', async () => {
        const user = await makeUser();
        const other = await makeUser();
        const a = await register(user.id, 'sess-a');
        const b = await register(user.id, 'sess-b');
        const c = await register(user.id, 'sess-c');
        const othersA = await register(other.id, 'sess-a');

        server.clients.event.emit(
            'outer.auth.sessions.revoked',
            { user_id: user.id, session_uids: ['sess-a', 'sess-b'] },
            {},
        );

        await vi.waitFor(async () => {
            expect(await devices().getByUid(a.uid)).toBeNull();
            expect(await devices().getByUid(b.uid)).toBeNull();
        });
        expect(await devices().getByUid(c.uid)).not.toBeNull();
        expect(await devices().getByUid(othersA.uid)).not.toBeNull();
    });

    it('ignores a revoke relayed from another cluster', async () => {
        const user = await makeUser();
        const device = await register(user.id, 'sess-relayed');
        const spy = vi.spyOn(devices(), 'removeBySessions');

        server.clients.event.emit(
            'outer.auth.sessions.revoked',
            { user_id: user.id, session_uids: ['sess-relayed'] },
            { from_outside: true },
        );
        server.clients.event.emit(
            'outer.auth.sessions.revoked',
            { user_id: user.id, session_uids: [] },
            {},
        );

        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
        expect(await devices().getByUid(device.uid)).not.toBeNull();
    });

    it('removes devices when the account is deleted', async () => {
        const user = await makeUser();
        const other = await makeUser();
        const mine = await register(user.id, 'sess-del');
        const theirs = await register(other.id, 'sess-del');

        await server.services.userAccount.cascadeDelete(user.id);

        expect(await devices().getByUid(mine.uid)).toBeNull();
        expect(await devices().getByUid(theirs.uid)).not.toBeNull();
    });

    it('sweeps devices unseen past the retention window', async () => {
        const user = await makeUser();
        const now = Math.floor(Date.now() / 1000);
        const stale = await register(user.id, 'sess-stale');
        const recent = await register(user.id, 'sess-recent');
        await setLastSeen(stale.uid, now - 61 * 86_400);
        await setLastSeen(recent.uid, now - 59 * 86_400);

        expect(await server.services.push.sweepStaleDevices()).toBe(1);
        expect(await devices().getByUid(stale.uid)).toBeNull();
        expect(await devices().getByUid(recent.uid)).not.toBeNull();
    });

    // Last: it starts the service's shutdown.
    it('stops sweeping once shutdown has started', async () => {
        const user = await makeUser();
        const stale = await register(user.id, 'sess-shutdown');
        await setLastSeen(stale.uid, 1000);

        server.services.push.onServerPrepareShutdown();

        expect(await server.services.push.sweepStaleDevices()).toBe(0);
        expect(await devices().getByUid(stale.uid)).not.toBeNull();
    });
});
