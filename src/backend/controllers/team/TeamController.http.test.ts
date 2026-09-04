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
        // The cap has its own suite; these tests need many teams.
        env = await setupPuterTestEnv({
            teams_enabled: true,
            max_teams_per_user: 100,
        } as IConfig);
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

    /** A team owned by `user`, with one provisioned member. */
    const makeTeam = async () => {
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

    it('creates a team and reports the caller as its owner', async () => {
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
        const { team } = await makeTeam();

        const res = await call(
            'GET',
            `/teams/${team.uid}`,
            env.users.other.token,
        );
        // 403 would confirm the team exists.
        expect(res.status).toBe(404);
    });

    it('refuses every administrative route to a member who is not the owner', async () => {
        const { team, memberUsername } = await makeTeam();
        // An activated seat: provisioning leaves the email unconfirmed, which
        // `requireVerified` rejects, so an unactivated one cannot call at all.
        const provisioned = await env.server.stores.user.getByUsername(
            memberUsername,
        );
        await env.server.stores.user.update(provisioned!.id, {
            email_confirmed: 1,
            requires_email_confirmation: 0,
            requires_password_change: 0,
        });
        const seat = await env.server.stores.user.getByUsername(memberUsername);
        const { token } = await env.server.services.auth.createSessionToken(
            seat!,
        );

        for (const [method, path] of [
            ['PUT', `/teams/${team.uid}`],
            ['DELETE', `/teams/${team.uid}`],
            ['POST', `/teams/${team.uid}/members`],
            ['GET', `/teams/${team.uid}/audit`],
        ] as const) {
            const res = await call(
                method,
                path,
                token,
                method === 'GET' ? undefined : { name: 'nope' },
            );
            expect(res.status, `${method} ${path}`).toBe(403);
        }

        // Still a member, so reads it is entitled to still work.
        const readable = await call('GET', `/teams/${team.uid}`, token);
        expect(readable.status).toBe(200);
    });

    // -- the org_owned guard ------------------------------------------

    it('refuses the team owner as the target of a member route', async () => {
        const { team } = await makeTeam();

        const res = await call(
            'POST',
            `/teams/${team.uid}/members/${env.users.user.username}/disable`,
            env.users.user.token,
        );
        expect(res.status).toBe(404);
    });

    it('lists members with org_owned distinguishing the owner', async () => {
        const { team, memberUsername } = await makeTeam();

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
        const { team } = await makeTeam();
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
        const { team } = await makeTeam();

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

    it('exposes the team audit to the team owner only', async () => {
        const { team } = await makeTeam();

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

    // -- sharing with a team -------------------------------------

    it('names the team it shared with instead of an empty recipient', async () => {
        const { team } = await makeTeam();
        const file = `/${env.users.user.username}/Documents/label-${Math.random()
            .toString(36)
            .slice(2, 8)}.txt`;
        const written = await call('POST', '/fs/write', env.users.user.token, {
            fileMetadata: { path: file, size: 3, contentType: 'text/plain' },
            fileContent: 'abc',
        });
        expect(written.status).toBe(200);

        const shared = await call('POST', '/share', env.users.user.token, {
            recipients: [{ team: team.uid }],
            items: [file],
            mode: 'read',
        });
        expect(shared.status).toBe(200);
        const body = (await shared.json()) as {
            results: { recipient: string; status: string }[];
        };

        expect(body.results[0].status).toBe('success');
        // Echoes the identifier the caller named; '' would leave a client with
        // nothing to render or to match its request against.
        expect(body.results[0].recipient).toBe(team.uid);
    });

    it('shares with two teams rather than collapsing them into one', async () => {
        const second = await call('POST', '/teams', env.users.user.token, {
            name: 'Second',
            handle: randomHandle(),
        });
        expect(second.status).toBe(200);
        const teamB = (await second.json()) as { uid: string };
        const { team: teamA } = await makeTeam();

        const file = `/${env.users.user.username}/Documents/two-${Math.random()
            .toString(36)
            .slice(2, 8)}.txt`;
        const written = await call('POST', '/fs/write', env.users.user.token, {
            fileMetadata: { path: file, size: 3, contentType: 'text/plain' },
            fileContent: 'abc',
        });
        const fileUid = ((await written.json()) as { fsEntry: { uid: string } })
            .fsEntry.uid;

        const shared = await call('POST', '/share', env.users.user.token, {
            recipients: [{ team: teamA.uid }, { team: teamB.uid }],
            items: [file],
            mode: 'read',
        });
        expect(shared.status).toBe(200);
        const body = (await shared.json()) as {
            results: { recipient: string; status: string }[];
        };

        expect(body.results).toHaveLength(2);
        expect(body.results.every((r) => r.status === 'success')).toBe(true);

        // The response shape alone proves nothing: `results` is built from the
        // request's pairs, so a collapsed pair still reports two successes with
        // the right labels. Only the shares that exist afterwards show it.
        const mine = await call(
            'GET',
            '/share/shared-by-me?limit=100',
            env.users.user.token,
        );
        expect(mine.status).toBe(200);
        const listing = (await mine.json()) as {
            items: { uid_entry?: string; holder_team?: { uid: string } }[];
        };
        const holders = listing.items
            .filter((i) => i.uid_entry === fileUid)
            .map((i) => i.holder_team?.uid)
            .filter(Boolean)
            .sort();
        expect(holders).toEqual([teamA.uid, teamB.uid].sort());
    });

    it('names the team by handle when the caller shared by handle', async () => {
        const handle = randomHandle();
        const res = await call('POST', '/teams', env.users.user.token, {
            name: 'Byhandle',
            handle,
        });
        expect(res.status).toBe(200);

        const file = `/${env.users.user.username}/Documents/handle-${Math.random()
            .toString(36)
            .slice(2, 8)}.txt`;
        await call('POST', '/fs/write', env.users.user.token, {
            fileMetadata: { path: file, size: 3, contentType: 'text/plain' },
            fileContent: 'abc',
        });

        const shared = await call('POST', '/share', env.users.user.token, {
            recipients: [{ teamHandle: handle }],
            items: [file],
            mode: 'read',
        });
        expect(shared.status).toBe(200);
        const body = (await shared.json()) as {
            results: { recipient: string }[];
        };
        expect(body.results[0].recipient).toBe(handle);
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
        // Real team: 200 with the flag on, so a 404 means no route.
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
                'not_the_team_owner',
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
            env.server.stores.team.getByHandle('no-such-team'),
        ).resolves.toBeNull();
    });
});
