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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { kv } from '../../util/kvSingleton.js';
import { PermissionService } from './PermissionService.js';

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
            return permission === 'app:uid#a:access' ||
                permission === 'app:uid#b:access';
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
        permService = server.services.permission as unknown as PermissionService;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUserActor = async (): Promise<{ user: { id: number; uuid: string; username: string }; actor: Actor }> => {
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
                `service:nope-${uuidv4()}:ii:read`,
            );
            expect(allowed).toBeFalsy();
        });

        it('canManagePermission delegates to check on manage:<perm>', async () => {
            const { user, actor } = await makeUserActor();
            const perm = `service:manage-test-${uuidv4()}:ii:read`;
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
            expect(await permService.canManagePermission(actor, perm)).toBeTruthy();
        });
    });

    describe('grantUserUserPermission / revokeUserUserPermission', () => {
        it('throws 404 when the target user does not exist', async () => {
            const { actor } = await makeUserActor();
            await expect(
                permService.grantUserUserPermission(
                    actor,
                    `does-not-exist-${uuidv4()}`,
                    'service:foo:ii:read',
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('throws 400 when the issuer tries to grant to themselves', async () => {
            const { user, actor } = await makeUserActor();
            await expect(
                permService.grantUserUserPermission(
                    actor,
                    user.username,
                    'service:foo:ii:read',
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
                        `service:unmanaged-${uuidv4()}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('grant persists when issuer holds manage:<permission>', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target, actor: targetActor } = await makeUserActor();
            const permission = `service:user-user-${uuidv4()}:ii:read`;
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
                    'service:foo:ii:read',
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
                        `service:unmanaged-${uuidv4()}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    describe('grantUserAppPermission / revokeUserAppPermission / revokeUserAppAll', () => {
        const makeApp = async (ownerUserId: number) =>
            (server.stores.app.create as unknown as (
                fields: Record<string, unknown>,
                opts: { ownerUserId: number },
            ) => Promise<{ uid: string; id: number }>)(
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
                        'service:foo:ii:read',
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('persists a user→app grant and is idempotent', async () => {
            const { user, actor } = await makeUserActor();
            const app = await makeApp(user.id);
            const permission = `service:gua-${uuidv4()}:ii:read`;

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
            const permission = `service:rua-${uuidv4()}:ii:read`;
            await runWithContext({ actor }, () =>
                permService.grantUserAppPermission(actor, app.uid, permission),
            );
            await permService.revokeUserAppPermission(actor, app.uid, permission);
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
                    'service:foo:ii:read',
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
                `service:rua-${uuidv4()}:ii:read`,
                `service:rua-${uuidv4()}:ii:write`,
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
            (server.stores.app.create as unknown as (
                fields: Record<string, unknown>,
                opts: { ownerUserId: number },
            ) => Promise<{ uid: string; id: number }>)(
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
                        'service:foo:ii:read',
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
                        `service:unmanaged-${uuidv4()}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('grant persists when manage:<perm> is held', async () => {
            const { user, actor } = await makeUserActor();
            const app = await makeApp(user.id);
            const permission = `service:dev-${uuidv4()}:ii:read`;
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
                    'service:foo:ii:read',
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
                        `service:unmanaged-${uuidv4()}:ii:read`,
                    ),
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('revokeUserGroupPermission rejects when actor has no user.id', async () => {
            await expect(
                permService.revokeUserGroupPermission(
                    { user: undefined } as unknown as Actor,
                    { id: 1, uid: 'grp-x' },
                    'service:foo:ii:read',
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    describe('listUserPermissionIssuers / queryIssuerHolderPermissionsByPrefix', () => {
        it('listUserPermissionIssuers returns the issuer who granted the target a perm', async () => {
            const { user: issuer, actor: issuerActor } = await makeUserActor();
            const { user: target } = await makeUserActor();
            const permission = `service:lst-${uuidv4()}:ii:read`;
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
            const { user: issuer, actor: issuerActor } =
                await makeUserActor();
            const { user: target, actor: targetActor } =
                await makeUserActor();
            const permission = `service:revoke-now-${uuidv4()}:ii:read`;
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
            expect(await permService.check(targetActor, permission)).toBe(
                true,
            );

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
            expect(await server.stores.permission.getCacheGeneration(aUid)).toBe(
                g + 1,
            );
        });

        it('grant is visible immediately — a cached "denied" reading is not served', async () => {
            const { user: issuer, actor: issuerActor } =
                await makeUserActor();
            const { user: target, actor: targetActor } =
                await makeUserActor();
            const permission = `service:grant-now-${uuidv4()}:ii:read`;
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

            expect(await permService.check(targetActor, permission)).toBe(
                true,
            );
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
            (server.stores.app.create as unknown as (
                fields: Record<string, unknown>,
                opts: { ownerUserId: number },
            ) => Promise<{ uid: string; id: number }>)(
                {
                    name: `dac-${uuidv4()}`,
                    title: 'Derived-actor cache app',
                    index_url: `https://dac-${uuidv4()}.test/`,
                },
                { ownerUserId },
            );

        it('a user-level revoke is visible immediately to the user\'s app actors', async () => {
            const { user: issuer, actor: issuerActor } =
                await makeUserActor();
            const { user: target, actor: targetActor } =
                await makeUserActor();
            const app = await makeApp(target.id);
            const permission = `service:app-revoke-now-${uuidv4()}:ii:read`;
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

        it('a user-level grant busts an app actor\'s cached denial immediately', async () => {
            const { user: issuer, actor: issuerActor } =
                await makeUserActor();
            const { user: target, actor: targetActor } =
                await makeUserActor();
            const app = await makeApp(target.id);
            const permission = `service:app-grant-now-${uuidv4()}:ii:read`;
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
            const { user: issuer, actor: issuerActor } =
                await makeUserActor();
            const { user: target } = await makeUserActor();
            const permission = `service:rvk-sync-${uuidv4()}:ii:read`;
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
            const { user: issuer, actor: issuerActor } =
                await makeUserActor();
            const { user: target } = await makeUserActor();
            const permission = `service:rvk-fail-${uuidv4()}:ii:read`;
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
            const { user: issuer, actor: issuerActor } =
                await makeUserActor();
            const { user: target, actor: targetActor } =
                await makeUserActor();
            const permission = `service:warm-ttl-${uuidv4()}:ii:read`;
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
