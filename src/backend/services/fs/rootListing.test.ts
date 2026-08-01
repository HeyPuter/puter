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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { PermissionService } from '../permission/PermissionService.js';
import { listRootEntries } from './rootListing.js';

let server: PuterServer;
let fsEntryStore: FSEntryStore;
let permissionService: PermissionService;

beforeAll(async () => {
    server = await setupTestServer();
    fsEntryStore = server.stores.fsEntry as FSEntryStore;
    permissionService = server.services
        .permission as unknown as PermissionService;
});

afterAll(async () => {
    await server?.shutdown();
});

const makeUser = async () => {
    const username = `rl-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        requires_email_confirmation: false,
    });
    await generateDefaultFsentries(
        server.clients.db,
        server.stores.user,
        created,
    );
    const actor: Actor = {
        user: {
            id: created.id,
            uuid: created.uuid,
            username,
        } as Actor['user'],
    };
    return { userId: created.id, username, actor };
};

const listFor = (actor: Actor) =>
    listRootEntries(actor, fsEntryStore, permissionService);

describe('listRootEntries', () => {
    it('shows the actor their own home directory, exactly once', async () => {
        const user = await makeUser();

        const entries = await listFor(user.actor);

        expect(entries.map((entry) => entry.path)).toEqual([
            `/${user.username}`,
        ]);
    });

    it('does not show one user another user’s home by default', async () => {
        const user = await makeUser();
        const stranger = await makeUser();

        const entries = await listFor(user.actor);

        expect(entries.map((entry) => entry.path)).not.toContain(
            `/${stranger.username}`,
        );
    });

    it('adds the home of every user who has granted the actor a permission', async () => {
        const holder = await makeUser();
        const issuer = await makeUser();
        const shared = (await fsEntryStore.getEntryByPath(
            `/${issuer.username}/Documents`,
        ))!;
        await permissionService.grantUserUserPermission(
            issuer.actor,
            holder.username,
            `fs:${shared.uuid}:read`,
        );

        const entries = await listFor(holder.actor);

        expect(entries.map((entry) => entry.path).sort()).toEqual(
            [`/${holder.username}`, `/${issuer.username}`].sort(),
        );
    });

    it('heals a home row whose path drifted from the username', async () => {
        const user = await makeUser();
        await server.clients.db.write(
            'UPDATE fsentries SET path = ?, name = ? WHERE user_id = ? AND parent_uid IS NULL',
            ['/stale-name', 'stale-name', user.userId],
        );
        await server.clients.redis.flushall?.();

        const entries = await listFor(user.actor);

        expect(entries.map((entry) => entry.path)).toEqual([
            `/${user.username}`,
        ]);
    });

    it('falls back to the path lookup when healing throws', async () => {
        const user = await makeUser();
        const renameUserHome = vi
            .spyOn(fsEntryStore, 'renameUserHome')
            .mockRejectedValueOnce(new Error('database unavailable'));

        const entries = await listFor(user.actor);

        expect(entries.map((entry) => entry.path)).toEqual([
            `/${user.username}`,
        ]);
        renameUserHome.mockRestore();
    });

    it('returns nothing for an actor with no user id or username', async () => {
        await expect(listFor({ user: {} })).resolves.toEqual([]);
        await expect(
            listFor({ user: { username: 'no-such-user' } as Actor['user'] }),
        ).resolves.toEqual([]);
    });
});
