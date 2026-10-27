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

import type { PuterServer } from './server.ts';
import { createTestUser, setupTestServer } from './testUtil.ts';

/**
 * Teams is optional, so core has to work when neither the service nor the store
 * is registered, which is how this test server boots.
 */
describe('core without a teams registration', () => {
    let server: PuterServer;

    const makeUser = async (): Promise<{ id: number; username: string }> => {
        const username = `nt_${Math.random().toString(36).slice(2, 10)}`;
        const created = (await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        })) as unknown as { id: number };
        return { id: created.id, username };
    };

    beforeAll(async () => {
        server = await setupTestServer({
            // Without this the allowlist check returns before asking Teams.
            teams_allowed_email_domains: ['test.local'],
        } as never);
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    it('has no teams in the registry', () => {
        expect(server.services.team).toBeUndefined();
        expect(server.stores.team).toBeUndefined();
    });

    it('refuses to boot when the config asks for teams', async () => {
        await expect(
            setupTestServer({ teams_enabled: true } as never),
        ).rejects.toThrow(/teams_enabled/);
    });

    it('deletes an account without asking what it was charged for', async () => {
        const user = await makeUser();
        await expect(
            server.services.userAccount.cascadeDelete(user.id),
        ).resolves.not.toThrow();
        expect(await server.stores.user.getById(user.id)).toBeFalsy();
    });

    it('answers the address-claim question signup asks', async () => {
        const user = await makeUser();
        const row = (await server.stores.user.getById(user.id))!;
        // Nothing is a seat, so the holder is returned as-is.
        await expect(
            server.services.signup.signupEmailHolder(row.email as string, {
                releaseSeat: true,
            }),
        ).resolves.toMatchObject({ id: user.id });
    });

    it('lists what is shared with an account, folding in no team shares', async () => {
        const user = await makeUser();
        await expect(
            server.services.share.listSharedWithMe({
                user: { id: user.id },
            } as never),
        ).resolves.toMatchObject({ items: [] });
    });

    it('refuses a share aimed at a team, rather than failing', async () => {
        // A real home directory, so the refusal is the recipient's and not
        // the entry's.
        const username = `nt_${Math.random().toString(36).slice(2, 10)}`;
        const creds = await createTestUser(server, {
            username,
            password: 'Nt-Pw-12345!',
        });
        const row = (await server.stores.user.getByUsername(username))!;
        const user = { id: row.id, username };
        const actor = { user: row } as never;
        expect(creds).toBeTruthy();
        // The recipient cannot exist, so this is a 404 and not a crash.
        await expect(
            server.services.share.share(actor, {
                recipient: { teamHandle: 'nobody' },
                mode: 'read',
                path: `/${user.username}`,
            } as never),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('serves the homepage shell with the teams tab off', async () => {
        const user = await makeUser();
        const row = (await server.stores.user.getById(user.id))!;
        let html = '';
        const res = { send: (out: string) => (html = out) };
        await server.services.homepage.send(
            {
                req: { headers: {}, query: {}, get: () => undefined },
                res,
                actor: { user: row },
            } as never,
            { title: 'Puter' } as never,
            {} as never,
        );
        const params = JSON.parse(
            /gui\((\{.*?\})\);/s.exec(html)![1].replaceAll('\\u003c', '<'),
        );
        expect(params.teams_ui).toBe(false);
    });
});
