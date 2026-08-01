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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { SYSTEM_ACTOR_UUID } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import type { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import { MANAGE_PERM_PREFIX } from '../permission/consts.js';
import { ACLService, type ResourceDescriptor } from './ACLService.js';

// -- Test scaffolding -------------------------------------------------

const ISSUER_USER = { uuid: 'u-issuer', id: 1, username: 'issuer' };

/** Plain user actor — the entity that mints (and bounds) access tokens. */
const issuerActor: Actor = { user: ISSUER_USER };

/** A user-issued full-access ("personal access token") actor. */
function fullAccessTokenActor(): Actor {
    return {
        user: ISSUER_USER,
        accessToken: {
            uid: 'tok-full',
            issuer: issuerActor,
            authorized: null,
            fullAccess: true,
        },
    };
}

/** A scoped (non-full-access) access-token actor issued by the same user. */
function scopedTokenActor(): Actor {
    return {
        user: ISSUER_USER,
        accessToken: {
            uid: 'tok-scoped',
            issuer: issuerActor,
            authorized: null,
            fullAccess: false,
        },
    };
}

/**
 * Build a ResourceDescriptor whose ancestor chain is derived from the path
 * (resource first, down to the direct child of root) with deterministic uids.
 */
function resource(path: string): ResourceDescriptor {
    const parts = path.slice(1).split('/');
    const ancestors = parts.map((_, i) => {
        const p = '/' + parts.slice(0, parts.length - i).join('/');
        return { uid: `uid:${p}`, path: p };
    });
    return { path, resolveAncestors: async () => ancestors };
}

function makeService() {
    const stores = {
        permission: {
            // Default: token carries no explicit fs grant rows.
            hasAccessTokenPerm: vi.fn().mockResolvedValue(false),
        },
        user: {
            getByUsername: vi.fn().mockResolvedValue(null),
        },
    };
    const services = {
        permission: {
            // Default: issuer holds no scanned (shared/granted) permission.
            scan: vi.fn().mockResolvedValue([]),
        },
    };
    const config = { enable_public_folders: false };
    const args = [
        config,
        {},
        stores,
        services,
    ] as unknown as ConstructorParameters<typeof ACLService>;
    const service = new ACLService(...args);
    return { service, stores, services };
}

// -- Full-access tokens ----------------------------------------------

describe('ACLService.check — full-access tokens', () => {
    it("grants write to the issuing user's own home dir", async () => {
        const { service, stores, services } = makeService();

        const allowed = await service.check(
            fullAccessTokenActor(),
            resource('/issuer/projects'),
            'write',
        );

        expect(allowed).toBe(true);
        // The grant comes from the fullAccess short-circuit (bounded by the
        // issuer check), NOT from per-token permission rows or a scan.
        expect(stores.permission.hasAccessTokenPerm).not.toHaveBeenCalled();
        expect(services.permission.scan).not.toHaveBeenCalled();
    });

    it('denies a path the issuing user cannot reach (no leak)', async () => {
        const { service } = makeService();

        // Another user's home: issuer has no home short-circuit and no
        // scanned permission (scan defaults to []), so the issuer check at
        // the top of the access-token branch fails and the token is denied.
        const allowed = await service.check(
            fullAccessTokenActor(),
            resource('/victim/secrets'),
            'write',
        );

        expect(allowed).toBe(false);
    });

    it('inherits a path explicitly shared with the issuing user', async () => {
        const { service, services } = makeService();
        // Issuer holds a scanned grant on the shared resource.
        services.permission.scan.mockResolvedValue([{ $: 'option', key: 'k' }]);

        const allowed = await service.check(
            fullAccessTokenActor(),
            resource('/other/Shared'),
            'write',
        );

        expect(allowed).toBe(true);
    });

    it('cannot exceed the issuer: denied even with a token perm row when the issuer lacks access', async () => {
        const { service, stores } = makeService();
        // Even if the token row claims the grant, the issuer gate runs first.
        stores.permission.hasAccessTokenPerm.mockResolvedValue(true);

        const allowed = await service.check(
            fullAccessTokenActor(),
            resource('/victim/secrets'),
            'write',
        );

        expect(allowed).toBe(false);
    });
});

// -- Scoped tokens are unaffected by the full-access change ------------

describe('ACLService.check — scoped tokens (regression)', () => {
    it("denies the issuer's own home without an explicit token grant", async () => {
        const { service, stores } = makeService();

        // Issuer passes its own home short-circuit, but a scoped token must
        // still carry an explicit fs permission row — it does not inherit
        // the owner short-circuit the way a full-access token does.
        const allowed = await service.check(
            scopedTokenActor(),
            resource('/issuer/projects'),
            'write',
        );

        expect(allowed).toBe(false);
        expect(stores.permission.hasAccessTokenPerm).toHaveBeenCalled();
    });

    it('grants when the token carries an explicit fs permission row', async () => {
        const { service, stores } = makeService();
        stores.permission.hasAccessTokenPerm.mockResolvedValue(true);

        const allowed = await service.check(
            scopedTokenActor(),
            resource('/issuer/projects'),
            'write',
        );

        expect(allowed).toBe(true);
    });
});

// -- System actor ------------------------------------------------------

describe('ACLService.check — system actor', () => {
    it('is allowed everything, without consulting the stores', async () => {
        const { service, stores, services } = makeService();
        const allowed = await service.check(
            {
                user: { uuid: SYSTEM_ACTOR_UUID, username: 'system' },
                system: true,
            },
            resource('/victim/secrets'),
            'write',
        );
        expect(allowed).toBe(true);
        expect(stores.permission.hasAccessTokenPerm).not.toHaveBeenCalled();
        expect(services.permission.scan).not.toHaveBeenCalled();
    });
});

// -- Root ---------------------------------------------------------------

describe('ACLService.check — root', () => {
    it.each(['see', 'list', 'read'] as const)(
        'allows %s on root for any user',
        async (mode) => {
            const { service } = makeService();
            expect(await service.check(issuerActor, resource('/'), mode)).toBe(
                true,
            );
        },
    );

    it('refuses write and manage on root', async () => {
        const { service } = makeService();
        expect(await service.check(issuerActor, resource('/'), 'write')).toBe(
            false,
        );
        expect(
            await service.check(issuerActor, resource('/'), MANAGE_PERM_PREFIX),
        ).toBe(false);
    });
});

// -- Owner short-circuit ------------------------------------------------

describe('ACLService.check — the owner of a home directory', () => {
    it('allows the home directory itself and anything beneath it', async () => {
        const { service, services } = makeService();
        expect(
            await service.check(issuerActor, resource('/issuer'), 'write'),
        ).toBe(true);
        expect(
            await service.check(
                issuerActor,
                resource('/issuer/a/b/c'),
                MANAGE_PERM_PREFIX,
            ),
        ).toBe(true);
        expect(services.permission.scan).not.toHaveBeenCalled();
    });

    it('does not extend to a sibling whose name merely shares the prefix', async () => {
        const { service } = makeService();
        // `/issuer2` starts with `/issuer` as a *string* but is a different
        // user's home — the check must compare path segments, not prefixes.
        expect(
            await service.check(issuerActor, resource('/issuer2'), 'read'),
        ).toBe(false);
    });

    it("falls through to the permission scan for another user's tree", async () => {
        const { service, services } = makeService();
        expect(
            await service.check(issuerActor, resource('/victim/x'), 'read'),
        ).toBe(false);
        expect(services.permission.scan).toHaveBeenCalled();
    });
});

// -- App actors ---------------------------------------------------------

const appActor = (username: string, appUid = 'app-1'): Actor => ({
    user: { uuid: `u-${username}`, id: 9, username },
    app: { uid: appUid, id: 9 },
});

describe('ACLService.check — app-under-user', () => {
    it('reaches its own AppData directory under its own user without a grant', async () => {
        const { service, services } = makeService();
        const actor = appActor('issuer');
        expect(
            await service.check(
                actor,
                resource('/issuer/AppData/app-1/state.json'),
                'write',
            ),
        ).toBe(true);
        expect(services.permission.scan).not.toHaveBeenCalled();
    });

    it("cannot reach a different app's AppData under the same user", async () => {
        const { service } = makeService();
        expect(
            await service.check(
                appActor('issuer'),
                resource('/issuer/AppData/app-2/state.json'),
                'read',
            ),
        ).toBe(false);
    });

    it('is bounded by its user: denied wherever the user has no access', async () => {
        const { service, services } = makeService();
        // Underlying user has nothing on /victim, so the app can't either.
        expect(
            await service.check(
                appActor('issuer'),
                resource('/victim/AppData/app-1/x'),
                'read',
            ),
        ).toBe(false);
        expect(services.permission.scan).toHaveBeenCalled();
    });

    it('reaches its AppData under another user once that user has access', async () => {
        const { service, services } = makeService();
        // The user-level check passes (the directory was shared), which is
        // exactly the condition the shared-appdata rule keys on.
        services.permission.scan.mockResolvedValue([{ $: 'option', key: 'k' }]);
        expect(
            await service.check(
                appActor('issuer'),
                resource('/other/AppData/app-1/x'),
                'write',
            ),
        ).toBe(true);
    });

    it('inherits a plain shared folder from its user (not the appdata rule)', async () => {
        const { service, services } = makeService();
        services.permission.scan.mockResolvedValue([{ $: 'option', key: 'k' }]);
        expect(
            await service.check(
                appActor('issuer'),
                resource('/other/Shared/doc.txt'),
                'read',
            ),
        ).toBe(true);
    });

    it("does not get its user's home short-circuit", async () => {
        const { service, services } = makeService();
        // The app's user owns /issuer, so the recursive user check passes,
        // but the app itself still needs a scanned grant outside AppData.
        expect(
            await service.check(
                appActor('issuer'),
                resource('/issuer/Documents/notes.txt'),
                'read',
            ),
        ).toBe(false);
        expect(services.permission.scan).toHaveBeenCalled();
    });
});

// -- Public folders -----------------------------------------------------

describe('ACLService.check — public folders', () => {
    const publicService = () => {
        const made = makeService();
        (
            made.service as unknown as {
                config: { enable_public_folders: boolean };
            }
        ).config.enable_public_folders = true;
        return made;
    };

    it('opens /<user>/Public to a stranger when the owner confirmed their email', async () => {
        const { service, stores } = publicService();
        stores.user.getByUsername.mockResolvedValue({
            username: 'owner',
            email_confirmed: true,
        });
        expect(
            await service.check(
                issuerActor,
                resource('/owner/Public/index.html'),
                'read',
            ),
        ).toBe(true);
    });

    it('opens it for the admin account even without a confirmed email', async () => {
        const { service, stores } = publicService();
        stores.user.getByUsername.mockResolvedValue({
            username: 'admin',
            email_confirmed: false,
        });
        expect(
            await service.check(
                issuerActor,
                resource('/admin/Public/index.html'),
                'list',
            ),
        ).toBe(true);
    });

    it('stays closed when the owner never confirmed their email', async () => {
        const { service, stores } = publicService();
        stores.user.getByUsername.mockResolvedValue({
            username: 'owner',
            email_confirmed: false,
        });
        expect(
            await service.check(
                issuerActor,
                resource('/owner/Public/index.html'),
                'read',
            ),
        ).toBe(false);
    });

    it('stays closed when the owner does not exist', async () => {
        const { service, stores } = publicService();
        stores.user.getByUsername.mockResolvedValue(null);
        expect(
            await service.check(
                issuerActor,
                resource('/ghost/Public/index.html'),
                'see',
            ),
        ).toBe(false);
    });

    it('never opens a public folder for writes', async () => {
        const { service, stores } = publicService();
        stores.user.getByUsername.mockResolvedValue({
            username: 'owner',
            email_confirmed: true,
        });
        expect(
            await service.check(
                issuerActor,
                resource('/owner/Public/index.html'),
                'write',
            ),
        ).toBe(false);
    });

    it('does not apply to a non-Public folder or to the home root itself', async () => {
        const { service, stores } = publicService();
        stores.user.getByUsername.mockResolvedValue({
            username: 'owner',
            email_confirmed: true,
        });
        expect(
            await service.check(
                issuerActor,
                resource('/owner/Private/secret'),
                'read',
            ),
        ).toBe(false);
        expect(
            await service.check(issuerActor, resource('/owner'), 'read'),
        ).toBe(false);
    });

    it('stays closed when the feature flag is off', async () => {
        const { service, stores } = makeService();
        stores.user.getByUsername.mockResolvedValue({
            username: 'owner',
            email_confirmed: true,
        });
        expect(
            await service.check(
                issuerActor,
                resource('/owner/Public/index.html'),
                'read',
            ),
        ).toBe(false);
        expect(stores.user.getByUsername).not.toHaveBeenCalled();
    });
});

// -- Mode widening ------------------------------------------------------

describe('ACLService.check — stronger modes imply weaker ones', () => {
    it('accepts a write grant for a read request', async () => {
        const { service, services } = makeService();
        services.permission.scan.mockImplementation(
            async (_actor: unknown, permissions: string[]) =>
                permissions.includes('fs:uid\\C/other/f:write')
                    ? [{ $: 'option', key: 'k' }]
                    : [],
        );
        expect(
            await service.check(issuerActor, resource('/other/f'), 'read'),
        ).toBe(true);
    });

    it('does not accept a read grant for a write request', async () => {
        const { service, services } = makeService();
        services.permission.scan.mockImplementation(
            async (_actor: unknown, permissions: string[]) =>
                permissions.includes('fs:uid\\C/other/f:read')
                    ? [{ $: 'option', key: 'k' }]
                    : [],
        );
        expect(
            await service.check(issuerActor, resource('/other/f'), 'write'),
        ).toBe(false);
    });

    it('scans the manage namespace only for a manage request', async () => {
        const { service, services } = makeService();
        await service.check(
            issuerActor,
            resource('/other/f'),
            MANAGE_PERM_PREFIX,
        );
        expect(services.permission.scan).toHaveBeenCalledWith(issuerActor, [
            'manage:fs:uid\\C/other/f',
        ]);
    });

    it('inherits access granted on an ancestor directory', async () => {
        const { service, services } = makeService();
        services.permission.scan.mockImplementation(
            async (_actor: unknown, permissions: string[]) =>
                permissions.includes('fs:uid\\C/other:read')
                    ? [{ $: 'option', key: 'k' }]
                    : [],
        );
        expect(
            await service.check(
                issuerActor,
                resource('/other/deep/file.txt'),
                'read',
            ),
        ).toBe(true);
    });

    it('exposes the mode hierarchy it enforces', () => {
        const { service } = makeService();
        expect(service.getHighestMode()).toBe('write');
        expect(service.higherModes('read')).toEqual(['read', 'write']);
        expect(service.higherModes(MANAGE_PERM_PREFIX)).toEqual([
            MANAGE_PERM_PREFIX,
        ]);
        // Unknown modes fall back to themselves rather than throwing.
        expect(service.higherModes('bogus' as never)).toEqual(['bogus']);
    });
});

// -- Scoped access tokens, manage mode ---------------------------------

describe('ACLService.check — scoped tokens and manage', () => {
    it('accepts a manage grant recorded against the token', async () => {
        const { service, stores } = makeService();
        stores.permission.hasAccessTokenPerm.mockImplementation(
            async (_uid: string, permission: string) =>
                permission === 'manage:fs:uid\\C/issuer/projects',
        );
        expect(
            await service.check(
                scopedTokenActor(),
                resource('/issuer/projects'),
                MANAGE_PERM_PREFIX,
            ),
        ).toBe(true);
    });

    it('accepts an ancestor grant recorded against the token', async () => {
        const { service, stores } = makeService();
        stores.permission.hasAccessTokenPerm.mockImplementation(
            async (_uid: string, permission: string) =>
                permission === 'fs:uid\\C/issuer:write',
        );
        expect(
            await service.check(
                scopedTokenActor(),
                resource('/issuer/projects/a.txt'),
                'read',
            ),
        ).toBe(true);
    });
});

// -- Safe error shaping -------------------------------------------------

describe('ACLService.getSafeAclError', () => {
    it('hides existence with a 404 when the actor cannot even see the resource', async () => {
        const { service } = makeService();
        await expect(
            service.getSafeAclError(
                issuerActor,
                resource('/victim/secret'),
                'write',
            ),
        ).resolves.toEqual({
            status: 404,
            message: 'Subject does not exist',
            fields: { code: 'subject_does_not_exist' },
        });
    });

    it('returns 403 when the actor can see it but not do the operation', async () => {
        const { service, services } = makeService();
        services.permission.scan.mockImplementation(
            async (_actor: unknown, permissions: string[]) =>
                permissions.includes('fs:uid\\C/victim/secret:see')
                    ? [{ $: 'option', key: 'k' }]
                    : [],
        );
        await expect(
            service.getSafeAclError(
                issuerActor,
                resource('/victim/secret'),
                'write',
            ),
        ).resolves.toEqual({
            status: 403,
            message: 'Forbidden',
            fields: { code: 'forbidden' },
        });
    });
});

// -- statUserUser / setUserUser against a real PermissionService --------

describe('ACLService.statUserUser / setUserUser (integration)', () => {
    let server: PuterServer;
    let acl: ACLService;

    beforeAll(async () => {
        server = await setupTestServer();
        acl = server.services.acl as unknown as ACLService;
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    const makeUser = async (): Promise<Actor> => {
        const username = `acl${Math.random().toString(36).slice(2, 10)}`;
        const created = await createTestUser(server, {
            username,
            password: 'acl-test-password',
        });
        const row = await server.stores.user.getByUsername(created.username);
        return {
            user: {
                id: row!.id,
                uuid: row!.uuid,
                username: row!.username,
                email: row!.email ?? null,
            },
        };
    };

    /**
     * A real provisioned folder in the issuer's home. Ownership is what makes
     * the issuer hold `manage:fs:<uuid>` through the fs is-owner implicator.
     */
    const ownedResource = async (
        issuer: Actor,
        folder = 'Documents',
    ): Promise<ResourceDescriptor & { uid: string }> => {
        const path = `/${issuer.user.username}/${folder}`;
        const home = `/${issuer.user.username}`;
        const entry = await server.stores.fsEntry.getEntryByPath(path);
        const homeEntry = await server.stores.fsEntry.getEntryByPath(home);
        const uid = String(entry!.uuid);
        return {
            path,
            uid,
            resolveAncestors: async () => [
                { uid, path },
                { uid: String(homeEntry!.uuid), path: home },
            ],
        };
    };

    it('refuses to stat or set with a non-user issuer or holder', async () => {
        const issuer = await makeUser();
        const holder = await makeUser();
        const asApp: Actor = { ...issuer, app: { uid: 'app-1', id: 1 } };
        const res = await ownedResource(issuer);

        await expect(
            acl.statUserUser(asApp, holder, res),
        ).rejects.toMatchObject({ statusCode: 403 });
        await expect(
            acl.statUserUser(
                issuer,
                { ...holder, app: { uid: 'a', id: 1 } },
                res,
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        await expect(
            acl.setUserUser(asApp, holder, res, 'read'),
        ).rejects.toMatchObject({ statusCode: 403 });
        await expect(
            acl.setUserUser(
                issuer,
                { ...holder, accessToken: { uid: 't', issuer: holder } },
                res,
                'read',
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('refuses a holder with no username', async () => {
        const issuer = await makeUser();
        await expect(
            acl.setUserUser(
                issuer,
                { user: { id: 999_999 } },
                await ownedResource(issuer),
                'read',
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('grants a mode, reports it back, and is a no-op the second time', async () => {
        const issuer = await makeUser();
        const holder = await makeUser();
        const res = await ownedResource(issuer);
        const uid = res.uid;

        expect(await acl.statUserUser(issuer, holder, res)).toEqual({});

        const wrote = await runWithContext({ actor: issuer }, () =>
            acl.setUserUser(issuer, holder, res, 'read'),
        );
        expect(wrote).toBe(true);

        expect(await acl.statUserUser(issuer, holder, res)).toEqual({
            [res.path]: [`fs:${uid}:read`],
        });
        // The holder can now actually read it.
        expect(await acl.check(holder, res, 'read')).toBe(true);
        expect(await acl.check(holder, res, 'write')).toBe(false);

        // Same mode again: nothing to write.
        expect(
            await runWithContext({ actor: issuer }, () =>
                acl.setUserUser(issuer, holder, res, 'read'),
            ),
        ).toBe(false);
    });

    it('upgrading to write revokes the superseded read grant', async () => {
        const issuer = await makeUser();
        const holder = await makeUser();
        const res = await ownedResource(issuer);
        const uid = res.uid;

        await runWithContext({ actor: issuer }, () =>
            acl.setUserUser(issuer, holder, res, 'read'),
        );
        expect(
            await runWithContext({ actor: issuer }, () =>
                acl.setUserUser(issuer, holder, res, 'write'),
            ),
        ).toBe(true);

        // One mode per node per issuer/holder — the read grant is gone.
        expect(await acl.statUserUser(issuer, holder, res)).toEqual({
            [res.path]: [`fs:${uid}:write`],
        });
        expect(await acl.check(holder, res, 'read')).toBe(true);
    });

    it('onlyIfHigher declines to downgrade an existing stronger grant', async () => {
        const issuer = await makeUser();
        const holder = await makeUser();
        const res = await ownedResource(issuer);
        const uid = res.uid;

        await runWithContext({ actor: issuer }, () =>
            acl.setUserUser(issuer, holder, res, 'write'),
        );
        expect(
            await runWithContext({ actor: issuer }, () =>
                acl.setUserUser(issuer, holder, res, 'read', {
                    onlyIfHigher: true,
                }),
            ),
        ).toBe(false);
        expect(await acl.statUserUser(issuer, holder, res)).toEqual({
            [res.path]: [`fs:${uid}:write`],
        });
    });

    it('onlyIfHigher treats an existing manage grant as covering every mode', async () => {
        const issuer = await makeUser();
        const holder = await makeUser();
        const res = await ownedResource(issuer);
        const uid = res.uid;

        await runWithContext({ actor: issuer }, () =>
            acl.setUserUser(issuer, holder, res, MANAGE_PERM_PREFIX),
        );
        expect(await acl.statUserUser(issuer, holder, res)).toEqual({
            [res.path]: [`manage:fs:${uid}`],
        });
        expect(
            await runWithContext({ actor: issuer }, () =>
                acl.setUserUser(issuer, holder, res, 'write', {
                    onlyIfHigher: true,
                }),
            ),
        ).toBe(false);
    });

    it('downgrading a manage share to read revokes the manage grant', async () => {
        const issuer = await makeUser();
        const holder = await makeUser();
        const res = await ownedResource(issuer);
        const uid = res.uid;

        await runWithContext({ actor: issuer }, () =>
            acl.setUserUser(issuer, holder, res, MANAGE_PERM_PREFIX),
        );
        expect(
            await runWithContext({ actor: issuer }, () =>
                acl.setUserUser(issuer, holder, res, 'read'),
            ),
        ).toBe(true);

        // Regression: the manage grant lives outside the `fs:<uid>` prefix,
        // so a stat that only looked there left it behind and the holder kept
        // the right to re-share after being downgraded to read.
        expect(await acl.statUserUser(issuer, holder, res)).toEqual({
            [res.path]: [`fs:${uid}:read`],
        });
        expect(await acl.check(holder, res, MANAGE_PERM_PREFIX)).toBe(false);
    });

    it('onlyIfHigher still writes when nothing comparable exists', async () => {
        const issuer = await makeUser();
        const holder = await makeUser();
        const res = await ownedResource(issuer);
        expect(
            await runWithContext({ actor: issuer }, () =>
                acl.setUserUser(issuer, holder, res, 'read', {
                    onlyIfHigher: true,
                }),
            ),
        ).toBe(true);
    });

    it('refuses a resource with no ancestor chain', async () => {
        const issuer = await makeUser();
        const holder = await makeUser();
        await expect(
            acl.setUserUser(
                issuer,
                holder,
                { path: '/nowhere', resolveAncestors: async () => [] },
                'read',
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses to grant on a node the issuer does not manage', async () => {
        const issuer = await makeUser();
        const other = await makeUser();
        const holder = await makeUser();
        // A node in someone else's home: the issuer holds no manage:fs:<uid>.
        const res = await ownedResource(other);
        await expect(
            runWithContext({ actor: issuer }, () =>
                acl.setUserUser(issuer, holder, res, 'read'),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});
