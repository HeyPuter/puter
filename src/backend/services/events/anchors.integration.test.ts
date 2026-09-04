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
 * The ancestor walk against a real tree. `anchors.test.ts` covers the branches
 * with injected lookups; this pins the two things a stub can quietly get wrong
 * — the order `getAncestorChain` returns and where the climb stops.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import { resolveNode } from '../fs/resolveNode.js';
import { resolveFsAnchor, type FsAnchorDeps } from './anchors.js';
import { parseSubject } from './subjects.js';

const BOOT_TIMEOUT_MS = 120_000;

describe('resolveFsAnchor against a real tree', () => {
    let env: PuterTestEnv;
    let deps: FsAnchorDeps;
    let username: string;
    let homeUid: string;
    let reportsUid: string;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
        username = env.users.user.username;
        deps = {
            resolveNode: (ref) => resolveNode(env.server.stores.fsEntry, ref),
            getAncestorChain: (path) =>
                env.server.services.fs.getAncestorChain(path),
        };

        const user = await env.server.stores.user.getByUsername(username);
        const created = await env.server.services.fs.mkdir(user!.id, {
            path: `/${username}/Documents/reports`,
            createMissingParents: true,
        });
        reportsUid = created.uid;

        const home = await env.server.stores.fsEntry.getEntryByPath(
            `/${username}`,
        );
        homeUid = home!.uid;
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await env?.shutdown();
    });

    const resolve = (subject: string) =>
        resolveFsAnchor(parseSubject(subject), deps, { username }, subject);

    it('anchors on the deepest existing directory', async () => {
        await expect(
            resolve('fs:~/Documents/reports/2026/q1/summary.csv:add'),
        ).resolves.toMatchObject({
            uid: reportsUid,
            path: `/${username}/Documents/reports`,
            match: '2026/q1/summary.csv',
        });
    });

    it('anchors an existing directory on itself', async () => {
        await expect(resolve('fs:~/Documents/reports')).resolves.toMatchObject({
            uid: reportsUid,
            match: null,
        });
    });

    it('stops climbing at the home directory', async () => {
        await expect(resolve('fs:~/Nope/Deeper:add')).resolves.toMatchObject({
            uid: homeUid,
            path: `/${username}`,
            match: 'Nope/Deeper',
        });
    });
});
