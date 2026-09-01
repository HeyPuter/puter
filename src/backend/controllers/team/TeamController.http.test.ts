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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IConfig } from '../../types';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

const randomHandle = () => `ws-${Math.random().toString(36).slice(2, 10)}`;

describe('team endpoints over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv({ teams_enabled: true } as IConfig);
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const call = (
        method: string,
        path: string,
        token: string,
        body?: unknown,
    ) =>
        fetch(new URL(path, env.apiOrigin), {
            method,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    /** A workspace owned by `user`, with one provisioned member. */
    const makeWorkspace = async () => {
        const res = await call('POST', '/teams', env.users.user.token, {
            name: 'Acme',
            handle: randomHandle(),
        });
        // Unasserted, a broken create means tests run on `/teams/undefined`.
        expect(res.status).toBe(200);
        const team = (await res.json()) as { uid: string };
        expect(team.uid).toBeTruthy();

        const username = `http_${Math.random().toString(36).slice(2, 9)}`;
        const member = await call(
            'POST',
            `/teams/${team.uid}/members`,
            env.users.user.token,
            { username, email: `${username}@test.local` },
        );
        expect(member.status).toBe(200);
        return { team, memberUsername: username };
    };

    // -- the owner-account gate --------------------------------------

    it('creates a workspace and reports the caller as its owner', async () => {
        const res = await call('POST', '/teams', env.users.user.token, {
            name: 'Acme Design',
            handle: randomHandle(),
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ name: 'Acme Design', is_owner: true });
        expect(body.uid).toMatch(/^[0-9a-f-]{36}$/u);
        // `id` is internal and must not reach the wire.
        expect(body).not.toHaveProperty('id');
    });

    it('returns 404, not 403, to a non-member', async () => {
        const { team } = await makeWorkspace();

        const res = await call(
            'GET',
            `/teams/${team.uid}`,
            env.users.other.token,
        );
        // 403 would confirm the workspace exists.
        expect(res.status).toBe(404);
    });

    it('refuses every administrative route to a member who is not the owner', async () => {
        const { team } = await makeWorkspace();
        // Provisioned accounts have no password, so they cannot authenticate.
        const other = await env.server.stores.user.getByUsername(
            env.users.other.username,
        );
        await env.server.stores.team.addMember(team.uid, other!.id, {
            orgOwned: true,
        });

        for (const [method, path] of [
            ['PUT', `/teams/${team.uid}`],
            ['DELETE', `/teams/${team.uid}`],
            ['POST', `/teams/${team.uid}/members`],
            ['GET', `/teams/${team.uid}/audit`],
        ] as const) {
            const res = await call(
                method,
                path,
                env.users.other.token,
                method === 'GET' ? undefined : { name: 'nope' },
            );
            expect(res.status, `${method} ${path}`).toBe(403);
        }

        // Still a member, so reads it is entitled to still work.
        const readable = await call(
            'GET',
            `/teams/${team.uid}`,
            env.users.other.token,
        );
        expect(readable.status).toBe(200);
    });

    // -- the org_owned guard ------------------------------------------

    it('refuses the workspace owner as the target of a member route', async () => {
        const { team } = await makeWorkspace();

        const res = await call(
            'POST',
            `/teams/${team.uid}/members/${env.users.user.username}/disable`,
            env.users.user.token,
        );
        expect(res.status).toBe(404);
    });

    it('lists members with org_owned distinguishing the owner', async () => {
        const { team, memberUsername } = await makeWorkspace();

        const res = await call(
            'GET',
            `/teams/${team.uid}/members`,
            env.users.user.token,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            items: { username: string; org_owned: boolean }[];
        };
        const owner = body.items.find(
            (m) => m.username === env.users.user.username,
        );
        const member = body.items.find((m) => m.username === memberUsername);
        expect(owner?.org_owned).toBe(false);
        expect(member?.org_owned).toBe(true);
    });

    // -- provisioning over the wire -----------------------------------

    it('never returns the activation link to the administrator', async () => {
        const { team } = await makeWorkspace();
        const username = `secret_${Math.random().toString(36).slice(2, 9)}`;

        const res = await call(
            'POST',
            `/teams/${team.uid}/members`,
            env.users.user.token,
            { username, email: `${username}@test.local` },
        );

        expect(res.status).toBe(200);
        const raw = JSON.stringify(await res.json());
        // Emailed to the member; returning it would let an admin use it.
        expect(raw).not.toContain('set-new-password');
        expect(raw).not.toContain('token');
    });

    it('refuses a taken username and offers alternatives', async () => {
        const { team } = await makeWorkspace();

        const res = await call(
            'POST',
            `/teams/${team.uid}/members`,
            env.users.user.token,
            {
                username: env.users.other.username,
                email: 'taken@test.local',
            },
        );
        expect(res.status).toBe(409);
        const body = (await res.json()) as {
            suggestions?: string[];
            fields?: { suggestions?: string[] };
        };
        const suggestions = body.suggestions ?? body.fields?.suggestions ?? [];
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions).not.toContain(env.users.other.username);
    });

    // -- audit --------------------------------------------------------

    it('exposes the workspace audit to the workspace owner only', async () => {
        const { team } = await makeWorkspace();

        const mine = await call(
            'GET',
            `/teams/${team.uid}/audit`,
            env.users.user.token,
        );
        expect(mine.status).toBe(200);
        const body = (await mine.json()) as { items: { action: string }[] };
        expect(body.items.map((e) => e.action)).toContain('provision');

        const theirs = await call(
            'GET',
            `/teams/${team.uid}/audit`,
            env.users.other.token,
        );
        expect(theirs.status).toBe(404);
    });
});

describe('team endpoints with teams_enabled off', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv({ teams_enabled: false } as IConfig);
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    it('404s every team route, so no team code is reachable', async () => {
        // Real workspace: 200 with the flag on, so a 404 means no route.
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const team = await env.server.stores.team.create({
            ownerUserId: owner!.id,
            name: 'Unreachable',
            handle: `off-${Math.random().toString(36).slice(2, 8)}`,
        });
        await env.server.stores.team.addMember(team.uid, owner!.id, {
            orgOwned: false,
        });

        const paths: [string, string][] = [
            ['POST', '/teams'],
            ['GET', '/teams'],
            ['GET', `/teams/${team.uid}`],
            ['PUT', `/teams/${team.uid}`],
            ['DELETE', `/teams/${team.uid}`],
            ['GET', `/teams/${team.uid}/members`],
            ['POST', `/teams/${team.uid}/members`],
            ['GET', `/teams/${team.uid}/audit`],
            ['GET', `/teams/${team.uid}/audit/me`],
        ];

        for (const [method, path] of paths) {
            const res = await fetch(new URL(path, env.apiOrigin), {
                method,
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${env.users.user.token}`,
                },
                ...(method === 'POST' || method === 'PUT'
                    ? { body: JSON.stringify({ name: 'x' }) }
                    : {}),
            });
            expect(res.status, `${method} ${path}`).toBe(404);

            // Ours would carry a team legacyCode; the framework's does not.
            const body = await res.text();
            expect(body, `${method} ${path}`).not.toContain('team_not_found');
            expect(body, `${method} ${path}`).not.toContain(
                'not_the_workspace_owner',
            );
        }
    });

    it('registers no team routes at all with the flag off', async () => {
        // The controller exists and is constructed; only its routes are absent.
        const controller = env.server.controllers.team as unknown as {
            isEnabled?: () => boolean;
        };
        expect(controller).toBeTruthy();
        expect(controller.isEnabled?.()).toBe(false);
    });

    it('leaves the schema inert rather than absent', async () => {
        // The flag gates reachability, not DDL.
        await expect(
            env.server.stores.team.getByHandle('no-such-workspace'),
        ).resolves.toBeNull();
    });
});
