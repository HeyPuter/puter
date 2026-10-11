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
import { configContainer } from '../exports.js';
import { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import { generateDefaultFsentries, provisionUser } from './userProvisioning.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

describe('generateDefaultFsentries', () => {
    it('throws and inserts nothing when the home path is already occupied', async () => {
        const username = `up_${Math.random().toString(36).slice(2, 10)}`;
        const occupant = await server.stores.user.create({
            username: `up_occ_${Math.random().toString(36).slice(2, 10)}`,
            uuid: uuidv4(),
            password: null,
            email: `occ-${username}@test.local`,
            requires_email_confirmation: false,
        });
        await generateDefaultFsentries(
            server.clients.db,
            server.stores.user,
            occupant,
        );
        const occupantRoot = await server.stores.fsEntry.getRootEntryForUser(
            occupant.id,
        );
        // Park the occupant's own root at the target name, standing in for
        // drift that predates the caller's own-name check.
        await server.clients.db.write(
            'UPDATE fsentries SET path = ?, name = ? WHERE id = ?',
            [`/${username}`, username, occupantRoot!.id],
        );

        const user = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            requires_email_confirmation: false,
        });

        await expect(
            generateDefaultFsentries(
                server.clients.db,
                server.stores.user,
                user,
            ),
        ).rejects.toMatchObject({ statusCode: 400 });

        const rows = (await server.clients.db.read(
            'SELECT COUNT(*) AS n FROM fsentries WHERE user_id = ?',
            [user.id],
        )) as Array<{ n: number | string }>;
        expect(Number(rows[0]!.n)).toBe(0);
    });
});

describe('provisionUser', () => {
    const deps = () => ({
        db: server.clients.db,
        userStore: server.stores.user,
        groupStore: server.stores.group,
    });
    const fields = (username: string) => ({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        requires_email_confirmation: false,
    });
    const groupMembers = async (groupUid: string) =>
        (
            (await server.clients.db.read(
                'SELECT u.username FROM jct_user_group j ' +
                    'JOIN `user` u ON u.id = j.user_id ' +
                    'JOIN `group` g ON g.id = j.group_id WHERE g.uid = ?',
                [groupUid],
            )) as Array<{ username: string }>
        ).map((r) => r.username);

    it('creates the row, joins the group and returns the row with its folders', async () => {
        const username = `pu_${Math.random().toString(36).slice(2, 10)}`;
        const group = configContainer.default_user_group as string;
        expect(group).toBeTruthy();

        const user = await provisionUser(deps(), fields(username), group);

        expect(user.username).toBe(username);
        expect(user.trash_uuid).toBeTruthy();
        expect(user.desktop_uuid).toBeTruthy();
        expect(await groupMembers(group)).toContain(username);
    });

    it('still returns the account when its home path is taken', async () => {
        const username = `pu_${Math.random().toString(36).slice(2, 10)}`;
        const occupant = await provisionUser(
            deps(),
            fields(`pu_occ_${Math.random().toString(36).slice(2, 10)}`),
            null,
        );
        const occupantRoot = await server.stores.fsEntry.getRootEntryForUser(
            occupant.id,
        );
        await server.clients.db.write(
            'UPDATE fsentries SET path = ?, name = ? WHERE id = ?',
            [`/${username}`, username, occupantRoot!.id],
        );

        const user = await provisionUser(deps(), fields(username), null);

        expect(user.username).toBe(username);
        expect(user.trash_uuid).toBeFalsy();
    });
});
