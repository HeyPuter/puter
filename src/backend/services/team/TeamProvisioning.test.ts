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
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';
import { generateDefaultFsentries } from '../../util/userProvisioning.ts';

describe('team account provisioning: home path conflicts', () => {
    let server: PuterServer;
    let service: PuterServer['services']['team'];

    const makeUser = async () => {
        const username = `tp_${Math.random().toString(36).slice(2, 10)}`;
        const created = (await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        })) as unknown as { id: number; username: string };
        await generateDefaultFsentries(
            server.clients.db,
            server.stores.user,
            created as never,
        );
        return { id: created.id, username };
    };

    const freeHandle = () => `tp-${Math.random().toString(36).slice(2, 10)}`;

    const makeTeam = (ownerId: number) =>
        service.createTeam(ownerId, {
            name: 'Provisioned Co',
            handle: freeHandle(),
        });

    beforeAll(async () => {
        server = await setupTestServer({ teams_enabled: true } as never);
        service = server.services.team;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('refuses a name that is free in the users table but whose home path is occupied', async () => {
        const owner = await makeUser();
        const team = await makeTeam(owner.id);

        // Nothing sits at `/parked` itself — only a leftover child row does,
        // the shape a partial cascade or a user-scoped cleanup leaves behind.
        // (An exact occupant would hit the provisioning backstop instead,
        // after the user row was already inserted — this is the gap that
        // backstop can't cover.)
        const occupant = await makeUser();
        const parked = `tp_${Math.random().toString(36).slice(2, 10)}`;
        const occupantDocs = (await server.stores.fsEntry.getEntryByPath(
            `/${occupant.username}/Documents`,
        ))!;
        await server.clients.db.write(
            'UPDATE fsentries SET path = ? WHERE id = ?',
            [`/${parked}/Documents`, occupantDocs.id],
        );

        await expect(
            service.provisionAccount(team.uid, owner.id, {
                username: parked,
                email: `${parked}@test.local`,
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            legacyCode: 'username_already_in_use',
        });

        // Refused whole: no orphaned user row holding the name.
        await expect(
            server.stores.user.getByUsername(parked, { force: true }),
        ).resolves.toBeNull();
    });

    it('does not suggest a name whose home path is occupied', async () => {
        const owner = await makeUser();
        await makeTeam(owner.id);

        const base = `tps_${Math.random().toString(36).slice(2, 8)}`;
        const occupant = await makeUser();
        const occupantDocs = (await server.stores.fsEntry.getEntryByPath(
            `/${occupant.username}/Documents`,
        ))!;
        // The first suggestion `suggestUsernames` would try is `${base}1`.
        await server.clients.db.write(
            'UPDATE fsentries SET path = ? WHERE id = ?',
            [`/${base}1/Documents`, occupantDocs.id],
        );

        const suggestions = await service.suggestUsernames(base);

        expect(suggestions).not.toContain(`${base}1`);
        expect(suggestions.length).toBeGreaterThan(0);
    });
});
