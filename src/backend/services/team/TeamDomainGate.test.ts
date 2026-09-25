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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IConfig } from '../../types';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.ts';

describe('teams email-domain allowlist', () => {
    let env: PuterTestEnv;

    const makeUser = async (email: string) => {
        const username = `dg_${Math.random().toString(36).slice(2, 10)}`;
        const created = (await env.server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email,
            email_confirmed: true,
        })) as unknown as { id: number };
        const row = await env.server.stores.user.getById(created.id);
        const { token } = await env.server.services.auth.createSessionToken(
            row!,
        );
        return { id: created.id, username, token };
    };

    const call = (method: string, path: string, token: string, body?: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    const create = (token: string) =>
        call('POST', '/teams', token, {
            name: 'Gate',
            handle: `gt-${Math.random().toString(36).slice(2, 10)}`,
        });

    beforeAll(async () => {
        env = await setupPuterTestEnv({
            teams_enabled: true,
            teams_allowed_email_domains: ['puter.com'],
            max_teams_per_user: 10,
        } as IConfig);
    }, 180_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    it('lets an allowed domain create and list', async () => {
        const staff = await makeUser(`${uuidv4().slice(0, 8)}@puter.com`);
        expect((await create(staff.token)).status).toBe(200);
        expect((await call('GET', '/teams', staff.token)).status).toBe(200);
    });

    it('matches the domain case-insensitively', async () => {
        const staff = await makeUser(`${uuidv4().slice(0, 8)}@PUTER.COM`);
        expect((await create(staff.token)).status).toBe(200);
    });

    it('answers other domains with the same 404 as teams-off', async () => {
        const outsider = await makeUser(`${uuidv4().slice(0, 8)}@gmail.com`);
        expect((await create(outsider.token)).status).toBe(404);
        const list = await call('GET', '/teams', outsider.token);
        expect(list.status).toBe(404);
        // `not_found` is what the GUI reads as "feature not here".
        expect(((await list.json()) as { code?: string }).code).toBe(
            'not_found',
        );
    });

    it('lets a provisioned seat through on membership alone', async () => {
        const staff = await makeUser(`${uuidv4().slice(0, 8)}@puter.com`);
        const created = await create(staff.token);
        const team = (await created.json()) as { uid: string };

        const seatName = `sg_${Math.random().toString(36).slice(2, 10)}`;
        const provisioned = await call(
            'POST',
            `/teams/${team.uid}/members`,
            staff.token,
            { username: seatName, email: `${seatName}@gmail.com` },
        );
        expect(provisioned.status).toBe(200);

        // Off-domain, but someone allowed brought them in.
        const seatRow = await env.server.stores.user.getByUsername(seatName);
        await env.server.stores.user.update(seatRow!.id, {
            email_confirmed: 1,
            requires_email_confirmation: 0,
            requires_password_change: 0,
        });
        const { token } = await env.server.services.auth.createSessionToken(
            (await env.server.stores.user.getById(seatRow!.id))!,
        );
        const list = await call('GET', '/teams', token);
        expect(list.status).toBe(200);
        const body = (await list.json()) as { items: Array<{ uid: string }> };
        expect(body.items.map((t) => t.uid)).toContain(team.uid);
    });
});
