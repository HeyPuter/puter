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
import { runWithContext } from '../../core/context.js';
import type { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import { appDataPermission } from '../permission/appDataScopes.js';
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

// -- app-data:<app_uid>:<store>:<op> -----------------------------------

describe('AppPermissionService — app-data cross-app permissions', () => {
    /**
     * A grantee app (the one asking — think a calendar) plus the target app
     * whose data it names (a contacts app), and an app-under-user actor for the
     * grantee. `targetOwner` defaults to the acting user, but the data
     * namespace belongs to the actor either way.
     */
    const makeGranteeAndTarget = async (
        owner: Actor,
        targetOwner: Actor = owner,
    ) => {
        const grantee = await makeApp(owner.user.id!);
        const target = await makeApp(targetOwner.user.id!);
        const granteeActor: Actor = {
            user: owner.user,
            app: { uid: grantee.uid, id: grantee.id },
        };
        return { grantee, target, granteeActor };
    };

    const grant = (owner: Actor, granteeAppUid: string, permission: string) =>
        runWithContext({ actor: owner }, () =>
            permissions.grantUserAppPermission(
                owner,
                granteeAppUid,
                permission,
            ),
        );

    it('lets a user act on any app-data namespace under their own account', async () => {
        const owner = await makeUser();
        const target = await makeApp(owner.user.id!);
        expect(
            await permissions.check(
                owner,
                appDataPermission(target.uid, 'kv', 'get'),
            ),
        ).toBe(true);
        expect(
            await permissions.check(
                owner,
                appDataPermission(target.uid, 'fs', 'read'),
            ),
        ).toBe(true);
    });

    it('gives an app no reach into another app by default', async () => {
        const owner = await makeUser();
        const { target, granteeActor } = await makeGranteeAndTarget(owner);
        expect(
            await permissions.check(
                granteeActor,
                appDataPermission(target.uid, 'kv', 'get'),
            ),
        ).toBe(false);
        expect(
            await permissions.check(
                granteeActor,
                appDataPermission(target.uid, 'fs', 'read'),
            ),
        ).toBe(false);
    });

    it('resolves an exact op grant through the issuing user', async () => {
        const owner = await makeUser();
        const { grantee, target, granteeActor } =
            await makeGranteeAndTarget(owner);
        await grant(
            owner,
            grantee.uid,
            appDataPermission(target.uid, 'kv', 'get'),
        );
        expect(
            await permissions.check(
                granteeActor,
                appDataPermission(target.uid, 'kv', 'get'),
            ),
        ).toBe(true);
    });

    it('treats a class grant as covering its ops and nothing wider', async () => {
        const owner = await makeUser();
        const { grantee, target, granteeActor } =
            await makeGranteeAndTarget(owner);
        await grant(
            owner,
            grantee.uid,
            appDataPermission(target.uid, 'kv', 'read'),
        );
        for (const op of ['get', 'list'] as const) {
            expect(
                await permissions.check(
                    granteeActor,
                    appDataPermission(target.uid, 'kv', op),
                ),
            ).toBe(true);
        }
        // A read class must not reach a mutating op, and must not reach a
        // delete either — `delete` is its own class.
        for (const op of ['set', 'incr', 'update', 'del'] as const) {
            expect(
                await permissions.check(
                    granteeActor,
                    appDataPermission(target.uid, 'kv', op),
                ),
            ).toBe(false);
        }
    });

    it('treats a write grant as covering the matching read', async () => {
        const owner = await makeUser();
        const { grantee, target, granteeActor } =
            await makeGranteeAndTarget(owner);
        await grant(
            owner,
            grantee.uid,
            appDataPermission(target.uid, 'kv', 'write'),
        );
        for (const op of ['set', 'get'] as const) {
            expect(
                await permissions.check(
                    granteeActor,
                    appDataPermission(target.uid, 'kv', op),
                ),
            ).toBe(true);
        }

        const second = await makeGranteeAndTarget(owner);
        await grant(
            owner,
            second.grantee.uid,
            appDataPermission(second.target.uid, 'fs', 'write'),
        );
        expect(
            await permissions.check(
                second.granteeActor,
                appDataPermission(second.target.uid, 'fs', 'read'),
            ),
        ).toBe(true);
    });

    it('honours store-level and app-level grants via prefix implication', async () => {
        const owner = await makeUser();
        const storeWide = await makeGranteeAndTarget(owner);
        await grant(
            owner,
            storeWide.grantee.uid,
            appDataPermission(storeWide.target.uid, 'kv'),
        );
        for (const op of ['get', 'set'] as const) {
            expect(
                await permissions.check(
                    storeWide.granteeActor,
                    appDataPermission(storeWide.target.uid, 'kv', op),
                ),
            ).toBe(true);
        }
        // Store-level for one store says nothing about the other.
        expect(
            await permissions.check(
                storeWide.granteeActor,
                appDataPermission(storeWide.target.uid, 'fs', 'read'),
            ),
        ).toBe(false);

        const appWide = await makeGranteeAndTarget(owner);
        await grant(
            owner,
            appWide.grantee.uid,
            appDataPermission(appWide.target.uid),
        );
        expect(
            await permissions.check(
                appWide.granteeActor,
                appDataPermission(appWide.target.uid, 'kv', 'get'),
            ),
        ).toBe(true);
        expect(
            await permissions.check(
                appWide.granteeActor,
                appDataPermission(appWide.target.uid, 'fs', 'write'),
            ),
        ).toBe(true);
    });

    it('does not let a grant naming one app satisfy another', async () => {
        const owner = await makeUser();
        const { grantee, target, granteeActor } =
            await makeGranteeAndTarget(owner);
        const unrelated = await makeApp(owner.user.id!);
        await grant(
            owner,
            grantee.uid,
            appDataPermission(target.uid, 'kv', 'get'),
        );
        expect(
            await permissions.check(
                granteeActor,
                appDataPermission(unrelated.uid, 'kv', 'get'),
            ),
        ).toBe(false);
    });

    it('resolves for a target app owned by another user', async () => {
        const owner = await makeUser();
        const stranger = await makeUser();
        const { grantee, target, granteeActor } = await makeGranteeAndTarget(
            owner,
            stranger,
        );
        // The KV namespace and AppData directory belong to the acting user,
        // so who wrote the target app is irrelevant.
        await grant(
            owner,
            grantee.uid,
            appDataPermission(target.uid, 'kv', 'get'),
        );
        expect(
            await permissions.check(
                granteeActor,
                appDataPermission(target.uid, 'kv', 'get'),
            ),
        ).toBe(true);
    });

    it('denies an access-token actor the implicit user hold', async () => {
        const owner = await makeUser();
        const target = await makeApp(owner.user.id!);
        const tokenActor: Actor = {
            user: owner.user,
            accessToken: { uid: 'tok-1', issuer: owner, fullAccess: false },
        };
        expect(
            await permissions.check(
                tokenActor,
                appDataPermission(target.uid, 'kv', 'get'),
            ),
        ).toBe(false);
    });

    it('has no `manage:` form, so it cannot be delegated without a prompt', async () => {
        const owner = await makeUser();
        const holder = await makeUser();
        const { grantee, target } = await makeGranteeAndTarget(owner);
        const permission = appDataPermission(target.uid, 'kv', 'get');

        expect(await permissions.canManagePermission(owner, permission)).toBe(
            false,
        );
        // A developer's any-user grant and a user-to-user grant both gate on
        // the manage form, so neither can hand out cross-app data access.
        await expect(
            runWithContext({ actor: owner }, () =>
                permissions.grantDevAppPermission(
                    owner,
                    grantee.uid,
                    permission,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
        await expect(
            runWithContext({ actor: owner }, () =>
                permissions.grantUserUserPermission(
                    owner,
                    holder.user.username!,
                    permission,
                ),
            ),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('ignores the bare namespace and lookalike prefixes', async () => {
        const owner = await makeUser();
        expect(await permissions.check(owner, 'app-data')).toBe(false);
        expect(await permissions.check(owner, 'app-database:x:read')).toBe(
            false,
        );
    });

    it('keeps delete orthogonal to write', async () => {
        const owner = await makeUser();
        const DELETE_OPS = ['del', 'remove', 'expire', 'expireAt'] as const;

        // A write grant must not reach any deletion, or "may add invites"
        // would silently mean "may remove anything".
        const w = await makeGranteeAndTarget(owner);
        await grant(
            owner,
            w.grantee.uid,
            appDataPermission(w.target.uid, 'kv', 'write'),
        );
        for (const op of DELETE_OPS) {
            expect(
                await permissions.check(
                    w.granteeActor,
                    appDataPermission(w.target.uid, 'kv', op),
                ),
            ).toBe(false);
        }

        // ...and a delete grant covers every deletion without conferring
        // write, so cancelling an entry doesn't imply rewriting the rest.
        const d = await makeGranteeAndTarget(owner);
        await grant(
            owner,
            d.grantee.uid,
            appDataPermission(d.target.uid, 'kv', 'delete'),
        );
        for (const op of DELETE_OPS) {
            expect(
                await permissions.check(
                    d.granteeActor,
                    appDataPermission(d.target.uid, 'kv', op),
                ),
            ).toBe(true);
        }
        expect(
            await permissions.check(
                d.granteeActor,
                appDataPermission(d.target.uid, 'kv', 'set'),
            ),
        ).toBe(false);
    });
});

// -- Withdrawing grants when the target app changes ---------------------

describe('AppPermissionService — cross-app grant withdrawal', () => {
    /**
     * Emit the same event `AppDriver` emits, since these tests exercise the
     * listener rather than the driver that triggers it.
     */
    const emitAppChanged = async (payload: {
        app_uid: string;
        action: string;
        app?: unknown;
        old_app?: unknown;
    }) => {
        // `emitAndWait`, not `emit`: the listener is async and a fire-and-forget
        // emit would race the assertions.
        await server.clients.event.emitAndWait('app.changed', payload, {});
    };

    const hasGrant = (
        owner: Actor,
        granteeAppId: number,
        permission: string,
    ) =>
        server.stores.permission.hasUserAppPerm(
            owner.user.id!,
            granteeAppId,
            permission,
        );

    const setupGrant = async (targetFields: Record<string, unknown> = {}) => {
        const owner = await makeUser();
        const grantee = await makeApp(owner.user.id!);
        const target = await makeApp(owner.user.id!, targetFields);
        const permission = appDataPermission(target.uid, 'kv', 'get');
        await runWithContext({ actor: owner }, () =>
            permissions.grantUserAppPermission(owner, grantee.uid, permission),
        );
        expect(await hasGrant(owner, grantee.id, permission)).toBe(true);
        return { owner, grantee, target, permission };
    };

    it('withdraws grants naming an app that was deleted', async () => {
        const { owner, grantee, target, permission } = await setupGrant();
        await emitAppChanged({ app_uid: target.uid, action: 'deleted' });
        expect(await hasGrant(owner, grantee.id, permission)).toBe(false);
    });

    it('withdraws grants when an origin bootstrap reuses a uid', async () => {
        // An origin-derived uid is regenerated verbatim, so a recreated app
        // must not inherit consent the user gave to its predecessor. Driven
        // directly by the auth controller rather than through `app.changed`,
        // because that path has to be able to refuse the token when the sweep
        // fails and `emitAndWait` swallows listener errors.
        const { owner, grantee, target, permission } = await setupGrant();
        await server.services.appPermission.withdrawAppDataGrants(
            target.uid,
            'uid reused by a new app',
        );
        expect(await hasGrant(owner, grantee.id, permission)).toBe(false);
    });

    it('propagates a sweep failure so the caller can refuse to proceed', async () => {
        // Swallowing this is what would let a recreated app come up with the
        // old grants still live.
        const { target } = await setupGrant();
        const spy = vi
            .spyOn(
                server.stores.permission,
                'deleteAppGrantsByPermissionPrefix',
            )
            .mockRejectedValue(new Error('db down'));
        const alarm = vi.spyOn(server.clients.alarm, 'create');
        try {
            await expect(
                server.services.appPermission.withdrawAppDataGrants(
                    target.uid,
                    'uid reused by a new app',
                ),
            ).rejects.toThrow('db down');
            expect(alarm).toHaveBeenCalledWith(
                expect.stringContaining('app_data_grant_withdrawal_failed'),
                expect.any(String),
                expect.objectContaining({ targetAppUid: target.uid }),
                'warning',
            );
        } finally {
            spy.mockRestore();
            alarm.mockRestore();
        }
    });

    it('keeps an app.changed sweep best-effort so a delete still succeeds', async () => {
        const { target } = await setupGrant();
        const spy = vi
            .spyOn(
                server.stores.permission,
                'deleteAppGrantsByPermissionPrefix',
            )
            .mockRejectedValue(new Error('db down'));
        try {
            // Deleting an app must not fail because the sweep did — the alarm
            // is what carries the failure, not an exception at the emit site.
            await expect(
                emitAppChanged({ app_uid: target.uid, action: 'deleted' }),
            ).resolves.not.toThrow();
        } finally {
            spy.mockRestore();
        }
    });

    it('does not sweep on an ordinary app creation', async () => {
        // `AppStore.create` mints a random uuid4, so a fresh app cannot hold a
        // uid a deleted one had. Scanning the grant tables here would be work
        // that can never find anything.
        const { owner, grantee, target, permission } = await setupGrant();
        await emitAppChanged({ app_uid: target.uid, action: 'created' });
        expect(await hasGrant(owner, grantee.id, permission)).toBe(true);
    });

    it('withdraws grants when the target stops sharing its data', async () => {
        const { owner, grantee, target, permission } = await setupGrant();
        await emitAppChanged({
            app_uid: target.uid,
            action: 'updated',
            old_app: { metadata: null },
            app: { metadata: { share_app_data: false } },
        });
        expect(await hasGrant(owner, grantee.id, permission)).toBe(false);
    });

    it('leaves grants alone on an unrelated update', async () => {
        const { owner, grantee, target, permission } = await setupGrant();
        await emitAppChanged({
            app_uid: target.uid,
            action: 'updated',
            old_app: { metadata: null },
            app: { metadata: { title: 'renamed' } },
        });
        expect(await hasGrant(owner, grantee.id, permission)).toBe(true);
    });

    it('withdraws every level of the namespace, and nothing outside it', async () => {
        const owner = await makeUser();
        const grantee = await makeApp(owner.user.id!);
        const target = await makeApp(owner.user.id!);
        const other = await makeApp(owner.user.id!);

        const doomed = [
            appDataPermission(target.uid),
            appDataPermission(target.uid, 'kv'),
            appDataPermission(target.uid, 'fs', 'read'),
        ];
        const survivors = [
            appDataPermission(other.uid, 'kv', 'get'),
            `fs:${uuidv4()}:read`,
        ];
        for (const permission of [...doomed, ...survivors]) {
            await runWithContext({ actor: owner }, () =>
                permissions.grantUserAppPermission(
                    owner,
                    grantee.uid,
                    permission,
                ),
            );
        }

        await emitAppChanged({ app_uid: target.uid, action: 'deleted' });

        for (const permission of doomed) {
            expect(await hasGrant(owner, grantee.id, permission)).toBe(false);
        }
        for (const permission of survivors) {
            expect(await hasGrant(owner, grantee.id, permission)).toBe(true);
        }
    });

    it('does not withdraw a grant for a uid that merely shares a prefix', async () => {
        const owner = await makeUser();
        const grantee = await makeApp(owner.user.id!);
        const target = await makeApp(owner.user.id!);
        // `<uid>` must not match `<uid>-extra`: the sweep anchors on a segment
        // boundary, not a bare string prefix.
        const lookalike = appDataPermission(`${target.uid}-extra`, 'kv', 'get');
        await runWithContext({ actor: owner }, () =>
            permissions.grantUserAppPermission(owner, grantee.uid, lookalike),
        );

        await emitAppChanged({ app_uid: target.uid, action: 'deleted' });
        expect(await hasGrant(owner, grantee.id, lookalike)).toBe(true);
    });

    it('makes the withdrawal effective immediately, not after the cache TTL', async () => {
        const { owner, grantee, target, permission } = await setupGrant();
        const granteeActor = {
            user: owner.user,
            app: { uid: grantee.uid, id: grantee.id },
        } as Actor;
        // Warm the scan cache with an allow.
        expect(await permissions.check(granteeActor, permission)).toBe(true);

        await emitAppChanged({ app_uid: target.uid, action: 'deleted' });
        expect(await permissions.check(granteeActor, permission)).toBe(false);
    });

    it('withdraws dev-app grants too', async () => {
        const owner = await makeUser();
        const grantee = await makeApp(owner.user.id!);
        const target = await makeApp(owner.user.id!);
        const permission = appDataPermission(target.uid, 'kv', 'get');
        // Dev-app grants gate on the manage form, which `app-data` has none of,
        // so write the row directly — the point here is the sweep, not the gate.
        await server.stores.permission.upsertDevAppPerm(
            owner.user.id!,
            grantee.id,
            permission,
            {},
        );

        await emitAppChanged({ app_uid: target.uid, action: 'deleted' });
        const rows = await server.stores.permission.readDevAppPerms(
            grantee.id,
            [permission],
        );
        expect(rows).toHaveLength(0);
    });
});
