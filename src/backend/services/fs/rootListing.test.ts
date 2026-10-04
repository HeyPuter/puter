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
import { makeActor, type Actor } from '../../core/actor.js';
import { PuterServer } from '../../server.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import { setupTestServer } from '../../testUtil.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import { FULL_API_ACCESS } from '../permission/consts.js';
import type { PermissionService } from '../permission/PermissionService.js';
import { clientParentUid, listRootEntries } from './rootListing.js';

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
    listRootEntries(
        actor,
        fsEntryStore,
        server.services.acl,
        server.stores.permission,
    );

// The actor a request bearing a freshly minted access token resolves to.
const tokenActorFor = async (userId: number, permissions: string[]) => {
    const user = (await server.stores.user.getById(userId))!;
    const token = await server.services.auth.createAccessToken(
        makeActor({ user }),
        permissions.map((permission) => [permission]),
    );
    return (await server.services.auth.authenticateFromToken(token))!;
};

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

    it('leaves an issuer’s home out of root when only a file was shared', async () => {
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

        // Listing it here would advertise a folder readdir then refuses to
        // open: the grant is on Documents, which says nothing about its parent.
        expect(entries.map((entry) => entry.path)).toEqual([
            `/${holder.username}`,
        ]);
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

    it("does not fall back onto a foreign row holding the actor's home path", async () => {
        const userA = await makeUser();
        const userB = await makeUser();

        // Drift B's own root out of the way, then move A's root onto the path
        // B's healing attempt will target — the shape a freed-then-reclaimed
        // username leaves behind.
        const rootB = (await fsEntryStore.getRootEntryForUser(userB.userId))!;
        await server.clients.db.write(
            'UPDATE fsentries SET path = ?, name = ? WHERE id = ?',
            [
                `/b-drift-${Math.random().toString(36).slice(2, 8)}`,
                'b-drift',
                rootB.id,
            ],
        );
        const rootA = (await fsEntryStore.getRootEntryForUser(userA.userId))!;
        await server.clients.db.write(
            'UPDATE fsentries SET path = ?, name = ? WHERE id = ?',
            [`/${userB.username}`, userB.username, rootA.id],
        );
        await server.clients.redis.flushall?.();

        const entries = await listFor(userB.actor);

        // The heal throws (A holds the path); the path-based fallback must
        // not then hand B a listing of A's tree.
        expect(entries).toEqual([]);
    });

    it('leaves the home out for a token scoped below it, in one grant read', async () => {
        const user = await makeUser();
        const documents = (await fsEntryStore.getEntryByPath(
            `/${user.username}/Documents`,
        ))!;
        const actor = await tokenActorFor(user.userId, [
            `fs:${documents.uuid}:read`,
        ]);
        const hasAny = vi.spyOn(
            server.stores.permission,
            'hasAnyAccessTokenPerm',
        );
        const scan = vi.spyOn(permissionService, 'scan');

        try {
            await expect(listFor(actor)).resolves.toEqual([]);
            expect(hasAny).toHaveBeenCalledTimes(1);
            expect(scan).not.toHaveBeenCalled();
        } finally {
            hasAny.mockRestore();
            scan.mockRestore();
        }
    });

    it('shows the home to a token that can list it', async () => {
        const user = await makeUser();
        const home = (await fsEntryStore.getEntryByPath(`/${user.username}`))!;
        const actor = await tokenActorFor(user.userId, [
            `fs:${home.uuid}:list`,
        ]);

        const entries = await listFor(actor);

        expect(entries.map((entry) => entry.path)).toEqual([
            `/${user.username}`,
        ]);
    });

    it('reads no token grants for a session or a full-access token', async () => {
        const user = await makeUser();
        const row = (await server.stores.user.getById(user.userId))!;
        const session = makeActor({ user: row });
        const fullAccess = await tokenActorFor(user.userId, [FULL_API_ACCESS]);
        const hasAny = vi.spyOn(
            server.stores.permission,
            'hasAnyAccessTokenPerm',
        );

        try {
            for (const actor of [session, fullAccess]) {
                const entries = await listFor(actor);
                expect(entries.map((entry) => entry.path)).toEqual([
                    `/${user.username}`,
                ]);
            }
            expect(hasAny).not.toHaveBeenCalled();
        } finally {
            hasAny.mockRestore();
        }
    });

    it('shows the home to an app session', async () => {
        const user = await makeUser();
        const row = (await server.stores.user.getById(user.userId))!;
        const actor = makeActor({ user: row, app: { uid: `app-${uuidv4()}` } });

        const entries = await listFor(actor);

        expect(entries.map((entry) => entry.path)).toEqual([
            `/${user.username}`,
        ]);
    });

    it('returns nothing for an actor with no user id or username', async () => {
        await expect(listFor({ user: {} })).resolves.toEqual([]);
        await expect(
            listFor({ user: { username: 'no-such-user' } as Actor['user'] }),
        ).resolves.toEqual([]);
    });
});

describe('clientParentUid', () => {
    const parentUidFor = (
        actor: Actor,
        entry: { path: string; parentUid: string | null },
    ) =>
        clientParentUid(
            actor,
            entry,
            server.services.acl,
            server.stores.permission,
        );

    it('nulls a home child’s parent for a token scoped below the home', async () => {
        const user = await makeUser();
        const documents = (await fsEntryStore.getEntryByPath(
            `/${user.username}/Documents`,
        ))!;
        const actor = await tokenActorFor(user.userId, [
            `fs:${documents.uuid}:read`,
        ]);

        await expect(parentUidFor(actor, documents)).resolves.toBeNull();
    });

    it('keeps it for a token that can list the home', async () => {
        const user = await makeUser();
        const home = (await fsEntryStore.getEntryByPath(`/${user.username}`))!;
        const documents = (await fsEntryStore.getEntryByPath(
            `/${user.username}/Documents`,
        ))!;
        const actor = await tokenActorFor(user.userId, [
            `fs:${home.uuid}:list`,
        ]);

        await expect(parentUidFor(actor, documents)).resolves.toBe(home.uuid);
    });

    it('keeps it for a session or a full-access token', async () => {
        const user = await makeUser();
        const documents = (await fsEntryStore.getEntryByPath(
            `/${user.username}/Documents`,
        ))!;
        const fullAccess = await tokenActorFor(user.userId, [FULL_API_ACCESS]);

        for (const actor of [user.actor, fullAccess]) {
            await expect(parentUidFor(actor, documents)).resolves.toBe(
                documents.parentUid,
            );
        }
    });

    it('does not look up permissions for an entry that is not a direct home child', async () => {
        const user = await makeUser();
        const documents = (await fsEntryStore.getEntryByPath(
            `/${user.username}/Documents`,
        ))!;
        const nested = {
            path: `/${user.username}/Documents/nested`,
            parentUid: documents.uuid,
        };
        const actor = await tokenActorFor(user.userId, [
            `fs:${documents.uuid}:read`,
        ]);
        const hasAny = vi.spyOn(
            server.stores.permission,
            'hasAnyAccessTokenPerm',
        );

        try {
            await expect(parentUidFor(actor, nested)).resolves.toBe(
                documents.uuid,
            );
            expect(hasAny).not.toHaveBeenCalled();
        } finally {
            hasAny.mockRestore();
        }
    });
});
