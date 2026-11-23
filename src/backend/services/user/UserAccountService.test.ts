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

import { installSeatStub } from '../../testFixtures/seatStub.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupTestServer } from '../../testUtil.ts';
import { PuterServer } from '../../server.ts';

describe('UserAccountService', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const seedUser = async (overrides: Record<string, unknown> = {}) => {
        const slug = Math.random().toString(36).slice(2, 10);
        return server.stores.user.create({
            username: `ua_${slug}`,
            uuid: uuidv4(),
            password: 'hashed',
            email: `ua-${slug}@test.local`,
            clean_email: `ua-${slug}@test.local`,
            ...overrides,
        });
    };

    describe('cascadeDelete', () => {
        it('removes the row, its sessions and its cache entries', async () => {
            const user = await seedUser();
            await server.clients.db.write(
                'INSERT INTO `sessions` (`uuid`, `user_id`, `created_at`, `last_activity`) VALUES (?, ?, ?, ?)',
                [uuidv4(), user.id, Date.now(), Date.now()],
            );
            // Warm the address-keyed cache entry so a stale hit would show up.
            expect(
                (await server.stores.user.getByEmail(user.email as string))?.id,
            ).toBe(user.id);

            await server.services.userAccount.cascadeDelete(user.id);

            expect(await server.stores.user.getById(user.id)).toBeNull();
            expect(
                await server.stores.user.getByEmail(user.email as string),
            ).toBeNull();
            const sessions = (await server.clients.db.read(
                'SELECT COUNT(*) AS n FROM `sessions` WHERE `user_id` = ?',
                [user.id],
            )) as Array<{ n: number }>;
            expect(Number(sessions[0].n)).toBe(0);
        });

        it('announces the revoked sessions so open connections close', async () => {
            const user = await seedUser();
            const sessionUuid = uuidv4();
            await server.clients.db.write(
                'INSERT INTO `sessions` (`uuid`, `user_id`, `created_at`, `last_activity`) VALUES (?, ?, ?, ?)',
                [sessionUuid, user.id, Date.now(), Date.now()],
            );
            const announced: Array<{ user_id: number; session_uids: string[] }> =
                [];
            const listener = (_key: string, data: unknown) => {
                announced.push(
                    data as { user_id: number; session_uids: string[] },
                );
            };
            server.clients.event.on('outer.auth.sessions.revoked', listener);
            try {
                await server.services.userAccount.cascadeDelete(user.id);
            } finally {
                server.clients.event.off(
                    'outer.auth.sessions.revoked',
                    listener,
                );
            }
            expect(announced).toContainEqual({
                user_id: user.id,
                session_uids: [sessionUuid],
            });
        });

        /** A group with a grant, and `member` in it; returns the grant's row. */
        const seedGroupGrant = async (
            memberId: number,
            permission = `fs:${uuidv4()}:read`,
        ) => {
            const owner = await seedUser();
            const groupUid = uuidv4();
            await server.clients.db.write(
                'INSERT INTO `group` (`uid`, `owner_user_id`, `extra`, `metadata`) VALUES (?, ?, ?, ?)',
                [groupUid, owner.id, '{}', '{}'],
            );
            const [group] = (await server.clients.db.read(
                'SELECT `id` FROM `group` WHERE `uid` = ?',
                [groupUid],
            )) as Array<{ id: number }>;
            await server.clients.db.write(
                'INSERT INTO `jct_user_group` (`user_id`, `group_id`) VALUES (?, ?)',
                [memberId, group.id],
            );
            await server.clients.db.write(
                'INSERT INTO `user_to_group_permissions` (`user_id`, `group_id`, `permission`, `extra`) VALUES (?, ?, ?, ?)',
                [owner.id, group.id, permission, '{}'],
            );
            const [row] = await server.stores.permission.readUserGroupPerms(
                memberId,
                [permission],
            );
            expect(row).toBeDefined();
            return { owner, permission, row: { ...row, extra: '{}' } };
        };

        /** Replica reads of group grants keep returning `row`. */
        const lagGroupGrants = (row: Record<string, unknown>) => {
            const db = server.clients.db;
            const primaryRead = db.read.bind(db);
            const pread = vi
                .spyOn(db, 'pread')
                .mockImplementation((sql, params) => primaryRead(sql, params));
            const read = vi
                .spyOn(db, 'read')
                .mockImplementation(async (sql, params) =>
                    String(sql).includes('user_to_group_permissions')
                        ? [row]
                        : primaryRead(sql, params),
                );
            return () => {
                read.mockRestore();
                pread.mockRestore();
            };
        };

        /** The issuer holds `permission` itself, so what it grants resolves. */
        const holdOwn = (issuerId: number, permission: string) =>
            server.stores.permission.setFlatUserPerm(issuerId, permission, {
                permission,
                deleted: false,
                issuer_user_id: issuerId,
            } as never);

        const actorOf = async (userId: number) => {
            const user = (await server.stores.user.getById(userId))!;
            return { user: { ...user } } as never;
        };

        it("reads a group member's grant from the primary once its issuer is deleted", async () => {
            const member = await seedUser();
            const { owner, permission, row } = await seedGroupGrant(
                member.id,
                `zztest:del-${uuidv4()}:ii:read`,
            );
            // Sqlite reuses a deleted account's id; drop a mark left on it.
            await server.clients.redis.del(`perms:u2g:${member.id}:deleted`);

            await server.services.userAccount.cascadeDelete(owner.id);

            const restore = lagGroupGrants(row);
            try {
                expect(
                    await server.stores.permission.readUserGroupPerms(
                        member.id,
                        [permission],
                    ),
                ).toEqual([]);
            } finally {
                restore();
            }
        });

        it('refuses a member of a group the deleted account granted to, right after a check they passed', async () => {
            const member = await seedUser();
            const permission = `zztest:del-${uuidv4()}:ii:read`;
            const { owner, row } = await seedGroupGrant(member.id, permission);
            await holdOwn(owner.id, permission);
            const actor = await actorOf(member.id);
            expect(
                await server.services.permission.check(actor, permission),
            ).toBe(true);

            await server.services.userAccount.cascadeDelete(owner.id);

            const restore = lagGroupGrants(row);
            try {
                expect(
                    await server.services.permission.check(actor, permission),
                ).toBe(false);
            } finally {
                restore();
            }
        });

        it('refuses a holder of a grant the deleted account issued, right after a check they passed', async () => {
            const issuer = await seedUser();
            const holder = await seedUser();
            const permission = `zztest:del-${uuidv4()}:ii:read`;
            await holdOwn(issuer.id, permission);
            await server.stores.permission.upsertUserUserPerm(
                holder.id,
                issuer.id,
                permission,
                {},
            );
            await server.stores.permission.setFlatUserPerm(
                holder.id,
                permission,
                {
                    permission,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );
            const actor = await actorOf(holder.id);
            expect(
                await server.services.permission.check(actor, permission),
            ).toBe(true);

            await server.services.userAccount.cascadeDelete(issuer.id);

            expect(
                await server.services.permission.check(actor, permission),
            ).toBe(false);
        });

        it("reads the account's group grants from the primary once it is deleted", async () => {
            const member = await seedUser();
            const { permission, row } = await seedGroupGrant(member.id);

            await server.services.userAccount.cascadeDelete(member.id);

            // The replica still returns the membership; the primary has none.
            const db = server.clients.db;
            const primaryRead = db.read.bind(db);
            const pread = vi
                .spyOn(db, 'pread')
                .mockImplementation((sql, params) => primaryRead(sql, params));
            const read = vi
                .spyOn(db, 'read')
                .mockImplementation(async (sql, params) =>
                    String(sql).includes('user_to_group_permissions')
                        ? [row]
                        : primaryRead(sql, params),
                );
            try {
                expect(
                    await server.stores.permission.readUserGroupPerms(
                        member.id,
                        [permission],
                    ),
                ).toEqual([]);
            } finally {
                read.mockRestore();
                pread.mockRestore();
            }
        });

        it("drops the account's cached permission readings", async () => {
            const user = await seedUser();
            const before = await server.stores.permission.getCacheGeneration(
                `user:${user.uuid}`,
            );

            await server.services.userAccount.cascadeDelete(user.id);

            expect(
                await server.stores.permission.getCacheGeneration(
                    `user:${user.uuid}`,
                ),
            ).toBeGreaterThan(before);
        });

        it('finishes when the group mark cannot be written', async () => {
            const member = await seedUser();
            await seedGroupGrant(member.id);
            const mark = `perms:u2g:${member.id}:deleted`;

            const redis = server.clients.redis;
            const realPipeline = redis.pipeline.bind(redis);
            const pipeline = vi.spyOn(redis, 'pipeline').mockImplementation(((
                ...args: Parameters<typeof realPipeline>
            ) => {
                const p = realPipeline(...args);
                const set = p.set.bind(p) as (...a: unknown[]) => typeof p;
                let failing = false;
                (p as unknown as { set: unknown }).set = (...a: unknown[]) => {
                    if (a[0] === mark) failing = true;
                    return set(...a);
                };
                const exec = p.exec.bind(p);
                p.exec = (async () => {
                    if (failing) throw new Error('redis down');
                    return exec();
                }) as typeof p.exec;
                return p;
            }) as never);
            const warn = vi.spyOn(console, 'warn');
            try {
                await server.services.userAccount.cascadeDelete(member.id);
                expect(warn).toHaveBeenCalledWith(
                    expect.stringContaining('publishCacheKeys'),
                    [mark],
                );
            } finally {
                pipeline.mockRestore();
                warn.mockRestore();
            }
            expect(await server.stores.user.getById(member.id)).toBeNull();
        });

        it('refuses a holder who was checked while the flat entries were being purged', async () => {
            const issuer = await seedUser();
            const holder = await seedUser();
            const permission = `zztest:del-${uuidv4()}:ii:read`;
            await holdOwn(issuer.id, permission);
            await server.stores.permission.upsertUserUserPerm(
                holder.id,
                issuer.id,
                permission,
                {},
            );
            await server.stores.permission.setFlatUserPerm(
                holder.id,
                permission,
                {
                    permission,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );
            const actor = await actorOf(holder.id);

            const store = server.stores.permission;
            const delFlat = store.delFlatUserPerms.bind(store);
            const purge = vi
                .spyOn(store, 'delFlatUserPerms')
                .mockImplementation(async (entries) => {
                    // The row is gone; the flat entry still answers.
                    await server.services.permission.check(actor, permission);
                    return delFlat(entries);
                });
            try {
                await server.services.userAccount.cascadeDelete(issuer.id);
            } finally {
                purge.mockRestore();
            }

            expect(
                await server.services.permission.check(actor, permission),
            ).toBe(false);
        });

        it('refuses a holder whose issuer is gone though the flat entry stayed', async () => {
            const issuer = await seedUser();
            const holder = await seedUser();
            const permission = `zztest:del-${uuidv4()}:ii:read`;
            await holdOwn(issuer.id, permission);
            await server.stores.permission.upsertUserUserPerm(
                holder.id,
                issuer.id,
                permission,
                {},
            );
            await server.stores.permission.setFlatUserPerm(
                holder.id,
                permission,
                {
                    permission,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );

            // The purge fails, so the entry outlives its issuer.
            const purge = vi
                .spyOn(server.stores.permission, 'delFlatUserPerms')
                .mockRejectedValue(new Error('kv down'));
            try {
                await server.services.userAccount.cascadeDelete(issuer.id);
            } finally {
                purge.mockRestore();
            }
            expect(
                (
                    await server.stores.permission.getFlatUserPerms(holder.id, [
                        permission,
                    ])
                )[0]?.permission,
            ).toBe(permission);

            expect(
                await server.services.permission.check(
                    await actorOf(holder.id),
                    permission,
                ),
            ).toBe(false);
        });

        /** Deletes `issuerId` with the issued-grant flat purge failing. */
        const deleteLeavingFlatEntries = async (issuerId: number) => {
            const purge = vi
                .spyOn(server.stores.permission, 'delFlatUserPerms')
                .mockRejectedValue(new Error('kv down'));
            try {
                await server.services.userAccount.cascadeDelete(issuerId);
            } finally {
                purge.mockRestore();
            }
        };

        /** `holder` holds `permission` in the flat view, issued by `issuer`. */
        const flatGrant = async (
            holderId: number,
            issuerId: number,
            permission: string,
        ) => {
            await server.stores.permission.upsertUserUserPerm(
                holderId,
                issuerId,
                permission,
                {},
            );
            await server.stores.permission.setFlatUserPerm(
                holderId,
                permission,
                {
                    permission,
                    deleted: false,
                    issuer_user_id: issuerId,
                } as never,
            );
        };

        const insertEntry = async (
            ownerId: number,
            path: string,
            isDir: boolean,
        ) => {
            const uuid = uuidv4();
            await server.clients.db.write(
                'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    uuid,
                    path.split('/').pop(),
                    path,
                    ownerId,
                    server.clients.db.booleanValue(isDir),
                    Math.floor(Date.now() / 1000),
                ],
            );
            return uuid;
        };

        it("does not pass manage down a folder on a deleted re-sharer's leftover entry", async () => {
            const owner = await seedUser();
            const resharer = await seedUser();
            const holder = await seedUser();
            const dir = `/${owner.username}/d_${uuidv4().slice(0, 8)}`;
            const dirUid = await insertEntry(owner.id, dir, true);
            const fileUid = await insertEntry(owner.id, `${dir}/f.txt`, false);
            await flatGrant(holder.id, resharer.id, `manage:fs:${dirUid}`);
            const asked = `manage:fs:${fileUid}`;
            const actor = await actorOf(holder.id);
            expect(await server.services.permission.check(actor, asked)).toBe(
                true,
            );

            await deleteLeavingFlatEntries(resharer.id);

            expect(await server.services.permission.check(actor, asked)).toBe(
                false,
            );
        });

        it("does not pass manage down a folder on a deleted re-sharer's cached grant row", async () => {
            const owner = await seedUser();
            const resharer = await seedUser();
            const holder = await seedUser();
            const dir = `/${owner.username}/d_${uuidv4().slice(0, 8)}`;
            const dirUid = await insertEntry(owner.id, dir, true);
            const fileUid = await insertEntry(owner.id, `${dir}/f.txt`, false);
            await flatGrant(holder.id, resharer.id, `manage:fs:${dirUid}`);
            // An old grant: its write mark is gone and the holder's rows are cached.
            await server.clients.redis.del(
                `perms:u2u:holder:${holder.id}:deleted`,
            );
            await server.stores.permission.readLinkedUserUserPerms(holder.id, [
                `manage:fs:${dirUid}`,
            ]);
            await vi.waitFor(async () =>
                expect(
                    await server.clients.redis.get(
                        `perms:u2u:holder:${holder.id}`,
                    ),
                ).toContain(dirUid),
            );
            const asked = `manage:fs:${fileUid}`;
            const actor = await actorOf(holder.id);
            expect(await server.services.permission.check(actor, asked)).toBe(
                true,
            );

            await server.services.userAccount.cascadeDelete(resharer.id);

            expect(await server.services.permission.check(actor, asked)).toBe(
                false,
            );
        });

        it("does not list a share backed only by a deleted issuer's leftover entry", async () => {
            const owner = await seedUser();
            const issuer = await seedUser();
            const holder = await seedUser();
            const path = `/${owner.username}/s_${uuidv4().slice(0, 8)}.txt`;
            const uid = await insertEntry(owner.id, path, false);
            const entry = (await server.stores.fsEntry.getEntryByUuid(uid))!;
            // The owner's own grant is gone; only the index row is left of it.
            await server.clients.db.write(
                'INSERT INTO `share` (`uid`, `issuer_user_id`, `recipient_email`, `holder_user_id`, `fsentry_id`, `mode`, `applied_at`, `data`, `created_at`) ' +
                    'VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)',
                [
                    uuidv4(),
                    owner.id,
                    holder.email,
                    holder.id,
                    entry.id,
                    'read',
                    '{}',
                ],
            );
            await flatGrant(holder.id, issuer.id, `fs:${uid}:read`);
            const actor = await actorOf(holder.id);
            const listed = async () =>
                JSON.stringify(
                    (await server.services.share.listSharedWithMe(actor)).items,
                ).includes(uid);
            expect(await listed()).toBe(true);

            await deleteLeavingFlatEntries(issuer.id);

            expect(await listed()).toBe(false);
        });

        it("deletes a deleted issuer's leftover entry once a check finds it", async () => {
            const issuer = await seedUser();
            const holder = await seedUser();
            const permission = `zztest:del-${uuidv4()}:ii:read`;
            await holdOwn(issuer.id, permission);
            await flatGrant(holder.id, issuer.id, permission);
            await deleteLeavingFlatEntries(issuer.id);

            await server.services.permission.check(
                await actorOf(holder.id),
                permission,
            );

            await vi.waitFor(async () => {
                const [flat] = await server.stores.permission.getFlatUserPerms(
                    holder.id,
                    [permission],
                );
                expect(flat).toBeUndefined();
            });
        });

        it('clears the flat entries for grants the account issued', async () => {
            const issuer = await seedUser();
            const holder = await seedUser();
            const permission = `zztest:del-${uuidv4()}:ii:read`;

            await server.stores.permission.upsertUserUserPerm(
                holder.id,
                issuer.id,
                permission,
                {},
            );
            await server.stores.permission.setFlatUserPerm(
                holder.id,
                permission,
                {
                    permission,
                    deleted: false,
                    issuer_user_id: issuer.id,
                },
            );
            expect(
                (
                    await server.stores.permission.getFlatUserPerms(holder.id, [
                        permission,
                    ])
                )[0]?.permission,
            ).toBe(permission);

            await server.services.userAccount.cascadeDelete(issuer.id);

            // The SQL row cascades; without the purge the flat entry would
            // keep answering for an issuer nobody can ask about any more.
            const [flat] = await server.stores.permission.getFlatUserPerms(
                holder.id,
                [permission],
            );
            expect(flat?.permission).toBeUndefined();
        });

        it('clears the flat entry for a grant the replica has not seen yet', async () => {
            const issuer = await seedUser();
            const holder = await seedUser();
            const permission = `zztest:del-${uuidv4()}:ii:read`;
            await server.stores.permission.upsertUserUserPerm(
                holder.id,
                issuer.id,
                permission,
                {},
            );
            await server.stores.permission.setFlatUserPerm(
                holder.id,
                permission,
                {
                    permission,
                    deleted: false,
                    issuer_user_id: issuer.id,
                } as never,
            );

            const db = server.clients.db;
            const primaryRead = db.read.bind(db);
            const pread = vi
                .spyOn(db, 'pread')
                .mockImplementation((sql, params) => primaryRead(sql, params));
            const read = vi
                .spyOn(db, 'read')
                .mockImplementation(async (sql, params) =>
                    String(sql).includes('FROM `user_to_user_permissions`')
                        ? []
                        : primaryRead(sql, params),
                );
            try {
                await server.services.userAccount.cascadeDelete(issuer.id);
            } finally {
                read.mockRestore();
                pread.mockRestore();
            }

            const [flat] = await server.stores.permission.getFlatUserPerms(
                holder.id,
                [permission],
            );
            expect(flat?.permission).toBeUndefined();
        });

        it('clears the flat entries for grants the account held', async () => {
            const holder = await seedUser();
            const issuer = await seedUser();
            const otherHolder = await seedUser();
            const permissions = [
                `zztest:held-${uuidv4()}:a:read`,
                `zztest:held-${uuidv4()}:b:write`,
            ];
            const value = (permission: string) => ({
                permission,
                deleted: false,
                issuer_user_id: issuer.id,
            });
            for (const permission of permissions)
                await server.stores.permission.setFlatUserPerm(
                    holder.id,
                    permission,
                    value(permission),
                );
            await server.stores.permission.setFlatUserPerm(
                otherHolder.id,
                permissions[0],
                value(permissions[0]),
            );

            await server.services.userAccount.cascadeDelete(holder.id);

            expect(
                await server.stores.permission.getFlatUserPerms(
                    holder.id,
                    permissions,
                ),
            ).toEqual([]);
            expect(
                await server.stores.permission.getFlatUserPerms(
                    otherHolder.id,
                    [permissions[0]],
                ),
            ).toHaveLength(1);
        });

        it('deletes the account’s sites, announcing each one', async () => {
            const user = await seedUser();
            const slug = Math.random().toString(36).slice(2, 10);
            const site = await server.stores.subdomain.create({
                userId: user.id,
                subdomain: `ua-site-${slug}`,
            });
            const worker = await server.stores.subdomain.create({
                userId: user.id,
                subdomain: `workers.puter.ua-worker-${slug}`,
            });
            // Warm the lookup cache so a row surviving there would show up.
            expect(
                (await server.stores.subdomain.getBySubdomain(site.subdomain))
                    ?.uuid,
            ).toBe(site.uuid);

            const emitSpy = vi.spyOn(server.clients.event, 'emit');
            try {
                await server.services.userAccount.cascadeDelete(user.id);

                const emitted = emitSpy.mock.calls.map(([key, data]) => ({
                    key,
                    data,
                }));
                const deletes = emitted.filter(
                    (e) => e.key === 'subdomain.delete',
                );
                expect(deletes.map((e) => e.data)).toEqual(
                    expect.arrayContaining([
                        {
                            subdomain: site.subdomain,
                            uid: site.uuid,
                            userId: user.id,
                        },
                        {
                            subdomain: worker.subdomain,
                            uid: worker.uuid,
                            userId: user.id,
                        },
                    ]),
                );
                // Listeners keyed on the user still see the sites go first.
                const userDeleteAt = emitted.findIndex(
                    (e) => e.key === 'user.delete',
                );
                expect(userDeleteAt).toBeGreaterThan(
                    emitted.lastIndexOf(deletes[deletes.length - 1]!),
                );
            } finally {
                emitSpy.mockRestore();
            }

            expect(
                await server.stores.subdomain.getBySubdomain(site.subdomain),
            ).toBeNull();
        });

        it("drops the cached sites that go with the account's apps", async () => {
            const developer = await seedUser();
            const siteOwner = await seedUser();
            const app = await server.stores.app.create(
                {
                    name: `ua-app-${uuidv4()}`,
                    title: 'Hosting',
                    index_url: `https://${uuidv4()}.example.com/`,
                },
                { ownerUserId: developer.id },
            );
            const site = await server.stores.subdomain.create({
                userId: siteOwner.id,
                subdomain: `ua-app-site-${Math.random().toString(36).slice(2, 10)}`,
                appOwner: app.id,
            });

            const cacheKey = `subdomains:name:${site.subdomain}`;
            expect(await server.clients.redis.get(cacheKey)).not.toBeNull();

            await server.services.userAccount.cascadeDelete(developer.id);

            // SQLite keeps the app and its site (MySQL and Postgres cascade
            // both); either way the cached copy has to go.
            expect(await server.clients.redis.get(cacheKey)).toBeNull();
        });

        it('finishes when dropping the seat caches fails', async () => {
            const user = await seedUser();
            installSeatStub(server as never, [user.id]);
            const capture = vi
                .spyOn(server.services.team as never, 'captureSeatForBilling')
                .mockResolvedValue({
                    team_uid: `team-${uuidv4()}`,
                    owner_user_id: 1,
                    user_id: user.id,
                    user_uuid: user.uuid,
                    username: user.username,
                });
            const lookup = vi
                .spyOn(server.stores.team as never, 'getByUid')
                .mockRejectedValue(new Error('store down'));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                await expect(
                    server.services.userAccount.cascadeDelete(user.id),
                ).resolves.toBeUndefined();
            } finally {
                capture.mockRestore();
                lookup.mockRestore();
                warn.mockRestore();
            }
            expect(await server.stores.user.getById(user.id)).toBeNull();
        });

        // Each teardown step is stepped over: a half-deleted account is worse
        // than whatever the failed step leaves behind.
        it.each([
            {
                step: 'file cleanup',
                target: () => server.services.fs,
                method: 'removeAllForUser',
                warning: '[cascade-delete-user] fs cleanup failed:',
            },
            {
                step: 'site cleanup',
                target: () => server.stores.subdomain,
                method: 'listByUserId',
                warning: '[cascade-delete-user] subdomain cleanup failed:',
            },
            {
                step: 'owned-app lookup',
                target: () => server.stores.app,
                method: 'list',
                warning: '[cascade-delete-user] owned-app lookup failed:',
            },
            {
                step: 'kv share retirement',
                target: () => server.services.kvShare,
                method: 'retireForDeletedHolder',
                warning: '[cascade-delete-user] kv share retire failed:',
            },
            {
                step: 'issued-grant lookup',
                target: () => server.stores.permission,
                method: 'listUserUserPermRefsIssuedBy',
                warning: '[cascade-delete-user] issued-grant lookup failed:',
            },
            {
                step: 'held-grant purge',
                target: () => server.stores.permission,
                method: 'purgeFlatUserPermsHeldBy',
                warning: '[cascade-delete-user] held-grant flat purge failed:',
            },
        ])(
            'still deletes the account when $step fails',
            async ({ target, method, warning }) => {
                const user = await seedUser();
                const failing = vi
                    .spyOn(target() as never, method as never)
                    .mockRejectedValue(new Error('dependency down') as never);
                const warn = vi
                    .spyOn(console, 'warn')
                    .mockImplementation(() => {});
                const deleted: unknown[] = [];
                const emitSpy = vi.spyOn(server.clients.event, 'emit');
                try {
                    await server.services.userAccount.cascadeDelete(user.id);
                    expect(failing).toHaveBeenCalled();
                    expect(warn).toHaveBeenCalledWith(
                        warning,
                        expect.any(Error),
                    );
                    deleted.push(
                        ...emitSpy.mock.calls
                            .filter(([key]) => key === 'user.delete')
                            .map(([, payload]) => payload),
                    );
                } finally {
                    failing.mockRestore();
                    warn.mockRestore();
                    emitSpy.mockRestore();
                }
                expect(
                    await server.stores.user.getById(user.id, { force: true }),
                ).toBeNull();
                expect(deleted).toEqual([
                    expect.objectContaining({
                        user_id: user.id,
                        user_uuid: user.uuid,
                    }),
                ]);
            },
        );

        it('still deletes the account when purging its issued flat grants fails', async () => {
            const issuer = await seedUser();
            const holder = await seedUser();
            await server.stores.permission.upsertUserUserPerm(
                holder.id,
                issuer.id,
                `zztest:del-${uuidv4()}:ii:read`,
                {},
            );
            const failing = vi
                .spyOn(server.stores.permission, 'delFlatUserPerms')
                .mockRejectedValue(new Error('dependency down'));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                await server.services.userAccount.cascadeDelete(issuer.id);
                expect(warn).toHaveBeenCalledWith(
                    '[cascade-delete-user] issued-grant flat purge failed:',
                    expect.any(Error),
                );
            } finally {
                failing.mockRestore();
                warn.mockRestore();
            }
            expect(
                await server.stores.user.getById(issuer.id, { force: true }),
            ).toBeNull();
        });

        it('deletes the account, announcing it without identifiers, when they cannot be read', async () => {
            const user = await seedUser();
            // Warm the id-keyed entry: with no row to name the keys, it is what
            // the delete falls back on.
            await server.stores.user.getById(user.id);
            const pread = server.clients.db.pread.bind(server.clients.db);
            const failing = vi
                .spyOn(server.clients.db, 'pread')
                .mockImplementation(async (sql: string, ...rest: never[]) => {
                    if (sql.startsWith('SELECT * FROM `user` WHERE `id` = ?'))
                        throw new Error('primary down');
                    return (pread as (...args: unknown[]) => never)(
                        sql,
                        ...rest,
                    );
                });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const emitSpy = vi.spyOn(server.clients.event, 'emit');
            let announced: unknown[] = [];
            try {
                await server.services.userAccount.cascadeDelete(user.id);
                expect(warn).toHaveBeenCalledWith(
                    '[cascade-delete-user] identifier lookup failed:',
                    expect.any(Error),
                );
                announced = emitSpy.mock.calls
                    .filter(([key]) => key === 'user.delete')
                    .map(([, payload]) => payload);
            } finally {
                failing.mockRestore();
                warn.mockRestore();
                emitSpy.mockRestore();
            }
            expect(announced).toEqual([
                {
                    user_id: user.id,
                    user_uuid: undefined,
                    stripe_customer_id: null,
                    appUids: [],
                },
            ]);
            expect(await server.stores.user.getById(user.id)).toBeNull();
        });

        it('finishes when a user.delete listener throws', async () => {
            const user = await seedUser();
            const emit = server.clients.event.emit.bind(server.clients.event);
            const emitSpy = vi
                .spyOn(server.clients.event, 'emit')
                .mockImplementation(((key: string, ...rest: unknown[]) => {
                    if (key === 'user.delete') throw new Error('bus down');
                    return (emit as (...args: unknown[]) => unknown)(
                        key,
                        ...rest,
                    );
                }) as never);
            try {
                await expect(
                    server.services.userAccount.cascadeDelete(user.id),
                ).resolves.toBeUndefined();
            } finally {
                emitSpy.mockRestore();
            }
            expect(
                await server.stores.user.getById(user.id, { force: true }),
            ).toBeNull();
        });

        it("records the account's apps as deleted", async () => {
            const user = await seedUser();
            const app = await server.stores.app.create(
                {
                    name: `ua-app-${uuidv4()}`,
                    title: 'Owned',
                    index_url: `https://${uuidv4()}.example.com/`,
                },
                { ownerUserId: user.id },
            );

            await server.services.userAccount.cascadeDelete(user.id);

            expect(
                (await server.stores.app.getDeletedOwnersByUids([app.uid])).get(
                    app.uid,
                ),
            ).toBe(user.id);
        });

        it('frees the address for a new account', async () => {
            const user = await seedUser();
            const email = user.email as string;
            await server.services.userAccount.cascadeDelete(user.id);

            // The unique index would reject this if the row survived.
            await expect(
                server.stores.user.create({
                    username: `ua_reuse_${Math.random().toString(36).slice(2, 8)}`,
                    uuid: uuidv4(),
                    password: 'hashed',
                    email,
                    clean_email: email,
                }),
            ).resolves.toBeTruthy();
        });
    });
});
