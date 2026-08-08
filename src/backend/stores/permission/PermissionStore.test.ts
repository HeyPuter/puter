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

import { readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';

describe('PermissionStore', () => {
    let server: PuterServer;
    let store: PuterServer['stores']['permission'];

    beforeAll(async () => {
        server = await setupTestServer();
        store = server.stores.permission;
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const makeUser = async (): Promise<{ id: number; username: string }> => {
        const username = `pm-${Math.random().toString(36).slice(2, 10)}`;
        const created = (await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
        } as never)) as unknown as { id: number };
        return { id: created.id, username };
    };

    const makeApp = async (ownerUserId: number) => {
        const name = `pm-app-${Math.random().toString(36).slice(2, 10)}`;
        return server.stores.app.create(
            { name, title: name, index_url: `https://${name}.example.com/` },
            { ownerUserId },
        );
    };

    // -- Flat KV view --------------------------------------------------

    describe('flat user permissions (KV view)', () => {
        it('round-trips a value and drops it on delete', async () => {
            const holder = await makeUser();
            const perm = `fs:${uuidv4()}:read`;

            expect(await store.getFlatUserPerms(holder.id, [perm])).toEqual([]);

            await store.setFlatUserPerm(holder.id, perm, {
                permission: perm,
                issuer_user_id: 1,
            });
            expect(await store.getFlatUserPerms(holder.id, [perm])).toEqual([
                { permission: perm, issuer_user_id: 1 },
            ]);

            await store.delFlatUserPerm(holder.id, perm);
            expect(await store.getFlatUserPerms(holder.id, [perm])).toEqual([]);
        });

        it('returns nothing for an empty permission list', async () => {
            const holder = await makeUser();
            expect(await store.getFlatUserPerms(holder.id, [])).toEqual([]);
        });

        it('dedupes repeated permission strings and skips missing keys', async () => {
            const holder = await makeUser();
            const present = `fs:${uuidv4()}:read`;
            await store.setFlatUserPerm(holder.id, present, {
                permission: present,
            });

            const values = await store.getFlatUserPerms(holder.id, [
                present,
                present,
                `fs:${uuidv4()}:write`,
            ]);
            expect(values).toEqual([{ permission: present }]);
        });

        it('scopes entries per holder', async () => {
            const a = await makeUser();
            const b = await makeUser();
            const perm = `fs:${uuidv4()}:read`;
            await store.setFlatUserPerm(a.id, perm, { permission: perm });

            expect(await store.getFlatUserPerms(b.id, [perm])).toEqual([]);
        });
    });

    // -- user → app ----------------------------------------------------

    describe('user-to-app permissions', () => {
        it('upserts, reads back the decoded extra, and reports membership', async () => {
            const user = await makeUser();
            const app = await makeApp(user.id);

            await store.upsertUserAppPerm(user.id, app.id, 'driver:kv', {
                granted: true,
            });

            const rows = await store.readUserAppPerms(user.id, app.id, [
                'driver:kv',
                'driver:other',
            ]);
            expect(rows).toHaveLength(1);
            expect(rows[0].permission).toBe('driver:kv');
            expect(rows[0].extra).toEqual({ granted: true });
            expect(
                await store.hasUserAppPerm(user.id, app.id, 'driver:kv'),
            ).toBe(true);
            expect(
                await store.hasUserAppPerm(user.id, app.id, 'driver:nope'),
            ).toBe(false);
        });

        it('replaces `extra` on a repeat upsert instead of duplicating the row', async () => {
            const user = await makeUser();
            const app = await makeApp(user.id);

            await store.upsertUserAppPerm(user.id, app.id, 'driver:kv', {
                v: 1,
            });
            await store.upsertUserAppPerm(user.id, app.id, 'driver:kv', {
                v: 2,
            });

            const rows = await store.readUserAppPerms(user.id, app.id, [
                'driver:kv',
            ]);
            expect(rows).toHaveLength(1);
            expect(rows[0].extra).toEqual({ v: 2 });
        });

        it('deletes a single grant and every grant for an app', async () => {
            const user = await makeUser();
            const app = await makeApp(user.id);
            await store.upsertUserAppPerm(user.id, app.id, 'driver:a', {});
            await store.upsertUserAppPerm(user.id, app.id, 'driver:b', {});

            await store.deleteUserAppPerm(user.id, app.id, 'driver:a');
            expect(
                (
                    await store.readUserAppPerms(user.id, app.id, [
                        'driver:a',
                        'driver:b',
                    ])
                ).map((r) => r.permission),
            ).toEqual(['driver:b']);

            await store.deleteUserAppAll(user.id, app.id);
            expect(
                await store.readUserAppPerms(user.id, app.id, [
                    'driver:a',
                    'driver:b',
                ]),
            ).toEqual([]);
        });

        it('returns nothing for an empty permission list', async () => {
            const user = await makeUser();
            const app = await makeApp(user.id);
            expect(await store.readUserAppPerms(user.id, app.id, [])).toEqual(
                [],
            );
        });

        it('records a grant/revoke audit row', async () => {
            const user = await makeUser();
            const app = await makeApp(user.id);
            await store.auditUserAppPerm({
                user_id: user.id,
                app_id: app.id,
                permission: 'driver:kv',
                action: 'grant',
                reason: 'test',
            });

            const rows = await server.clients.db.read(
                'SELECT * FROM `audit_user_to_app_permissions` WHERE `user_id` = ?',
                [user.id],
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].action).toBe('grant');
            expect(rows[0].reason).toBe('test');
        });
    });

    // -- prefix deletion -----------------------------------------------

    describe('deleteAppGrantsByPermissionPrefix', () => {
        it('removes the exact permission and its subtree, across both tables', async () => {
            const user = await makeUser();
            const app = await makeApp(user.id);

            await store.upsertUserAppPerm(user.id, app.id, 'app-data:x', {});
            await store.upsertUserAppPerm(
                user.id,
                app.id,
                'app-data:x:kv:get',
                {},
            );
            await store.upsertUserAppPerm(user.id, app.id, 'app-data:y', {});
            await store.upsertDevAppPerm(user.id, app.id, 'app-data:x:fs', {});

            const removed =
                await store.deleteAppGrantsByPermissionPrefix('app-data:x');

            expect(removed.map((r) => r.permission).sort()).toEqual([
                'app-data:x',
                'app-data:x:fs',
                'app-data:x:kv:get',
            ]);
            expect(
                await store.hasUserAppPerm(user.id, app.id, 'app-data:y'),
            ).toBe(true);
        });

        it('treats LIKE wildcards in the permission as literal text', async () => {
            const user = await makeUser();
            const app = await makeApp(user.id);

            // `_` matches any single character unescaped, so an unescaped
            // pattern for `app-data:a_c` would also delete `app-data:abc`.
            await store.upsertUserAppPerm(
                user.id,
                app.id,
                'app-data:a_c:kv',
                {},
            );
            await store.upsertUserAppPerm(
                user.id,
                app.id,
                'app-data:abc:kv',
                {},
            );
            await store.upsertUserAppPerm(user.id, app.id, 'app-data:100%', {});
            await store.upsertUserAppPerm(
                user.id,
                app.id,
                'app-data:100pct',
                {},
            );

            const removed =
                await store.deleteAppGrantsByPermissionPrefix('app-data:a_c');
            expect(removed.map((r) => r.permission)).toEqual([
                'app-data:a_c:kv',
            ]);
            expect(
                await store.hasUserAppPerm(user.id, app.id, 'app-data:abc:kv'),
            ).toBe(true);

            await store.deleteAppGrantsByPermissionPrefix('app-data:100%');
            expect(
                await store.hasUserAppPerm(user.id, app.id, 'app-data:100pct'),
            ).toBe(true);
        });

        it('escapes the escape character itself', async () => {
            const user = await makeUser();
            const app = await makeApp(user.id);

            await store.upsertUserAppPerm(user.id, app.id, 'app-data:a!b', {});
            await store.upsertUserAppPerm(
                user.id,
                app.id,
                'app-data:a!b:kv',
                {},
            );

            const removed =
                await store.deleteAppGrantsByPermissionPrefix('app-data:a!b');
            expect(removed.map((r) => r.permission).sort()).toEqual([
                'app-data:a!b',
                'app-data:a!b:kv',
            ]);
        });

        it('does not use a backslash as the LIKE escape character', () => {
            // MySQL processes backslash escapes inside string literals, so the
            // `'\'` that a JS `'\\'` produces reads as an escaped quote and
            // leaves the literal unterminated. That is a parse error on MySQL
            // only — no SQLite or Postgres run, including this suite, would
            // ever surface it, so the SQL text itself is what gets pinned.
            const source = readFileSync(
                new URL('./PermissionStore.ts', import.meta.url),
                'utf8',
            );
            const escapeClauses = source
                .split('\n')
                .filter(
                    (line) =>
                        line.includes('LIKE ?') && line.includes('ESCAPE'),
                )
                .map((line) => line.trim());
            expect(escapeClauses.length).toBeGreaterThan(0);
            for (const clause of escapeClauses) {
                expect(clause).toContain("ESCAPE '!'");
            }
        });
    });

    // -- dev → app -----------------------------------------------------

    describe('dev-to-app permissions', () => {
        it('upserts, reads, and deletes the developer grants for an app', async () => {
            const dev = await makeUser();
            const app = await makeApp(dev.id);

            await store.upsertDevAppPerm(dev.id, app.id, 'dev:read', {
                scope: 'a',
            });
            await store.upsertDevAppPerm(dev.id, app.id, 'dev:write', {});

            const rows = await store.readDevAppPerms(app.id, [
                'dev:read',
                'dev:write',
            ]);
            expect(rows.map((r) => r.permission).sort()).toEqual([
                'dev:read',
                'dev:write',
            ]);
            expect(
                rows.find((r) => r.permission === 'dev:read')!.extra,
            ).toEqual({ scope: 'a' });

            await store.deleteDevAppPerm(dev.id, app.id, 'dev:read');
            expect(
                (await store.readDevAppPerms(app.id, ['dev:read'])).length,
            ).toBe(0);

            await store.deleteDevAppAll(dev.id, app.id);
            expect(
                await store.readDevAppPerms(app.id, ['dev:read', 'dev:write']),
            ).toEqual([]);
        });

        it('reads a single permission without wrapping the clause in parentheses', async () => {
            const dev = await makeUser();
            const app = await makeApp(dev.id);
            await store.upsertDevAppPerm(dev.id, app.id, 'dev:only', {});
            expect(
                (await store.readDevAppPerms(app.id, ['dev:only'])).length,
            ).toBe(1);
        });

        it('returns nothing for an empty permission list', async () => {
            const app = await makeApp((await makeUser()).id);
            expect(await store.readDevAppPerms(app.id, [])).toEqual([]);
        });

        it('records a developer audit row', async () => {
            const dev = await makeUser();
            const app = await makeApp(dev.id);
            await store.auditDevAppPerm({
                user_id: dev.id,
                app_id: app.id,
                permission: 'dev:read',
                action: 'revoke',
                reason: 'cleanup',
            });
            const rows = await server.clients.db.read(
                'SELECT * FROM `audit_dev_to_app_permissions` WHERE `user_id` = ?',
                [dev.id],
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].action).toBe('revoke');
        });
    });

    // -- user → group --------------------------------------------------

    describe('user-to-group permissions', () => {
        it('only surfaces grants for groups the reader actually belongs to', async () => {
            const issuer = await makeUser();
            const member = await makeUser();
            const stranger = await makeUser();
            const groupUid = await server.stores.group.create({
                ownerUserId: issuer.id,
            });
            const group = await server.stores.group.getByUid(groupUid);
            await server.stores.group.addUsers(groupUid, [member.username]);

            await store.upsertUserGroupPerm(
                issuer.id,
                group!.id,
                'fs:shared:read',
                { note: 'team' },
            );

            const memberRows = await store.readUserGroupPerms(member.id, [
                'fs:shared:read',
            ]);
            expect(memberRows).toHaveLength(1);
            expect(memberRows[0].group_id).toBe(group!.id);
            expect(memberRows[0].extra).toEqual({ note: 'team' });

            // A non-member must not see the group grant.
            expect(
                await store.readUserGroupPerms(stranger.id, ['fs:shared:read']),
            ).toEqual([]);
        });

        it('drops the grant for every member once it is deleted', async () => {
            const issuer = await makeUser();
            const member = await makeUser();
            const groupUid = await server.stores.group.create({
                ownerUserId: issuer.id,
            });
            const group = await server.stores.group.getByUid(groupUid);
            await server.stores.group.addUsers(groupUid, [member.username]);
            await store.upsertUserGroupPerm(
                issuer.id,
                group!.id,
                'fs:shared:write',
                {},
            );

            await store.deleteUserGroupPerm(
                issuer.id,
                group!.id,
                'fs:shared:write',
            );

            expect(
                await store.readUserGroupPerms(member.id, ['fs:shared:write']),
            ).toEqual([]);
        });

        it('replaces `extra` on a repeat upsert', async () => {
            const issuer = await makeUser();
            const member = await makeUser();
            const groupUid = await server.stores.group.create({
                ownerUserId: issuer.id,
            });
            const group = await server.stores.group.getByUid(groupUid);
            await server.stores.group.addUsers(groupUid, [member.username]);

            await store.upsertUserGroupPerm(issuer.id, group!.id, 'g:p', {
                v: 1,
            });
            await store.upsertUserGroupPerm(issuer.id, group!.id, 'g:p', {
                v: 2,
            });

            const rows = await store.readUserGroupPerms(member.id, ['g:p']);
            expect(rows).toHaveLength(1);
            expect(rows[0].extra).toEqual({ v: 2 });
        });

        it('returns nothing for an empty permission list', async () => {
            const user = await makeUser();
            expect(await store.readUserGroupPerms(user.id, [])).toEqual([]);
        });

        it('records a group audit row', async () => {
            const issuer = await makeUser();
            const groupUid = await server.stores.group.create({
                ownerUserId: issuer.id,
            });
            const group = await server.stores.group.getByUid(groupUid);
            await store.auditUserGroupPerm({
                user_id: issuer.id,
                group_id: group!.id,
                permission: 'g:p',
                action: 'grant',
                reason: 'test',
            });
            const rows = await server.clients.db.read(
                'SELECT * FROM `audit_user_to_group_permissions` WHERE `user_id` = ?',
                [issuer.id],
            );
            expect(rows).toHaveLength(1);
        });
    });

    // -- issuer-prefix discovery queries ---------------------------------

    describe('issuer-prefix queries', () => {
        it('lists the holders and permissions an issuer granted under a prefix', async () => {
            const issuer = await makeUser();
            const holder = await makeUser();
            const other = await makeUser();

            await store.upsertUserUserPerm(
                holder.id,
                issuer.id,
                'fs:abc:read',
                {},
            );
            await store.upsertUserUserPerm(
                holder.id,
                issuer.id,
                'fs:abc:write',
                {},
            );
            await store.upsertUserUserPerm(other.id, issuer.id, 'kv:x', {});

            const rows = await store.queryIssuerUserPermsByPrefix(
                issuer.id,
                'fs:',
            );
            expect(rows.map((r) => r.permission).sort()).toEqual([
                'fs:abc:read',
                'fs:abc:write',
            ]);
            expect(new Set(rows.map((r) => r.holder_user_id))).toEqual(
                new Set([holder.id]),
            );

            expect(
                await store.queryIssuerHolderPermsByPrefix(
                    issuer.id,
                    other.id,
                    'fs:',
                ),
            ).toEqual([]);
            expect(
                (
                    await store.queryIssuerHolderPermsByPrefix(
                        issuer.id,
                        holder.id,
                        'fs:abc',
                    )
                ).sort(),
            ).toEqual(['fs:abc:read', 'fs:abc:write']);
        });

        it('lists the apps an issuer granted under a prefix', async () => {
            const issuer = await makeUser();
            const app = await makeApp(issuer.id);
            await store.upsertUserAppPerm(issuer.id, app.id, 'fs:xyz:read', {});
            await store.upsertUserAppPerm(issuer.id, app.id, 'kv:other', {});

            const rows = await store.queryIssuerAppPermsByPrefix(
                issuer.id,
                'fs:',
            );
            expect(rows).toEqual([
                { app_id: app.id, permission: 'fs:xyz:read' },
            ]);
        });

        it('never returns another issuer grants', async () => {
            const issuer = await makeUser();
            const rival = await makeUser();
            const holder = await makeUser();
            await store.upsertUserUserPerm(
                holder.id,
                rival.id,
                'fs:r:read',
                {},
            );

            expect(
                await store.queryIssuerUserPermsByPrefix(issuer.id, 'fs:'),
            ).toEqual([]);
        });
    });

    // -- access token permissions --------------------------------------

    describe('access token permissions', () => {
        it('reads the token grants, caches them, and re-reads after invalidation', async () => {
            const tokenUid = `tok-${uuidv4()}`;
            await server.clients.db.write(
                'INSERT INTO `access_token_permissions` (`token_uid`, `permission`) VALUES (?, ?)',
                [tokenUid, 'driver:kv'],
            );

            expect(await store.hasAccessTokenPerm(tokenUid, 'driver:kv')).toBe(
                true,
            );
            expect(await store.hasAccessTokenPerm(tokenUid, 'driver:fs')).toBe(
                false,
            );

            // A grant added behind the cache is invisible until invalidated —
            // and visible immediately afterwards.
            await server.clients.db.write(
                'INSERT INTO `access_token_permissions` (`token_uid`, `permission`) VALUES (?, ?)',
                [tokenUid, 'driver:fs'],
            );
            expect(await store.hasAccessTokenPerm(tokenUid, 'driver:fs')).toBe(
                false,
            );

            await store.invalidateAccessTokenPerms(tokenUid);
            expect(await store.hasAccessTokenPerm(tokenUid, 'driver:fs')).toBe(
                true,
            );
        });

        it('reports no permissions for an unknown token', async () => {
            expect(
                await store.hasAccessTokenPerm(`tok-${uuidv4()}`, 'driver:kv'),
            ).toBe(false);
        });
    });

    // -- cache generation + scan/check caches ----------------------------

    describe('cache generation and derived caches', () => {
        it('starts at zero and advances when bumped', async () => {
            const actorUid = `actor-${uuidv4()}`;
            expect(await store.getCacheGeneration(actorUid)).toBe(0);

            await store.bumpCacheGeneration(actorUid);
            const bumped = await store.getCacheGeneration(actorUid);
            expect(bumped).toBeGreaterThan(0);
        });

        it('orphans a cached scan result when the generation moves', async () => {
            const actorUid = `actor-${uuidv4()}`;
            const generation = await store.getCacheGeneration(actorUid);
            const key = store.buildScanCacheKey(
                actorUid,
                ['fs:1:read'],
                generation,
            );

            await store.setScanCache(key, { allowed: true });
            expect(await store.getScanCache(key)).toEqual({ allowed: true });

            await store.bumpCacheGeneration(actorUid);
            const nextKey = store.buildScanCacheKey(
                actorUid,
                ['fs:1:read'],
                await store.getCacheGeneration(actorUid),
            );
            expect(nextKey).not.toBe(key);
            expect(await store.getScanCache(nextKey)).toBeNull();
        });

        it('drops a scan cache entry on explicit invalidation', async () => {
            const key = store.buildScanCacheKey(`actor-${uuidv4()}`, ['p'], 0);
            await store.setScanCache(key, { allowed: false });
            await store.invalidateScanCache(key);
            expect(await store.getScanCache(key)).toBeNull();
        });

        it('round-trips a multi-permission check cache, omitting unset entries', async () => {
            const actorUid = `actor-${uuidv4()}`;
            await store.setMultiCheckCache(
                actorUid,
                [
                    { permission: 'a', granted: true },
                    { permission: 'b', granted: false },
                ],
                1,
            );

            const hits = await store.getMultiCheckCache(
                actorUid,
                ['a', 'b', 'c'],
                1,
            );
            expect(hits.get('a')).toBe(true);
            expect(hits.get('b')).toBe(false);
            expect(hits.has('c')).toBe(false);
        });

        it('keys the check cache by generation so a bump misses every entry', async () => {
            const actorUid = `actor-${uuidv4()}`;
            await store.setMultiCheckCache(
                actorUid,
                [{ permission: 'a', granted: true }],
                1,
            );
            expect(
                (await store.getMultiCheckCache(actorUid, ['a'], 2)).size,
            ).toBe(0);
        });

        it('treats empty inputs as no-ops', async () => {
            const actorUid = `actor-${uuidv4()}`;
            await expect(
                store.setMultiCheckCache(actorUid, [], 0),
            ).resolves.toBeUndefined();
            expect((await store.getMultiCheckCache(actorUid, [], 0)).size).toBe(
                0,
            );
        });
    });

    // -- user → user ------------------------------------------------------

    describe('user-to-user permissions', () => {
        it('lists issuers for a holder and clears them on revoke', async () => {
            const issuer = await makeUser();
            const holder = await makeUser();
            await store.upsertUserUserPerm(
                holder.id,
                issuer.id,
                'fs:u:read',
                {},
            );

            expect(
                await store.listUserPermissionIssuerIds(holder.id),
            ).toContain(issuer.id);

            const rows = await store.readLinkedUserUserPerms(holder.id, [
                'fs:u:read',
            ]);
            expect(rows).toHaveLength(1);
            expect(rows[0].issuer_user_id).toBe(issuer.id);

            await store.deleteUserUserPermByHolder(holder.id, 'fs:u:read');
            expect(
                await store.readLinkedUserUserPerms(holder.id, ['fs:u:read']),
            ).toEqual([]);
        });

        it('returns nothing for an empty permission list', async () => {
            const holder = await makeUser();
            expect(await store.readLinkedUserUserPerms(holder.id, [])).toEqual(
                [],
            );
        });
    });
});
