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

import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { PuterServer } from '../../server.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { setupTestServer } from '../../testUtil.js';
import type { ProfileController } from './ProfileController.js';

// GET /profile without a username: the caller's own profile, read alongside
// their account row.
describe('ProfileController own profile', () => {
    let server: PuterServer;
    let controller: ProfileController;

    beforeAll(async () => {
        server = await setupTestServer();
        controller = server.controllers.profile as unknown as ProfileController;
    }, 120_000);

    afterAll(async () => {
        await server?.shutdown();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const makeUser = async (): Promise<UserRow> => {
        const username = `pc-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            requires_email_confirmation: false,
        } as Parameters<typeof server.stores.user.create>[0]);
    };

    const getOwn = async (uuid: string) => {
        let body: unknown;
        const res = {
            json: (value: unknown) => {
                body = value;
            },
        } as unknown as Response;
        await controller.get(
            { query: {}, actor: { user: { uuid } } } as unknown as Request,
            res,
        );
        return body;
    };

    const isProfilePath = (path: unknown) =>
        String(path).startsWith('/system/profiles/');

    it('starts reading the profile before the account lookup returns', async () => {
        const user = await makeUser();
        await server.services.profile.updateProfile(user, { bio: 'hi' });

        const order: string[] = [];
        const getByUuid = server.stores.user.getByUuid.bind(server.stores.user);
        vi.spyOn(server.stores.user, 'getByUuid').mockImplementation(
            async (...args: Parameters<typeof getByUuid>) => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                order.push('account');
                return getByUuid(...args);
            },
        );
        const getEntryByPath = server.stores.fsEntry.getEntryByPath.bind(
            server.stores.fsEntry,
        );
        vi.spyOn(server.stores.fsEntry, 'getEntryByPath').mockImplementation(
            async (...args: Parameters<typeof getEntryByPath>) => {
                if (isProfilePath(args[0])) order.push('profile');
                return getEntryByPath(...args);
            },
        );

        await expect(getOwn(user.uuid)).resolves.toEqual({
            picture: null,
            displayName: null,
            bio: 'hi',
        });
        expect(order).toEqual(['profile', 'account']);
    });

    it('404s a caller with no account, whatever the profile read did', async () => {
        vi.spyOn(server.stores.fsEntry, 'getEntryByPath').mockRejectedValue(
            new Error('profile read failed'),
        );
        await expect(getOwn(uuidv4())).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it('surfaces the account lookup failure before the profile read failure', async () => {
        vi.spyOn(server.stores.user, 'getByUuid').mockRejectedValue(
            new Error('account lookup failed'),
        );
        vi.spyOn(server.stores.fsEntry, 'getEntryByPath').mockRejectedValue(
            new Error('profile read failed'),
        );
        await expect(getOwn(uuidv4())).rejects.toThrow('account lookup failed');
    });

    it('surfaces a failed profile read for an existing account', async () => {
        const user = await makeUser();
        vi.spyOn(server.stores.fsEntry, 'getEntryByPath').mockRejectedValue(
            new Error('profile read failed'),
        );
        await expect(getOwn(user.uuid)).rejects.toThrow('profile read failed');
    });
});
