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
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import type { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import { PERMISSION_FOR_NOTHING_IN_PARTICULAR } from '../permission/consts.js';
import type { PermissionService } from '../permission/PermissionService.js';

let server: PuterServer;
let permissions: PermissionService;

const HOSTING_DOMAIN = 'site.puter.localhost';

beforeAll(async () => {
    server = await setupTestServer();
    permissions = server.services.permission as unknown as PermissionService;
}, 60_000);

afterAll(async () => {
    await server?.shutdown();
}, 60_000);

const makeUser = async (): Promise<Actor> => {
    const username = `apx${Math.random().toString(36).slice(2, 10)}`;
    const created = await createTestUser(server, {
        username,
        password: 'app-perm-password',
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

const makeApp = async (
    ownerUserId: number,
    fields: Record<string, unknown> = {},
): Promise<{ id: number; uid: string; name: string }> => {
    const name = `apx-${uuidv4()}`;
    const created = await (
        server.stores.app.create as unknown as (
            f: Record<string, unknown>,
            o: { ownerUserId: number },
        ) => Promise<{ id: number; uid: string; name: string }>
    )(
        {
            name,
            title: 'App perm test',
            index_url: `https://${name}.test/`,
            ...fields,
        },
        { ownerUserId },
    );
    return created;
};

// -- app:<name> → app:uid#<uid> ---------------------------------------

describe('AppPermissionService — app name rewriter', () => {
    it('rewrites a name specifier to the stable uid form', async () => {
        const owner = await makeUser();
        const app = await makeApp(owner.user.id!);
        expect(
            await permissions.rewritePermission(`app:${app.name}:read`),
        ).toBe(`app:uid#${app.uid}:read`);
    });

    it('leaves an already-uid specifier alone', async () => {
        const owner = await makeUser();
        const app = await makeApp(owner.user.id!);
        const already = `app:uid#${app.uid}:read`;
        expect(await permissions.rewritePermission(already)).toBe(already);
    });

    it('leaves an unknown app name alone rather than inventing a uid', async () => {
        const permission = `app:no-such-app-${uuidv4()}:read`;
        expect(await permissions.rewritePermission(permission)).toBe(
            permission,
        );
    });

    it('ignores permissions outside the app namespace and bare `app`', async () => {
        expect(await permissions.rewritePermission('fs:uid:read')).toBe(
            'fs:uid:read',
        );
        expect(await permissions.rewritePermission('app')).toBe('app');
    });
});

// -- app-is-owner ------------------------------------------------------

describe('AppPermissionService — app-is-owner implicator', () => {
    it('gives the owner both access and manage on their own app', async () => {
        const owner = await makeUser();
        const app = await makeApp(owner.user.id!);
        expect(await permissions.check(owner, `app:uid#${app.uid}:read`)).toBe(
            true,
        );
        expect(
            await permissions.check(owner, `manage:app:uid#${app.uid}:read`),
        ).toBe(true);
    });

    it('denies a different user', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const app = await makeApp(owner.user.id!);
        expect(
            await permissions.check(stranger, `app:uid#${app.uid}:read`),
        ).toBe(false);
    });

    it("denies an app-under-user actor even for its owner's app", async () => {
        const owner = await makeUser();
        const app = await makeApp(owner.user.id!);
        // An app must not inherit its owner's app-management reach.
        const appActor: Actor = {
            user: owner.user,
            app: { uid: app.uid, id: app.id },
        };
        expect(
            await permissions.check(appActor, `app:uid#${app.uid}:read`),
        ).toBe(false);
    });

    it('denies an access-token actor', async () => {
        const owner = await makeUser();
        const app = await makeApp(owner.user.id!);
        const tokenActor: Actor = {
            user: owner.user,
            accessToken: { uid: 'tok-1', issuer: owner, fullAccess: false },
        };
        expect(
            await permissions.check(tokenActor, `app:uid#${app.uid}:read`),
        ).toBe(false);
    });

    it('denies when the uid names no app, is empty, or is missing entirely', async () => {
        const owner = await makeUser();
        expect(
            await permissions.check(owner, `app:uid#no-such-${uuidv4()}:read`),
        ).toBe(false);
        expect(await permissions.check(owner, 'app:uid#:read')).toBe(false);
        expect(await permissions.check(owner, 'app')).toBe(false);
    });
});

// -- apps-of-user / subdomains-of-user ---------------------------------

describe('AppPermissionService — own-apps / own-subdomains implicator', () => {
    it('lets a user act on their own apps and subdomains namespaces', async () => {
        const user = await makeUser();
        expect(
            await permissions.check(
                user,
                `apps-of-user:${user.user.uuid}:read`,
            ),
        ).toBe(true);
        expect(
            await permissions.check(
                user,
                `subdomains-of-user:${user.user.uuid}:write`,
            ),
        ).toBe(true);
    });

    it('denies the same namespace scoped to somebody else', async () => {
        const user = await makeUser();
        const other = await makeUser();
        expect(
            await permissions.check(
                user,
                `apps-of-user:${other.user.uuid}:read`,
            ),
        ).toBe(false);
    });

    it("denies an app-under-user actor acting on its user's apps", async () => {
        const user = await makeUser();
        const app = await makeApp(user.user.id!);
        const appActor: Actor = {
            user: user.user,
            app: { uid: app.uid, id: app.id },
        };
        expect(
            await permissions.check(
                appActor,
                `apps-of-user:${user.user.uuid}:read`,
            ),
        ).toBe(false);
    });
});

// -- app-root-dir:<app_uid>:<mode> → fs:<uuid>:<mode> ------------------

describe('AppPermissionService — app-root-dir rewriter', () => {
    /** Provision an app whose index_url points at a hosted subdomain. */
    const makeHostedApp = async (
        owner: Actor,
        opts: { rootDir?: boolean; hostname?: string } = {},
    ) => {
        const sub = `apx${Math.random().toString(36).slice(2, 10)}`;
        const homeEntry = await server.stores.fsEntry.getEntryByPath(
            `/${owner.user.username}/Desktop`,
        );
        await server.stores.subdomain.create({
            userId: owner.user.id!,
            subdomain: sub,
            rootDirId:
                opts.rootDir === false ? null : (homeEntry!.id as number),
        });
        const app = await makeApp(owner.user.id!, {
            index_url:
                opts.hostname ?? `https://${sub}.${HOSTING_DOMAIN}/index.html`,
        });
        return { app, sub, entry: homeEntry! };
    };

    it('is inert during a scan — never resolves through the fs path', async () => {
        const owner = await makeUser();
        const { app } = await makeHostedApp(owner);
        // Outside a grant/revoke, the rewriter must yield the sentinel so
        // `check(actor, 'app-root-dir:…')` can't ride the fs permission path.
        expect(
            await permissions.rewritePermission(
                `app-root-dir:${app.uid}:write`,
            ),
        ).toBe(PERMISSION_FOR_NOTHING_IN_PARTICULAR);
        expect(
            await permissions.check(owner, `app-root-dir:${app.uid}:write`),
        ).toBe(false);
    });

    it('resolves to the hosted root directory when granting to an app', async () => {
        const owner = await makeUser();
        const { app, entry } = await makeHostedApp(owner);
        const target = await makeApp(owner.user.id!);

        await runWithContext({ actor: owner }, () =>
            permissions.grantUserAppPermission(
                owner,
                target.uid,
                `app-root-dir:${app.uid}:write`,
            ),
        );

        // The stored row names the real fs uuid, not the pseudo-permission.
        expect(
            await server.stores.permission.hasUserAppPerm(
                owner.user.id!,
                target.id,
                `fs:${entry.uuid}:write`,
            ),
        ).toBe(true);
    });

    it('revoke names the same row the grant wrote', async () => {
        const owner = await makeUser();
        const { app, entry } = await makeHostedApp(owner);
        const target = await makeApp(owner.user.id!);

        await runWithContext({ actor: owner }, () =>
            permissions.grantUserAppPermission(
                owner,
                target.uid,
                `app-root-dir:${app.uid}:write`,
            ),
        );
        await runWithContext({ actor: owner }, () =>
            permissions.revokeUserAppPermission(
                owner,
                target.uid,
                `app-root-dir:${app.uid}:write`,
            ),
        );

        expect(
            await server.stores.permission.hasUserAppPerm(
                owner.user.id!,
                target.id,
                `fs:${entry.uuid}:write`,
            ),
        ).toBe(false);
    });

    it('refuses to resolve an app the actor does not own', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const { app } = await makeHostedApp(owner);
        const target = await makeApp(stranger.user.id!);

        await expect(
            runWithContext({ actor: stranger }, () =>
                permissions.grantUserAppPermission(
                    stranger,
                    target.uid,
                    `app-root-dir:${app.uid}:write`,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('refuses an app-under-user actor outright', async () => {
        const owner = await makeUser();
        const { app } = await makeHostedApp(owner);
        const target = await makeApp(owner.user.id!);
        const appActor: Actor = {
            user: owner.user,
            app: { uid: target.uid, id: target.id },
        };
        await expect(
            runWithContext({ actor: appActor }, () =>
                permissions.grantUserAppPermission(
                    appActor,
                    target.uid,
                    `app-root-dir:${app.uid}:write`,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects a malformed app-root-dir permission', async () => {
        const owner = await makeUser();
        const target = await makeApp(owner.user.id!);
        await expect(
            runWithContext({ actor: owner }, () =>
                permissions.grantUserAppPermission(
                    owner,
                    target.uid,
                    'app-root-dir:only-two-parts',
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('404s when the referenced app does not exist', async () => {
        const owner = await makeUser();
        const target = await makeApp(owner.user.id!);
        await expect(
            runWithContext({ actor: owner }, () =>
                permissions.grantUserAppPermission(
                    owner,
                    target.uid,
                    `app-root-dir:app-${uuidv4()}:write`,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('404s when the app has no resolvable root directory', async () => {
        const owner = await makeUser();
        const target = await makeApp(owner.user.id!);
        // index_url on a host outside the hosting domain — nothing to resolve.
        const orphan = await makeApp(owner.user.id!, {
            index_url: 'https://example.com/index.html',
        });
        await expect(
            runWithContext({ actor: owner }, () =>
                permissions.grantUserAppPermission(
                    owner,
                    target.uid,
                    `app-root-dir:${orphan.uid}:write`,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('404s when the index_url is not a URL at all', async () => {
        const owner = await makeUser();
        const target = await makeApp(owner.user.id!);
        const broken = await makeApp(owner.user.id!, {
            index_url: 'not a url',
        });
        await expect(
            runWithContext({ actor: owner }, () =>
                permissions.grantUserAppPermission(
                    owner,
                    target.uid,
                    `app-root-dir:${broken.uid}:write`,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('404s when the hosted subdomain has no root directory', async () => {
        const owner = await makeUser();
        const { app } = await makeHostedApp(owner, { rootDir: false });
        const target = await makeApp(owner.user.id!);
        await expect(
            runWithContext({ actor: owner }, () =>
                permissions.grantUserAppPermission(
                    owner,
                    target.uid,
                    `app-root-dir:${app.uid}:write`,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
