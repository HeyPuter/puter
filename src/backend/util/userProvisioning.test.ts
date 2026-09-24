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
import { PuterServer } from '../server.js';
import { setupTestServer } from '../testUtil.js';
import { generateDefaultFsentries } from './userProvisioning.js';

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
