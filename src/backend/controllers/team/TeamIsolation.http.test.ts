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

/**
 * A workspace manages accounts and cannot read them. Nobody writes that grant
 * deliberately, but a new implicator or a widened actor would create it and no
 * other test would fail. Asserts outcomes, never that an implicator is absent.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeActor } from '../../core/actor.js';
import type { IConfig } from '../../types';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';

describe('a workspace cannot read its members data', () => {
    let env: PuterTestEnv;
    let teamUid: string;
    let memberUsername: string;
    let memberFile: string;
    let ownerFile: string;

    /** Written directly: these tests are about reading, not about writing. */
    const makeFile = async (username: string, label: string) => {
        const uid = crypto.randomUUID();
        const name = `${label}-${uid.slice(0, 8)}.txt`;
        const path = `/${username}/${name}`;
        const user = await env.server.stores.user.getByUsername(username);
        await env.server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) ' +
                'VALUES (?, ?, ?, ?, ?, ?)',
            [
                uid,
                name,
                path,
                user!.id,
                // `is_dir` is a real boolean on postgres.
                env.server.clients.db.booleanValue(false),
                Math.floor(Date.now() / 1000),
            ],
        );
        return path;
    };

    const stat = (path: string, token: string) =>
        fetch(new URL('/stat', env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ path }),
        });

    const readdir = (path: string, token: string) =>
        fetch(new URL('/readdir', env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ path }),
        });

    beforeAll(async () => {
        env = await setupPuterTestEnv({ teams_enabled: true } as IConfig);

        // A provisioned account cannot authenticate until it activates.
        const res = await fetch(new URL('/teams', env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${env.users.user.token}`,
            },
            body: JSON.stringify({ name: 'Isolation', handle: `iso-${Date.now()}` }),
        });
        teamUid = ((await res.json()) as { uid: string }).uid;

        memberUsername = env.users.other.username;
        const member = await env.server.stores.user.getByUsername(memberUsername);
        await env.server.stores.team.addMember(teamUid, member!.id, {
            orgOwned: true,
        });

        memberFile = await makeFile(memberUsername, 'member');
        ownerFile = await makeFile(env.users.user.username, 'owner');
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    // -- refused ------------------------------------------------------

    it('refuses the workspace owner a members file', async () => {
        const res = await stat(memberFile, env.users.user.token);
        // Administering, paying for, and reading an account are three things.
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('refuses the workspace owner a members home directory', async () => {
        const res = await readdir(`/${memberUsername}`, env.users.user.token);
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('refuses a full-access token no less than a session', async () => {
        // `#scanAccessToken` re-scans the issuer as a plain user actor.
        const res = await stat(memberFile, env.users.user.apiToken);
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('grants no workspace-wide reach through the team routes', async () => {
        // There is no route to a member's files or KV, and none should appear.
        for (const path of [
            `/teams/${teamUid}/files`,
            `/teams/${teamUid}/members/${memberUsername}/files`,
            `/teams/${teamUid}/kv`,
        ]) {
            const res = await fetch(new URL(path, env.apiOrigin), {
                headers: { authorization: `Bearer ${env.users.user.token}` },
            });
            expect(res.status, path).toBe(404);
        }
    });

    // -- allowed ------------------------------------------------------

    it('lets the workspace owner read its own files', async () => {
        const res = await stat(ownerFile, env.users.user.token);
        expect(res.status).toBe(200);
    });

    it('lets a member read their own files', async () => {
        const res = await stat(memberFile, env.users.other.token);
        expect(res.status).toBe(200);
    });

    it('lets an explicit grant through, as an ordinary share', async () => {
        const member = await env.server.stores.user.getByUsername(
            memberUsername,
        );
        const [entry] = (await env.server.clients.db.read(
            'SELECT `uuid` FROM `fsentries` WHERE `path` = ?',
            [memberFile],
        )) as { uuid: string }[];

        // Only the member's own grant changes, never workspace authority.
        const before = await stat(memberFile, env.users.user.token);
        expect(before.status).toBeGreaterThanOrEqual(400);

        await env.server.services.permission.grantUserUserPermission(
            makeActor({ user: member!, app: null, accessToken: null } as never),
            env.users.user.username,
            `fs:${entry.uuid}:read`,
        );

        const after = await stat(memberFile, env.users.user.token);
        expect(after.status).toBe(200);
    });

    it('disabling a member neither grants nor transfers their files', async () => {
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const member = await env.server.stores.user.getByUsername(
            memberUsername,
        );
        // A fresh file: the earlier test granted the owner read on `memberFile`.
        const untouched = await makeFile(memberUsername, 'untouched');

        await env.server.services.team.disableMember(
            teamUid,
            owner!.id,
            member!.id,
        );

        // The member loses access to their own files...
        const asMember = await stat(untouched, env.users.other.token);
        expect(asMember.status).toBeGreaterThanOrEqual(400);

        // ...and the workspace still does not gain it.
        const asOwner = await stat(untouched, env.users.user.token);
        expect(asOwner.status).toBeGreaterThanOrEqual(400);
    });
});
