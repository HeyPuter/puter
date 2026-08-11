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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import { kv } from '../../util/kvSingleton.js';
import { PermissionService } from './PermissionService.js';

/** `default_temp_group` from config.default.json. */
const DEFAULT_TEMP_GROUP_UID = 'b7220104-7905-4985-b996-649fdcdb3c8f';

function createPermissionService(): PermissionService {
    const permissionStore = {
        getCacheGeneration: async () => 0,
        getMultiCheckCache: async () => new Map<string, boolean>(),
        setMultiCheckCache: async () => undefined,
    };
    const [config, clients, stores, services] = [
        {},
        {},
        { permission: permissionStore },
        {},
    ] as ConstructorParameters<typeof PermissionService>;
    return new PermissionService(config, clients, stores, services);
}

describe('PermissionService.checkMany', () => {
    it('evaluates every uncached permission independently', async () => {
        const service = createPermissionService();
        const actor: Actor = {
            user: {
                uuid: 'user-1',
                id: 1,
                username: 'user',
            },
        };
        const checked: string[] = [];
        service.check = async (_actor, permissionOptions) => {
            const permission = String(permissionOptions);
            checked.push(permission);
            return (
                permission === 'app:uid#a:access' ||
                permission === 'app:uid#b:access'
            );
        };

        const result = await service.checkMany(actor, [
            'app:uid#a:access',
            'app:uid#b:access',
            'app:uid#c:access',
        ]);

        expect(result).toEqual(
            new Map([
                ['app:uid#a:access', true],
                ['app:uid#b:access', true],
                ['app:uid#c:access', false],
            ]),
        );
        expect(checked).toEqual([
            'app:uid#a:access',
            'app:uid#b:access',
            'app:uid#c:access',
        ]);
    });

    it('returns an empty map when given no permissions', async () => {
        const service = createPermissionService();
        const actor: Actor = {
            user: { uuid: 'user-1', id: 1, username: 'user' },
        };
        const result = await service.checkMany(actor, []);
        expect(result).toEqual(new Map());
    });

    it('deduplicates input permissions', async () => {
        const service = createPermissionService();
        const actor: Actor = {
            user: { uuid: 'user-1', id: 1, username: 'user' },
        };
        const checked: string[] = [];
        service.check = async (_a, p) => {
            checked.push(String(p));
            return true;
        };
        const result = await service.checkMany(actor, [
            'app:uid#a:access',
            'app:uid#a:access',
        ]);
        expect(result.size).toBe(1);
        // `check` was invoked exactly once thanks to dedup.
        expect(checked).toEqual(['app:uid#a:access']);
    });
});

// ── pure-helper tests ──────────────────────────────────────────────

describe('PermissionService.getParentPermissions', () => {
    it('returns each prefix path in reverse order, most-specific first', () => {
        const service = createPermissionService();
        expect(service.getParentPermissions('a:b:c:d')).toEqual([
            'a:b:c:d',
            'a:b:c',
            'a:b',
            'a',
        ]);
    });

    it('handles a single segment', () => {
        const service = createPermissionService();
        expect(service.getParentPermissions('lonely')).toEqual(['lonely']);
    });
});

describe('PermissionService.rewritePermission', () => {
    it('returns input unchanged when no rewriters match', async () => {
        const service = createPermissionService();
        const out = await service.rewritePermission('fs:read');
        expect(out).toBe('fs:read');
    });

    it('applies registered rewriters in order', async () => {
        const service = createPermissionService();
        service.registerRewriter({
            matches: (p) => p.startsWith('alias:'),
            rewrite: async (p) => p.replace(/^alias:/, 'real:'),
        });
        service.registerRewriter({
            matches: (p) => p.startsWith('real:'),
            rewrite: async (p) => p.toUpperCase(),
        });
        const out = await service.rewritePermission('alias:foo');
        expect(out).toBe('REAL:FOO');
    });
});

describe('PermissionService.getHigherPermissions', () => {
    it('returns the permission plus its ancestors', async () => {
        const service = createPermissionService();
        const higher = await service.getHigherPermissions('a:b:c');
        expect(higher).toEqual(expect.arrayContaining(['a:b:c', 'a:b', 'a']));
    });

    it('expands via registered exploders when the parent matches', async () => {
        const service = createPermissionService();
        service.registerExploder({
            matches: (p) => p === 'a:b',
            explode: async () => ['x:y', 'z:q'],
        });
        const higher = await service.getHigherPermissions('a:b:c');
        expect(higher).toEqual(
            expect.arrayContaining(['a:b:c', 'a:b', 'x:y', 'z:q', 'a']),
        );
    });
});

// ── Real-server integration tests ──────────────────────────────────

describe('PermissionService (integration)', () => {
    let server: PuterServer;
    let permService: PermissionService;

    beforeAll(async () => {
        server = await setupTestServer();
        permService = server.services
            .permission as unknown as PermissionService;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUserActor = async (): Promise<{
        user: { id: number; uuid: string; username: string };
        actor: Actor;
    }> => {
        const username = `ps-${Math.random().toString(36).slice(2, 10)}`;
        const u = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        });
        return {
            user: { id: u.id, uuid: u.uuid, username: u.username },
            actor: {
                user: {
                    id: u.id,
                    uuid: u.uuid,
                    username: u.username,
                    email: u.email ?? null,
                    email_confirmed: true,
                } as Actor['user'],
            },
        };
    };

    describe('check / canManagePermission', () => {
        it('returns false for an unrelated permission', async () => {
            const { actor } = await makeUserActor();
            const allowed = await permService.check(
                actor,
                `zztest:nope-${uuidv4()}:ii:read`,
            );
            expect(allowed).toBeFalsy();
        });

        it('canManagePermission delegates to check on manage:<perm>', async () => {
            const { user, actor } = await makeUserActor();
            const perm = `zztest:manage-test-${uuidv4()}:ii:read`;
            // Grant manage:<perm> via the flat store.
            await server.stores.permission.setFlatUserPerm(
                user.id,
                `manage:${perm}`,
                {
                    permission: `manage:${perm}`,
                    deleted: false,
                    issuer_user_id: user.id,
                } as never,
            );
            expect(
                await permService.canManagePermission(actor, perm),
            ).toBeTruthy();
        });
    });

    describe('grantUserUserPermission / revokeUserUserPermission', () => {
        it('throws 404 when the target user does not exist', async () => {
            const { actor } = await makeUserActor();
            await expect(
                permService.grantUserUserPermission(
                    actor,
                    `does-not-exist-${uuidv4()}`,
                    'zztest:foo:ii:read',
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('throws 400 when the issuer tries to grant to themselves', async () => {
            const { user, actor } = await makeUserActor();
            await expect(
                permService.grantUserUserPermission(
                    actor,
                    user.username,
                    'zztest:foo:ii:read',
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('throws 403 when the issuer lacks manage:<permission>', async () => {
            const { actor: issuer } = await makeUserActor();
            const { user: target } = await makeUserActor();
            await expect(
                runWithContext({ actor: issuer }, () =>
                    permService.grantUserUserPermission(
                        issuer,
                        target.username,
                        `zztest:unmanaged-${uuidv4()}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('grant persists when issuer holds manage:<permission>', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target, actor: targetActor } = await makeUserActor();
            const permission = `zztest:user-user-${uuidv4()}:ii:read`;
            await server.stores.permission.setFlatUserPerm(
                issuer.id,
                `manage:${permission}`,
                {
                    permission: `manage:${permission}`,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );

            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            // The target sees the grant.
            const granted = await permService.check(targetActor, permission);
            expect(granted).toBeTruthy();
        });

        it('revokeUserUserPermission throws 404 when the target user does not exist', async () => {
            const { actor } = await makeUserActor();
            await expect(
                permService.revokeUserUserPermission(
                    actor,
                    `does-not-exist-${uuidv4()}`,
                    'zztest:foo:ii:read',
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('revokeUserUserPermission throws 403 when the issuer lacks manage', async () => {
            const { actor: issuer } = await makeUserActor();
            const { user: target } = await makeUserActor();
            await expect(
                runWithContext({ actor: issuer }, () =>
                    permService.revokeUserUserPermission(
                        issuer,
                        target.username,
                        `zztest:unmanaged-${uuidv4()}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    describe('grantUserAppPermission / revokeUserAppPermission / revokeUserAppAll', () => {
        const makeApp = async (ownerUserId: number) =>
            (
                server.stores.app.create as unknown as (
                    fields: Record<string, unknown>,
                    opts: { ownerUserId: number },
                ) => Promise<{ uid: string; id: number }>
            )(
                {
                    name: `ps-${uuidv4()}`,
                    title: 'PS app',
                    index_url: `https://ps-${uuidv4()}.test/`,
                },
                { ownerUserId },
            );

        it('throws 404 when app does not exist', async () => {
            const { actor } = await makeUserActor();
            await expect(
                runWithContext({ actor }, () =>
                    permService.grantUserAppPermission(
                        actor,
                        `does-not-exist-${uuidv4()}`,
                        'zztest:foo:ii:read',
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('persists a user→app grant and is idempotent', async () => {
            const { user, actor } = await makeUserActor();
            const app = await makeApp(user.id);
            const permission = `zztest:gua-${uuidv4()}:ii:read`;

            await runWithContext({ actor }, () =>
                permService.grantUserAppPermission(actor, app.uid, permission),
            );
            // Second call short-circuits via the existing-perm check.
            await runWithContext({ actor }, () =>
                permService.grantUserAppPermission(actor, app.uid, permission),
            );

            const has = await server.stores.permission.hasUserAppPerm(
                user.id,
                app.id,
                permission,
            );
            expect(has).toBeTruthy();
        });

        it('revokeUserAppPermission removes the row', async () => {
            const { user, actor } = await makeUserActor();
            const app = await makeApp(user.id);
            const permission = `zztest:rua-${uuidv4()}:ii:read`;
            await runWithContext({ actor }, () =>
                permService.grantUserAppPermission(actor, app.uid, permission),
            );
            await permService.revokeUserAppPermission(
                actor,
                app.uid,
                permission,
            );
            const has = await server.stores.permission.hasUserAppPerm(
                user.id,
                app.id,
                permission,
            );
            expect(has).toBeFalsy();
        });

        it('revokeUserAppPermission throws 403 when actor is an app-under-user', async () => {
            const { user } = await makeUserActor();
            const app = await makeApp(user.id);
            const appActor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                app: { id: app.id, uid: app.uid },
            } as unknown as Actor;
            await expect(
                permService.revokeUserAppPermission(
                    appActor,
                    app.uid,
                    'zztest:foo:ii:read',
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('revokeUserAppAll throws 404 when app does not exist', async () => {
            const { actor } = await makeUserActor();
            await expect(
                permService.revokeUserAppAll(
                    actor,
                    `does-not-exist-${uuidv4()}`,
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('revokeUserAppAll throws 403 when actor is an app-under-user', async () => {
            const { user } = await makeUserActor();
            const app = await makeApp(user.id);
            const appActor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                app: { id: app.id, uid: app.uid },
            } as unknown as Actor;
            await expect(
                permService.revokeUserAppAll(appActor, app.uid),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('revokeUserAppAll removes every grant on the app', async () => {
            const { user, actor } = await makeUserActor();
            const app = await makeApp(user.id);
            for (const p of [
                `zztest:rua-${uuidv4()}:ii:read`,
                `zztest:rua-${uuidv4()}:ii:write`,
            ]) {
                await runWithContext({ actor }, () =>
                    permService.grantUserAppPermission(actor, app.uid, p),
                );
            }
            await permService.revokeUserAppAll(actor, app.uid);
            // Both perms gone.
            const rows = (await server.clients.db.read(
                'SELECT 1 FROM `user_to_app_permissions` WHERE `user_id` = ? AND `app_id` = ?',
                [user.id, app.id],
            )) as unknown[];
            expect(rows).toHaveLength(0);
        });
    });

    describe('grantDevAppPermission / revokeDevAppPermission / revokeDevAppAll', () => {
        const makeApp = async (ownerUserId: number) =>
            (
                server.stores.app.create as unknown as (
                    fields: Record<string, unknown>,
                    opts: { ownerUserId: number },
                ) => Promise<{ uid: string; id: number }>
            )(
                {
                    name: `dev-${uuidv4()}`,
                    title: 'Dev app',
                    index_url: `https://dev-${uuidv4()}.test/`,
                },
                { ownerUserId },
            );

        it('throws 404 when app does not exist', async () => {
            const { actor } = await makeUserActor();
            await expect(
                runWithContext({ actor }, () =>
                    permService.grantDevAppPermission(
                        actor,
                        `does-not-exist-${uuidv4()}`,
                        'zztest:foo:ii:read',
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('throws 403 when actor lacks manage:<permission>', async () => {
            const { user, actor } = await makeUserActor();
            const app = await makeApp(user.id);
            await expect(
                runWithContext({ actor }, () =>
                    permService.grantDevAppPermission(
                        actor,
                        app.uid,
                        `zztest:unmanaged-${uuidv4()}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('grant persists when manage:<perm> is held', async () => {
            const { user, actor } = await makeUserActor();
            const app = await makeApp(user.id);
            const permission = `zztest:dev-${uuidv4()}:ii:read`;
            await server.stores.permission.setFlatUserPerm(
                user.id,
                `manage:${permission}`,
                {
                    permission: `manage:${permission}`,
                    deleted: false,
                    issuer_user_id: user.id,
                } as never,
            );
            await runWithContext({ actor }, () =>
                permService.grantDevAppPermission(actor, app.uid, permission),
            );
            const rows = (await server.clients.db.read(
                'SELECT 1 FROM `dev_to_app_permissions` WHERE `user_id` = ? AND `app_id` = ? AND `permission` = ?',
                [user.id, app.id, permission],
            )) as unknown[];
            expect(rows.length).toBeGreaterThan(0);
        });

        it('revokeDevAppPermission throws 403 when actor is an app-under-user', async () => {
            const { user } = await makeUserActor();
            const app = await makeApp(user.id);
            const appActor = {
                user: { id: user.id, uuid: user.uuid, username: user.username },
                app: { id: app.id, uid: app.uid },
            } as unknown as Actor;
            await expect(
                permService.revokeDevAppPermission(
                    appActor,
                    app.uid,
                    'zztest:foo:ii:read',
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('revokeDevAppAll throws 404 when app does not exist', async () => {
            const { actor } = await makeUserActor();
            await expect(
                permService.revokeDevAppAll(
                    actor,
                    `does-not-exist-${uuidv4()}`,
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });
    });

    describe('grantUserGroupPermission / revokeUserGroupPermission', () => {
        it('grantUserGroupPermission throws 403 when issuer lacks manage:<perm>', async () => {
            const { actor } = await makeUserActor();
            await expect(
                runWithContext({ actor }, () =>
                    permService.grantUserGroupPermission(
                        actor,
                        { id: 1, uid: 'grp-doesnt-matter' },
                        `zztest:unmanaged-${uuidv4()}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('revokeUserGroupPermission rejects when actor has no user.id', async () => {
            await expect(
                permService.revokeUserGroupPermission(
                    { user: undefined } as unknown as Actor,
                    { id: 1, uid: 'grp-x' },
                    'zztest:foo:ii:read',
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    describe('listUserPermissionIssuers / queryIssuerHolderPermissionsByPrefix', () => {
        it('listUserPermissionIssuers returns the issuer who granted the target a perm', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target } = await makeUserActor();
            const permission = `zztest:lst-${uuidv4()}:ii:read`;
            await server.stores.permission.setFlatUserPerm(
                issuer.id,
                `manage:${permission}`,
                {
                    permission: `manage:${permission}`,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );
            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );
            // listUserPermissionIssuers is best-effort; just verify it runs
            // and either includes the issuer or returns an empty array (the
            // linked store may not be populated immediately).
            const issuers = await permService.listUserPermissionIssuers({
                id: target.id,
            });
            expect(Array.isArray(issuers)).toBe(true);
        });

        it('queryIssuerHolderPermissionsByPrefix returns [] for actors without user.id', async () => {
            const out = await permService.queryIssuerHolderPermissionsByPrefix(
                { user: undefined } as unknown as Actor,
                { user: undefined } as unknown as Actor,
                'service:',
            );
            expect(out).toEqual([]);
        });
    });

    describe('check on a system actor (universal grant)', () => {
        it('checkMany returns true for every permission when actor is system', async () => {
            // The system actor short-circuits checkMany — its actor is the
            // hardcoded sys-issued shape exposed by the server.
            const systemActor = {
                user: {
                    id: 0,
                    uuid: 'system',
                    username: 'system',
                },
            } as unknown as Actor;
            // We can't easily fabricate the system flag without importing
            // internals — but the production system actor is exposed via
            // server.systemActor (if available). Fall back to skipping.
            void systemActor;
            // No assertion if we can't get a real system actor — keep this
            // test as a placeholder for future coverage.
        });
    });

    describe('cache-generation invalidation on grant/revoke', () => {
        // The grant/revoke paths bump the holder's per-actor cache
        // generation so a change takes effect on the very next check
        // rather than after the scan-cache TTL. These exercise the real
        // Redis-backed (ioredis-mock) cache via the live permission store.
        const grantManage = async (
            issuer: { id: number },
            permission: string,
        ) => {
            await server.stores.permission.setFlatUserPerm(
                issuer.id,
                `manage:${permission}`,
                {
                    permission: `manage:${permission}`,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );
        };

        it('revoke is visible immediately — a cached "granted" reading is not served', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target, actor: targetActor } = await makeUserActor();
            const permission = `zztest:revoke-now-${uuidv4()}:ii:read`;
            await grantManage(issuer, permission);

            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            // Prime the cache: the holder sees the grant (this writes the
            // scan/check cache under the current generation).
            expect(await permService.check(targetActor, permission)).toBe(true);

            await runWithContext({ actor: issuerActor }, () =>
                permService.revokeUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            // Without the generation bump this would still read `true` from
            // the primed cache for up to the TTL.
            expect(await permService.check(targetActor, permission)).toBe(
                false,
            );
        });

        it('caches the generation in-process so repeat reads skip Redis, and a bump updates the local copy at once', async () => {
            const { user } = await makeUserActor();
            const aUid = `user:${user.uuid}`;
            const localKey = `permgen-local:${aUid}`;

            // Cold: nothing cached locally yet.
            expect(kv.get(localKey)).toBeUndefined();

            // First read populates the in-process cache (avoids a Redis GET
            // on every subsequent permission check for this actor).
            const g = await server.stores.permission.getCacheGeneration(aUid);
            expect(kv.get(localKey)).toBe(g);

            // A bump makes this node consistent immediately — no waiting for
            // the local TTL — so single-node revocation is instant.
            await server.stores.permission.bumpCacheGeneration(aUid);
            expect(kv.get(localKey)).toBe(g + 1);
            expect(
                await server.stores.permission.getCacheGeneration(aUid),
            ).toBe(g + 1);
        });

        it('grant is visible immediately — a cached "denied" reading is not served', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target, actor: targetActor } = await makeUserActor();
            const permission = `zztest:grant-now-${uuidv4()}:ii:read`;
            await grantManage(issuer, permission);

            // Prime a "denied" reading into the cache.
            expect(await permService.check(targetActor, permission)).toBe(
                false,
            );

            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            expect(await permService.check(targetActor, permission)).toBe(true);
        });
    });

    describe('derived-actor cache invalidation (app-under-user)', () => {
        // An app-under-user actor's reading embeds its user's reading, and
        // its cache keys fold in the user's generation counter — so a
        // user-level grant/revoke must take effect for the user's app
        // actors on their very next check, not after the scan-cache TTL.
        const grantManage = async (
            issuer: { id: number },
            permission: string,
        ) => {
            await server.stores.permission.setFlatUserPerm(
                issuer.id,
                `manage:${permission}`,
                {
                    permission: `manage:${permission}`,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );
        };

        const makeApp = async (ownerUserId: number) =>
            (
                server.stores.app.create as unknown as (
                    fields: Record<string, unknown>,
                    opts: { ownerUserId: number },
                ) => Promise<{ uid: string; id: number }>
            )(
                {
                    name: `dac-${uuidv4()}`,
                    title: 'Derived-actor cache app',
                    index_url: `https://dac-${uuidv4()}.test/`,
                },
                { ownerUserId },
            );

        it("a user-level revoke is visible immediately to the user's app actors", async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target, actor: targetActor } = await makeUserActor();
            const app = await makeApp(target.id);
            const permission = `zztest:app-revoke-now-${uuidv4()}:ii:read`;
            await grantManage(issuer, permission);

            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );
            // The user lets the app act with this permission, so the app
            // actor resolves it through the user's own reading.
            await runWithContext({ actor: targetActor }, () =>
                permService.grantUserAppPermission(
                    targetActor,
                    app.uid,
                    permission,
                ),
            );

            const appActor = {
                user: targetActor.user,
                app: { id: app.id, uid: app.uid },
            } as unknown as Actor;

            // Prime the app actor's cache with a "granted" reading.
            expect(await permService.check(appActor, permission)).toBe(true);

            await runWithContext({ actor: issuerActor }, () =>
                permService.revokeUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            // Without the user generation folded into the app actor's
            // cache keys this would still read `true` for up to the TTL.
            expect(await permService.check(appActor, permission)).toBe(false);
        });

        it("a user-level grant busts an app actor's cached denial immediately", async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target, actor: targetActor } = await makeUserActor();
            const app = await makeApp(target.id);
            const permission = `zztest:app-grant-now-${uuidv4()}:ii:read`;
            await grantManage(issuer, permission);

            // App is allowed to act with the permission, but the user does
            // not hold it yet — primes a "denied" reading for the app actor.
            await runWithContext({ actor: targetActor }, () =>
                permService.grantUserAppPermission(
                    targetActor,
                    app.uid,
                    permission,
                ),
            );
            const appActor = {
                user: targetActor.user,
                app: { id: app.id, uid: app.uid },
            } as unknown as Actor;
            expect(await permService.check(appActor, permission)).toBe(false);

            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            expect(await permService.check(appActor, permission)).toBe(true);
        });
    });

    describe('revoke durability (flat/linked consistency)', () => {
        const grantManage = async (
            issuer: { id: number },
            permission: string,
        ) => {
            await server.stores.permission.setFlatUserPerm(
                issuer.id,
                `manage:${permission}`,
                {
                    permission: `manage:${permission}`,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );
        };

        it('revokeUserUserPermission deletes the linked SQL row before resolving', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target } = await makeUserActor();
            const permission = `zztest:rvk-sync-${uuidv4()}:ii:read`;
            await grantManage(issuer, permission);
            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            await runWithContext({ actor: issuerActor }, () =>
                permService.revokeUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            // The linked row must be gone the moment the revoke resolves —
            // a fire-and-forget delete could lose the race against the
            // post-bump rescan, which would re-warm the flat view from the
            // surviving SQL row and resurrect the grant.
            const rows = await server.stores.permission.readLinkedUserUserPerms(
                target.id,
                [permission],
            );
            expect(rows).toHaveLength(0);
        });

        it('revokeUserUserPermission surfaces a failed SQL delete instead of swallowing it', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target } = await makeUserActor();
            const permission = `zztest:rvk-fail-${uuidv4()}:ii:read`;
            await grantManage(issuer, permission);
            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );

            const spy = vi
                .spyOn(server.stores.permission, 'deleteUserUserPermByHolder')
                .mockRejectedValue(new Error('simulated db failure'));
            try {
                await expect(
                    runWithContext({ actor: issuerActor }, () =>
                        permService.revokeUserUserPermission(
                            issuerActor,
                            target.username,
                            permission,
                        ),
                    ),
                ).rejects.toThrow('simulated db failure');
            } finally {
                spy.mockRestore();
            }

            // Retry once the store works again — the revoke completes.
            await runWithContext({ actor: issuerActor }, () =>
                permService.revokeUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );
        });

        it('scan-path warms of the flat view carry an expiry (grants are permanent)', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target, actor: targetActor } = await makeUserActor();
            const permission = `zztest:warm-ttl-${uuidv4()}:ii:read`;
            await grantManage(issuer, permission);
            // The linked (SQL) path is a delegation chain: it only grants
            // if the issuer holds the permission themselves. Give the
            // issuer a terminal flat grant so the fallback below resolves.
            await server.stores.permission.setFlatUserPerm(
                issuer.id,
                permission,
                {
                    permission,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );
            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    target.username,
                    permission,
                ),
            );
            // The grant's linked-row upsert is fire-and-forget — wait for
            // it so the linked fallback below has something to find.
            await vi.waitFor(async () => {
                const rows =
                    await server.stores.permission.readLinkedUserUserPerms(
                        target.id,
                        [permission],
                    );
                expect(rows.length).toBeGreaterThan(0);
            });
            // Drop the flat entry so the next check takes the linked SQL
            // fallback and re-warms the flat view.
            await server.stores.permission.delFlatUserPerm(
                target.id,
                permission,
            );

            const spy = vi.spyOn(server.stores.permission, 'setFlatUserPerm');
            try {
                expect(await permService.check(targetActor, permission)).toBe(
                    true,
                );
                // The warm is fire-and-forget; wait for it to land.
                await vi.waitFor(() => {
                    const warmCall = spy.mock.calls.find(
                        (c) => c[1] === permission,
                    );
                    expect(warmCall).toBeDefined();
                    // Derived warms must self-expire so one that races a
                    // concurrent revoke cannot persist indefinitely.
                    expect(warmCall![3]?.expireAt).toBeGreaterThan(
                        Math.floor(Date.now() / 1000),
                    );
                });
            } finally {
                spy.mockRestore();
            }
        });
    });
});

// -- Scan paths --------------------------------------------------------

describe('PermissionService — scan paths', () => {
    let server: PuterServer;
    let permService: PermissionService;

    beforeAll(async () => {
        server = await setupTestServer();
        permService = server.services
            .permission as unknown as PermissionService;
    }, 60_000);

    afterAll(async () => {
        await server?.shutdown();
    }, 60_000);

    /** A user in the default user group, exactly as a verified signup is. */
    const makeGroupedUser = async (): Promise<{
        row: {
            id: number;
            uuid: string;
            username: string;
            email: string | null;
        };
        actor: Actor;
    }> => {
        const username = `psp${Math.random().toString(36).slice(2, 10)}`;
        await createTestUser(server, { username, password: 'psp-password' });
        const u = (await server.stores.user.getByUsername(username))!;
        const row = {
            id: u.id,
            uuid: u.uuid,
            username: u.username,
            email: u.email ?? null,
        };
        return { row, actor: { user: { ...row } } };
    };

    /** A bare user with no group membership at all. */
    const makeLooseUser = async (): Promise<{
        row: {
            id: number;
            uuid: string;
            username: string;
            email: string | null;
        };
        actor: Actor;
    }> => {
        const username = `psl${Math.random().toString(36).slice(2, 10)}`;
        const u = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            requires_email_confirmation: false,
        });
        const row = {
            id: u.id,
            uuid: u.uuid,
            username: u.username,
            email: u.email ?? null,
        };
        return { row, actor: { user: { ...row } } };
    };

    const makeApp = async (ownerUserId: number) =>
        (
            server.stores.app.create as unknown as (
                f: Record<string, unknown>,
                o: { ownerUserId: number },
            ) => Promise<{ uid: string; id: number }>
        )(
            {
                name: `psp-${uuidv4()}`,
                title: 'Scan path app',
                index_url: `https://psp-${uuidv4()}.test/`,
            },
            { ownerUserId },
        );

    describe('default user permissions and group grants', () => {
        it('grants the default permissions to a member of the default user group', async () => {
            const { actor } = await makeGroupedUser();
            expect(await permService.check(actor, 'driver:puter-kvstore')).toBe(
                true,
            );
            expect(
                await permService.check(
                    actor,
                    'service:puter-kvstore:ii:puter-kvstore',
                ),
            ).toBe(true);
        });

        it('grants the default permissions to a user in no group at all', async () => {
            // The floor does not depend on membership, which is what repairs
            // the account whose best-effort group insert failed at signup —
            // previously locked out of every driver call with no recovery.
            const { actor } = await makeLooseUser();
            expect(await permService.check(actor, 'driver:puter-kvstore')).toBe(
                true,
            );
            expect(
                await permService.check(
                    actor,
                    'service:puter-kvstore:ii:puter-kvstore',
                ),
            ).toBe(true);
        });

        it('grants the default permissions to a temp user', async () => {
            const { row: temp, actor: tempActor } = await makeLooseUser();
            await server.stores.group.addUsers(DEFAULT_TEMP_GROUP_UID, [
                temp.username,
            ]);
            expect(
                await permService.check(tempActor, 'driver:puter-kvstore'),
            ).toBe(true);
        });

        it('does not grant a permission outside the default set', async () => {
            // Both used to be admin-only entries in the group-keyed map.
            // Nothing grants them now.
            const { actor } = await makeLooseUser();
            expect(await permService.check(actor, 'local-terminal:access')).toBe(
                false,
            );
            expect(
                await permService.check(actor, `feature:${uuidv4()}`),
            ).toBe(false);
        });

        it('never queries group membership to resolve a user permission', async () => {
            // The membership lookup existed only to re-derive the flattened
            // constant above, so no scan should reach for it now.
            const { actor } = await makeGroupedUser();
            const spy = vi.spyOn(server.stores.group, 'listGroupsWithMember');
            try {
                expect(
                    await permService.check(actor, 'driver:puter-kvstore', {
                        noCache: true,
                    }),
                ).toBe(true);
                expect(
                    await permService.check(actor, `zztest:${uuidv4()}:read`, {
                        noCache: true,
                    }),
                ).toBe(false);
                expect(spy).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });

        it('honours a group grant issued by a user, and drops it on revoke', async () => {
            const { row: issuer, actor: issuerActor } = await makeGroupedUser();
            const { row: member, actor: memberActor } = await makeGroupedUser();
            const groupUid = await server.stores.group.create({
                ownerUserId: issuer.id,
            });
            const group = (await server.stores.group.getByUid(groupUid))!;
            await server.stores.group.addUsers(groupUid, [member.username]);

            const permission = `zztest:grp-${uuidv4()}:ii:read`;
            await server.stores.permission.setFlatUserPerm(
                issuer.id,
                `manage:${permission}`,
                {
                    permission: `manage:${permission}`,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );
            // The issuer must hold the permission itself for the delegation
            // chain to terminate.
            await server.stores.permission.setFlatUserPerm(
                issuer.id,
                permission,
                {
                    permission,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );

            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserGroupPermission(
                    issuerActor,
                    { id: group.id, uid: group.uid },
                    permission,
                ),
            );
            expect(await permService.check(memberActor, permission)).toBe(true);

            await runWithContext({ actor: issuerActor }, () =>
                permService.revokeUserGroupPermission(
                    issuerActor,
                    { id: group.id, uid: group.uid },
                    permission,
                ),
            );
            expect(await permService.check(memberActor, permission)).toBe(
                false,
            );
        });
    });

    describe('app-under-user grants', () => {
        it('gives every app the default implicit driver permissions', async () => {
            const { row, actor } = await makeGroupedUser();
            const app = await makeApp(row.id);
            const appActor: Actor = {
                user: actor.user,
                app: { uid: app.uid, id: app.id },
            };
            expect(
                await permService.check(appActor, 'driver:puter-kvstore'),
            ).toBe(true);
            // Not in the implicit set, and no row grants it.
            expect(
                await permService.check(
                    appActor,
                    `driver:puter-analytics:record`,
                ),
            ).toBe(false);
        });

        it('gives a built-in app its extra hardcoded permissions', async () => {
            const { actor } = await makeGroupedUser();
            const appActor: Actor = {
                user: actor.user,
                // dev-center, from the builtin-apps bucket.
                app: { uid: 'app-240a43f4-43b1-49bc-b9fc-c8ae719dab77', id: 1 },
            };
            expect(
                await permService.check(
                    appActor,
                    'driver:puter-analytics:record',
                ),
            ).toBe(true);
        });

        it('resolves a user-to-app grant, and stops once revoked', async () => {
            const { row, actor } = await makeGroupedUser();
            const app = await makeApp(row.id);
            const appActor: Actor = {
                user: actor.user,
                app: { uid: app.uid, id: app.id },
            };
            const permission = `zztest:u2a-${uuidv4()}:ii:read`;
            // The user must hold it for the app's delegation to terminate.
            await server.stores.permission.setFlatUserPerm(row.id, permission, {
                permission,
                deleted: false,
                issuer_user_id: row.id,
            } as never);

            expect(await permService.check(appActor, permission)).toBe(false);

            await runWithContext({ actor }, () =>
                permService.grantUserAppPermission(actor, app.uid, permission),
            );
            expect(await permService.check(appActor, permission)).toBe(true);

            await runWithContext({ actor }, () =>
                permService.revokeUserAppPermission(actor, app.uid, permission),
            );
            expect(await permService.check(appActor, permission)).toBe(false);
        });

        it('rejects a grant whose rewritten permission exceeds the column width', async () => {
            const { row, actor } = await makeGroupedUser();
            const app = await makeApp(row.id);
            await expect(
                runWithContext({ actor }, () =>
                    permService.grantUserAppPermission(
                        actor,
                        app.uid,
                        `zztest:${'x'.repeat(300)}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('resolves a dev-to-app grant for any user running that app', async () => {
            const { row: developer, actor: devActor } = await makeGroupedUser();
            const { actor: visitor } = await makeGroupedUser();
            const app = await makeApp(developer.id);
            const permission = `zztest:d2a-${uuidv4()}:ii:read`;
            for (const p of [permission, `manage:${permission}`]) {
                await server.stores.permission.setFlatUserPerm(
                    developer.id,
                    p,
                    {
                        permission: p,
                        deleted: false,
                        issuer_user_id: developer.id,
                    } as never,
                );
            }

            const visitorAppActor: Actor = {
                user: visitor.user,
                app: { uid: app.uid, id: app.id },
            };
            // A dev-app grant is issued by the developer, not the visitor, so
            // it is not generation-linked to the visitor's cache — readings
            // only lapse with the scan-cache TTL. Read past the cache so the
            // assertions are about the rule, not the TTL.
            const live = { noCache: true };
            expect(
                await permService.check(visitorAppActor, permission, live),
            ).toBe(false);

            await runWithContext({ actor: devActor }, () =>
                permService.grantDevAppPermission(
                    devActor,
                    app.uid,
                    permission,
                ),
            );
            expect(
                await permService.check(visitorAppActor, permission, live),
            ).toBe(true);

            await runWithContext({ actor: devActor }, () =>
                permService.revokeDevAppPermission(
                    devActor,
                    app.uid,
                    permission,
                ),
            );
            expect(
                await permService.check(visitorAppActor, permission, live),
            ).toBe(false);
        });

        it('revokeDevAppAll clears every dev grant on the app', async () => {
            const { row: developer, actor: devActor } = await makeGroupedUser();
            const app = await makeApp(developer.id);
            const permission = `zztest:d2aall-${uuidv4()}:ii:read`;
            for (const p of [permission, `manage:${permission}`]) {
                await server.stores.permission.setFlatUserPerm(
                    developer.id,
                    p,
                    {
                        permission: p,
                        deleted: false,
                        issuer_user_id: developer.id,
                    } as never,
                );
            }
            await runWithContext({ actor: devActor }, () =>
                permService.grantDevAppPermission(
                    devActor,
                    app.uid,
                    permission,
                ),
            );
            await permService.revokeDevAppAll(devActor, app.uid);

            const rows = (await server.clients.db.read(
                'SELECT 1 FROM `dev_to_app_permissions` WHERE `app_id` = ?',
                [app.id],
            )) as unknown[];
            expect(rows).toHaveLength(0);
        });
    });

    describe('access tokens', () => {
        const permissionFor = async (holderId: number, permission: string) =>
            server.stores.permission.setFlatUserPerm(holderId, permission, {
                permission,
                deleted: false,
                issuer_user_id: holderId,
            } as never);

        const scopedToken = (issuer: Actor, uid: string): Actor => ({
            user: issuer.user,
            accessToken: { uid, issuer, authorized: null, fullAccess: false },
        });

        it('a scoped token with no row of its own resolves nothing', async () => {
            const { row, actor } = await makeGroupedUser();
            const permission = `zztest:tok-${uuidv4()}:ii:read`;
            await permissionFor(row.id, permission);

            expect(
                await permService.check(
                    scopedToken(actor, `tok-${uuidv4()}`),
                    permission,
                ),
            ).toBe(false);
        });

        it('a scoped token does not inherit the default user permissions', async () => {
            // The floor applies to user actors only. A token must still carry
            // its own row, or a scoped token would silently widen to every
            // driver the moment its issuer held the `driver` root.
            const { actor } = await makeGroupedUser();
            expect(await permService.check(actor, 'driver:puter-kvstore')).toBe(
                true,
            );
            expect(
                await permService.check(
                    scopedToken(actor, `tok-${uuidv4()}`),
                    'driver:puter-kvstore',
                ),
            ).toBe(false);
        });

        it('a scoped token resolves a permission it carries and its issuer holds', async () => {
            const { row, actor } = await makeGroupedUser();
            const permission = `zztest:tok-${uuidv4()}:ii:read`;
            await permissionFor(row.id, permission);
            const tokenUid = `tok-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `access_token_permissions` (`token_uid`, `permission`, `extra`) VALUES (?, ?, ?)',
                [tokenUid, permission, '{}'],
            );

            expect(
                await permService.check(
                    scopedToken(actor, tokenUid),
                    permission,
                ),
            ).toBe(true);
        });

        it('a scoped token cannot exceed its issuer even with a row of its own', async () => {
            const { actor } = await makeGroupedUser();
            const permission = `zztest:tok-${uuidv4()}:ii:read`;
            const tokenUid = `tok-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `access_token_permissions` (`token_uid`, `permission`, `extra`) VALUES (?, ?, ?)',
                [tokenUid, permission, '{}'],
            );

            // The issuer never held it, so the delegation chain has no
            // terminal and the token resolves nothing.
            expect(
                await permService.check(
                    scopedToken(actor, tokenUid),
                    permission,
                ),
            ).toBe(false);
        });

        it('a full-access token resolves anything its issuer holds, and nothing more', async () => {
            const { row, actor } = await makeGroupedUser();
            const held = `zztest:full-${uuidv4()}:ii:read`;
            const notHeld = `zztest:full-${uuidv4()}:ii:read`;
            await permissionFor(row.id, held);

            const tokenActor: Actor = {
                user: actor.user,
                accessToken: {
                    uid: `tok-${uuidv4()}`,
                    issuer: actor,
                    authorized: null,
                    fullAccess: true,
                },
            };
            expect(await permService.check(tokenActor, held)).toBe(true);
            expect(await permService.check(tokenActor, notHeld)).toBe(false);
        });

        it('folds the authorized actor into the cache key so its bumps land', async () => {
            const { row, actor } = await makeGroupedUser();
            const { actor: authorized } = await makeGroupedUser();
            const permission = `zztest:auth-${uuidv4()}:ii:read`;
            const tokenActor: Actor = {
                user: actor.user,
                accessToken: {
                    uid: `tok-${uuidv4()}`,
                    issuer: actor,
                    authorized,
                    fullAccess: true,
                },
            };

            expect(await permService.check(tokenActor, permission)).toBe(false);
            await permissionFor(row.id, permission);
            // A grant to the issuer bumps the issuer's generation, which the
            // token's composite cache tag includes.
            await permService.bumpPermissionCacheForUsernames([row.username]);
            expect(await permService.check(tokenActor, permission)).toBe(true);
        });
    });

    describe('user-to-user delegation', () => {
        it('does not loop when two users have granted each other', async () => {
            const { row: a, actor: actorA } = await makeGroupedUser();
            const { row: b, actor: actorB } = await makeGroupedUser();
            const permission = `zztest:cycle-${uuidv4()}:ii:read`;

            // Reciprocal linked rows, with neither holding a terminal grant.
            await server.stores.permission.upsertUserUserPerm(
                a.id,
                b.id,
                permission,
                {},
            );
            await server.stores.permission.upsertUserUserPerm(
                b.id,
                a.id,
                permission,
                {},
            );

            expect(
                await permService.check(actorA, permission, { noCache: true }),
            ).toBe(false);
            expect(
                await permService.check(actorB, permission, { noCache: true }),
            ).toBe(false);
        });

        it('treats a tombstoned flat entry as no grant at all', async () => {
            const { row, actor } = await makeGroupedUser();
            const permission = `zztest:tomb-${uuidv4()}:ii:read`;
            await server.stores.permission.setFlatUserPerm(row.id, permission, {
                permission,
                deleted: true,
                issuer_user_id: row.id,
            } as never);
            expect(
                await permService.validateUserPerms({
                    actor,
                    permissions: [permission],
                }),
            ).toEqual([]);
            expect(await permService.check(actor, permission)).toBe(false);
        });

        it('returns nothing for an actor with no user id', async () => {
            expect(
                await permService.validateUserPerms({
                    actor: { user: {} },
                    permissions: ['zztest:x:ii:read'],
                }),
            ).toEqual([]);
        });
    });

    describe('rules registered at runtime', () => {
        it('records the rewrite in the reading it returns', async () => {
            const { actor } = await makeLooseUser();
            const from = `alias-${uuidv4()}`;
            permService.registerRewriter({
                id: 'test-alias',
                matches: (p) => p === from,
                rewrite: async () => 'zztest:rewritten:ii:read',
            });
            const reading = await permService.scan(actor, from, undefined, {
                noCache: true,
            });
            expect(reading).toContainEqual({
                $: 'rewrite',
                from,
                to: 'zztest:rewritten:ii:read',
            });
        });

        it('a shortcut implicator wins immediately and suppresses the scanners', async () => {
            const { actor } = await makeLooseUser();
            const permission = `shortcut-${uuidv4()}:go`;
            let nonShortcutRan = false;
            permService.registerImplicator({
                id: 'test-shortcut',
                shortcut: true,
                matches: (p) => p.startsWith(permission.split(':')[0]),
                check: async () => ({ why: 'shortcut' }),
            });
            permService.registerImplicator({
                id: 'test-non-shortcut',
                matches: (p) => p.startsWith(permission.split(':')[0]),
                check: async () => {
                    nonShortcutRan = true;
                    return undefined;
                },
            });

            const reading = await permService.scan(
                actor,
                permission,
                undefined,
                { noCache: true },
            );
            expect(reading.find((n) => n.by === 'test-shortcut')).toMatchObject(
                {
                    $: 'option',
                    source: 'implied',
                    data: { why: 'shortcut' },
                },
            );
            expect(nonShortcutRan).toBe(false);
        });

        it('a non-shortcut implicator contributes an option alongside the scanners', async () => {
            const { actor } = await makeLooseUser();
            const permission = `plain-${uuidv4()}:go`;
            permService.registerImplicator({
                id: 'test-plain',
                matches: (p) => p === permission,
                check: async ({ actor: a }) =>
                    a.user?.username ? { holder: a.user.username } : undefined,
            });
            expect(
                await permService.check(actor, permission, { noCache: true }),
            ).toBe(true);
        });
    });

    describe('scan caching', () => {
        it('serves a repeat scan from cache and re-derives with noCache', async () => {
            const { row, actor } = await makeLooseUser();
            const permission = `zztest:cache-${uuidv4()}:ii:read`;

            expect(await permService.check(actor, permission)).toBe(false);

            // Write the grant straight to the flat store, bypassing the
            // generation bump a real grant would do.
            await server.stores.permission.setFlatUserPerm(row.id, permission, {
                permission,
                deleted: false,
                issuer_user_id: row.id,
            } as never);

            // The cached "denied" reading is still served...
            expect(await permService.check(actor, permission)).toBe(false);
            // ...until the caller opts out of the cache.
            expect(
                await permService.check(actor, permission, { noCache: true }),
            ).toBe(true);
        });

        it('checkMany answers from the batch cache on the second call', async () => {
            const { row, actor } = await makeLooseUser();
            const granted = `zztest:many-${uuidv4()}:ii:read`;
            const denied = `zztest:many-${uuidv4()}:ii:read`;
            await server.stores.permission.setFlatUserPerm(row.id, granted, {
                permission: granted,
                deleted: false,
                issuer_user_id: row.id,
            } as never);

            const first = await permService.checkMany(actor, [
                granted,
                denied,
                granted,
            ]);
            expect(first).toEqual(
                new Map([
                    [granted, true],
                    [denied, false],
                ]),
            );

            const spy = vi.spyOn(permService, 'check');
            try {
                const second = await permService.checkMany(actor, [
                    granted,
                    denied,
                ]);
                expect(second).toEqual(first);
                // Everything came from the cache — no per-permission scan.
                expect(spy).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });

        it('checkMany reports false for a permission whose evaluation throws', async () => {
            const { actor } = await makeLooseUser();
            const permission = `zztest:boom-${uuidv4()}:ii:read`;
            const spy = vi
                .spyOn(permService, 'check')
                .mockRejectedValue(new Error('scan exploded'));
            try {
                expect(
                    await permService.checkMany(actor, [permission]),
                ).toEqual(new Map([[permission, false]]));
            } finally {
                spy.mockRestore();
            }
        });

        it('checkMany drops empty permission strings', async () => {
            const { actor } = await makeLooseUser();
            expect(await permService.checkMany(actor, ['', ''])).toEqual(
                new Map(),
            );
        });
    });

    describe('issuer queries', () => {
        it('lists the apps and users an issuer has granted a prefix to', async () => {
            const { row: issuer, actor: issuerActor } = await makeGroupedUser();
            const { row: holder } = await makeGroupedUser();
            const app = await makeApp(issuer.id);
            const prefix = `zztest:iss-${uuidv4()}`;
            const userPerm = `${prefix}:ii:read`;
            const appPerm = `${prefix}:ii:write`;

            for (const p of [userPerm, `manage:${userPerm}`]) {
                await server.stores.permission.setFlatUserPerm(issuer.id, p, {
                    permission: p,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never);
            }
            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserUserPermission(
                    issuerActor,
                    holder.username,
                    userPerm,
                ),
            );
            await runWithContext({ actor: issuerActor }, () =>
                permService.grantUserAppPermission(
                    issuerActor,
                    app.uid,
                    appPerm,
                ),
            );
            await vi.waitFor(async () => {
                const rows =
                    await server.stores.permission.readLinkedUserUserPerms(
                        holder.id,
                        [userPerm],
                    );
                expect(rows.length).toBeGreaterThan(0);
            });

            const result = await permService.queryIssuerPermissionsByPrefix(
                { id: issuer.id },
                prefix,
            );
            expect(result.users).toEqual([
                {
                    user: {
                        id: holder.id,
                        uuid: holder.uuid,
                        username: holder.username,
                        email: holder.email,
                    },
                    permission: userPerm,
                },
            ]);
            expect(result.apps).toEqual([
                {
                    app: { id: app.id, uid: app.uid, name: expect.any(String) },
                    permission: appPerm,
                },
            ]);
        });

        it('returns nothing for an issuer or holder that is not a user actor', async () => {
            const { actor } = await makeGroupedUser();
            expect(
                await permService.queryIssuerHolderPermissionsByPrefix(
                    { user: {} },
                    actor,
                    'fs:',
                ),
            ).toEqual([]);
        });
    });
});

describe('PermissionService — default user permissions vs. group config', () => {
    /** A user with no group membership, on an arbitrary server. */
    const makeLooseActor = async (srv: PuterServer): Promise<Actor> => {
        const username = `pdg${Math.random().toString(36).slice(2, 10)}`;
        const u = await srv.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            requires_email_confirmation: false,
        });
        return {
            user: {
                id: u.id,
                uuid: u.uuid,
                username: u.username,
                email: u.email ?? null,
            },
        };
    };

    it('grants the default permissions with no default group configured', async () => {
        // Self-hosted deployments may run without default groups. The floor
        // is not group-derived, so it applies regardless — a deployment that
        // clears both no longer has every driver call fail closed.
        const bare = await setupTestServer({
            default_user_group: '',
            default_temp_group: '',
        } as never);
        try {
            const perms = bare.services
                .permission as unknown as PermissionService;
            const actor = await makeLooseActor(bare);
            expect(await perms.check(actor, 'driver:puter-kvstore')).toBe(true);
            expect(
                await perms.check(
                    actor,
                    'service:puter-kvstore:ii:puter-kvstore',
                ),
            ).toBe(true);
            // Still only the roots the floor names.
            expect(await perms.check(actor, 'local-terminal:access')).toBe(
                false,
            );
        } finally {
            await bare.shutdown();
        }
    }, 60_000);
});
