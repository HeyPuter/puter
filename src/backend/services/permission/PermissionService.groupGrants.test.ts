/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import { PermissionService } from './PermissionService.js';

describe('PermissionService group grants', () => {
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

    type TestUser = { id: number; uuid: string; username: string };

    const makeUserActor = async (): Promise<{
        user: TestUser;
        actor: Actor;
    }> => {
        const username = `pg-${Math.random().toString(36).slice(2, 10)}`;
        const u = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            requires_email_confirmation: false,
        });
        const user = { id: u.id, uuid: u.uuid, username: u.username };
        return { user, actor: { user: { ...user, email: u.email ?? null } } };
    };

    const makeGroup = async (
        owner: TestUser,
        members: TestUser[] = [],
    ): Promise<{ uid: string; id: number }> => {
        const uid = uuidv4();
        await server.clients.db.write(
            'INSERT INTO `group` (`uid`, `owner_user_id`, `extra`, `metadata`) ' +
                'VALUES (?, ?, ?, ?)',
            [uid, owner.id, '{}', '{}'],
        );
        const [group] = await server.clients.db.read(
            'SELECT `id` FROM `group` WHERE `uid` = ?',
            [uid],
        );
        await server.stores.group.addUsers(
            uid,
            members.map((member) => member.username),
        );
        return { uid, id: Number(group.id) };
    };

    /** The issuer holds the permission and may hand it on. */
    const holdAndManage = async (user: TestUser, permission: string) => {
        for (const held of [permission, `manage:${permission}`]) {
            await server.stores.permission.setFlatUserPerm(user.id, held, {
                permission: held,
                deleted: false,
                issuer_user_id: user.id,
            } as never);
        }
    };

    const grant = (
        actor: Actor,
        groupUid: string,
        permission: string,
        ...rest: [extra?: Record<string, unknown>, meta?: { reason?: string }]
    ) =>
        runWithContext({ actor }, () =>
            permService.grantUserGroupPermission(
                actor,
                groupUid,
                permission,
                ...rest,
            ),
        );

    const revoke = (
        actor: Actor,
        groupUid: string,
        permission: string,
        ...rest: [meta?: { reason?: string }, opts?: { issuerUserId?: number }]
    ) =>
        runWithContext({ actor }, () =>
            permService.revokeUserGroupPermission(
                actor,
                groupUid,
                permission,
                ...rest,
            ),
        );

    const grantRows = (groupId: number, permission: string) =>
        server.clients.db.read(
            'SELECT `user_id`, `extra` FROM `user_to_group_permissions` ' +
                'WHERE `group_id` = ? AND `permission` = ?',
            [groupId, permission],
        );

    const auditRows = (groupId: number, permission: string) =>
        server.clients.db.read(
            'SELECT `user_id`, `action`, `reason` FROM `audit_user_to_group_permissions` ' +
                'WHERE `group_id` = ? AND `permission` = ? ORDER BY `id`',
            [groupId, permission],
        );

    const revokedEvents = (emit: { mock: { calls: unknown[][] } }) =>
        emit.mock.calls
            .filter(([key]) => key === 'permission.revoked')
            .map(([, data]) => data);

    it('refuses a grant or a revoke on a group that does not exist', async () => {
        const { user, actor } = await makeUserActor();
        const permission = `zztest:grp-missing-${uuidv4()}:ii:read`;
        await holdAndManage(user, permission);
        const groupUid = uuidv4();
        const refusal = {
            statusCode: 404,
            legacyCode: 'subject_does_not_exist',
            message: `group_does_not_exist: ${groupUid}`,
        };

        await expect(grant(actor, groupUid, permission)).rejects.toMatchObject(
            refusal,
        );
        await expect(revoke(actor, groupUid, permission)).rejects.toMatchObject(
            refusal,
        );
    });

    it('refuses an issuer who may not manage the permission, writing nothing', async () => {
        const { user: owner } = await makeUserActor();
        const { user: member } = await makeUserActor();
        const { actor: outsider } = await makeUserActor();
        const group = await makeGroup(owner, [member]);
        const permission = `zztest:grp-unmanaged-${uuidv4()}:ii:read`;
        const refusal = {
            statusCode: 403,
            legacyCode: 'permission_denied',
            message: `permission_denied: ${permission}`,
        };

        await expect(
            grant(outsider, group.uid, permission),
        ).rejects.toMatchObject(refusal);
        await expect(
            revoke(outsider, group.uid, permission),
        ).rejects.toMatchObject(refusal);
        expect(await grantRows(group.id, permission)).toEqual([]);
    });

    it('refuses an actor that is not a user', async () => {
        const { user: owner } = await makeUserActor();
        const group = await makeGroup(owner);

        await expect(
            permService.revokeUserGroupPermission(
                { user: {} } as Actor,
                group.uid,
                `zztest:grp-nouser-${uuidv4()}:ii:read`,
            ),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'forbidden',
            message: 'actor must be a user',
        });
    });

    it('grants to every member at once, past a cached denial', async () => {
        const { user: issuer, actor: issuerActor } = await makeUserActor();
        const { user: member, actor: memberActor } = await makeUserActor();
        const { actor: strangerActor } = await makeUserActor();
        const group = await makeGroup(issuer, [member]);
        const permission = `zztest:grp-grant-${uuidv4()}:ii:read`;
        await holdAndManage(issuer, permission);

        // Cached as denied; the grant has to orphan this reading.
        expect(await permService.check(memberActor, permission)).toBeFalsy();

        await grant(issuerActor, group.uid, permission, { note: 'team' });

        expect(await permService.check(memberActor, permission)).toBe(true);
        expect(await permService.check(strangerActor, permission)).toBeFalsy();
        const rows = await grantRows(group.id, permission);
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].user_id)).toBe(issuer.id);
        expect(
            typeof rows[0].extra === 'string'
                ? JSON.parse(rows[0].extra)
                : rows[0].extra,
        ).toEqual({ note: 'team' });

        // The audit write is off the critical path.
        await vi.waitFor(async () => {
            expect(await auditRows(group.id, permission)).toEqual([
                expect.objectContaining({
                    action: 'grant',
                    reason: 'granted via PermissionService',
                }),
            ]);
        });
    });

    it('stores a grant to a group nobody has joined yet', async () => {
        const { user: issuer, actor: issuerActor } = await makeUserActor();
        const group = await makeGroup(issuer);
        const permission = `zztest:grp-empty-${uuidv4()}:ii:read`;
        await holdAndManage(issuer, permission);

        await grant(issuerActor, group.uid, permission);
        expect(await grantRows(group.id, permission)).toHaveLength(1);

        // Whoever joins later gets it.
        const { user: late, actor: lateActor } = await makeUserActor();
        await server.stores.group.addUsers(group.uid, [late.username]);
        expect(await permService.check(lateActor, permission)).toBe(true);
    });

    it('revokes for every member, announcing each, and reports a no-op as one', async () => {
        const { user: issuer, actor: issuerActor } = await makeUserActor();
        const { user: first, actor: firstActor } = await makeUserActor();
        const { user: second, actor: secondActor } = await makeUserActor();
        const group = await makeGroup(issuer, [first, second]);
        const permission = `zztest:grp-revoke-${uuidv4()}:ii:read`;
        await holdAndManage(issuer, permission);
        await grant(issuerActor, group.uid, permission);
        // Cached as allowed; the revoke has to orphan both readings.
        expect(await permService.check(firstActor, permission)).toBe(true);
        expect(await permService.check(secondActor, permission)).toBe(true);

        const emit = vi.spyOn(server.clients.event, 'emit');
        try {
            expect(
                await revoke(issuerActor, group.uid, permission, {
                    reason: 'team disbanded',
                }),
            ).toBe(true);
            expect(
                revokedEvents(emit).sort(
                    (a, b) =>
                        (a as { holderUserId: number }).holderUserId -
                        (b as { holderUserId: number }).holderUserId,
                ),
            ).toEqual(
                [first.id, second.id]
                    .sort((a, b) => a - b)
                    .map((holderUserId) => ({
                        holderUserId,
                        appUid: null,
                        permission,
                    })),
            );

            emit.mockClear();
            expect(await revoke(issuerActor, group.uid, permission)).toBe(
                false,
            );
            expect(revokedEvents(emit)).toEqual([]);
        } finally {
            emit.mockRestore();
        }

        expect(await permService.check(firstActor, permission)).toBeFalsy();
        expect(await permService.check(secondActor, permission)).toBeFalsy();
        expect(await grantRows(group.id, permission)).toEqual([]);
        await vi.waitFor(async () => {
            const audited = await auditRows(group.id, permission);
            expect(
                audited.map((row) => [row.action, row.reason]),
            ).toContainEqual(['revoke', 'team disbanded']);
        });
    });

    it('revokes only the named issuer`s grant', async () => {
        const { user: owner, actor: ownerActor } = await makeUserActor();
        const { user: delegate, actor: delegateActor } = await makeUserActor();
        const { user: member, actor: memberActor } = await makeUserActor();
        const group = await makeGroup(owner, [member]);
        const permission = `zztest:grp-issuers-${uuidv4()}:ii:read`;
        await holdAndManage(owner, permission);
        await holdAndManage(delegate, permission);
        await grant(ownerActor, group.uid, permission);
        await grant(delegateActor, group.uid, permission);

        // The owner clears the delegate's row without touching its own.
        expect(
            await revoke(
                ownerActor,
                group.uid,
                permission,
                {},
                { issuerUserId: delegate.id },
            ),
        ).toBe(true);
        const left = await grantRows(group.id, permission);
        expect(left.map((row) => Number(row.user_id))).toEqual([owner.id]);
        expect(await permService.check(memberActor, permission)).toBe(true);

        expect(await revoke(ownerActor, group.uid, permission)).toBe(true);
        expect(await permService.check(memberActor, permission)).toBeFalsy();
    });

    it('lists what an issuer granted a group under a prefix', async () => {
        const { user: issuer, actor: issuerActor } = await makeUserActor();
        const { user: other, actor: otherActor } = await makeUserActor();
        const group = await makeGroup(issuer);
        const tag = uuidv4();
        const inside = `zztest:grp-query-${tag}:a:read`;
        const outside = `zztest:grp-other-${tag}:a:read`;
        const theirs = `zztest:grp-query-${tag}:b:read`;
        for (const permission of [inside, outside])
            await holdAndManage(issuer, permission);
        await holdAndManage(other, theirs);
        await grant(issuerActor, group.uid, inside);
        await grant(issuerActor, group.uid, outside);
        await grant(otherActor, group.uid, theirs);
        const prefix = `zztest:grp-query-${tag}`;

        expect(
            await permService.queryIssuerGroupPermissionsByPrefix(
                issuerActor,
                group.uid,
                prefix,
            ),
        ).toEqual([inside]);
        expect(
            await permService.queryIssuerGroupPermissionsByPrefix(
                issuerActor,
                uuidv4(),
                prefix,
            ),
        ).toEqual([]);
        expect(
            await permService.queryIssuerGroupPermissionsByPrefix(
                { user: undefined } as unknown as Actor,
                group.uid,
                prefix,
            ),
        ).toEqual([]);
    });

    it('still grants when the audit write fails, and says the row was lost', async () => {
        const { user: issuer, actor: issuerActor } = await makeUserActor();
        const { user: member, actor: memberActor } = await makeUserActor();
        const group = await makeGroup(issuer, [member]);
        const permission = `zztest:grp-audit-${uuidv4()}:ii:read`;
        await holdAndManage(issuer, permission);

        const db = server.clients.db;
        const realWrite = db.write.bind(db);
        const failure = new Error('audit table unavailable');
        const write = vi
            .spyOn(db, 'write')
            .mockImplementation((sql, params) =>
                String(sql).includes('audit_user_to_group_permissions')
                    ? Promise.reject(failure)
                    : realWrite(sql, params),
            );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await grant(issuerActor, group.uid, permission);
            await vi.waitFor(() =>
                expect(warn).toHaveBeenCalledWith(
                    '[PermissionService] failed to audit user-group grant:',
                    failure,
                ),
            );
        } finally {
            write.mockRestore();
            warn.mockRestore();
        }

        expect(await permService.check(memberActor, permission)).toBe(true);
        expect(await auditRows(group.id, permission)).toEqual([]);
    });

    it('still revokes when announcing it fails', async () => {
        const { user: issuer, actor: issuerActor } = await makeUserActor();
        const { user: member, actor: memberActor } = await makeUserActor();
        const group = await makeGroup(issuer, [member]);
        const permission = `zztest:grp-announce-${uuidv4()}:ii:read`;
        await holdAndManage(issuer, permission);
        await grant(issuerActor, group.uid, permission);

        const event = server.clients.event;
        const realEmit = event.emit.bind(event);
        const failure = new Error('listener registry unavailable');
        const emit = vi
            .spyOn(event, 'emit')
            .mockImplementation((key, data, meta) => {
                if (key === 'permission.revoked') throw failure;
                return realEmit(key, data, meta);
            });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(await revoke(issuerActor, group.uid, permission)).toBe(true);
            expect(warn).toHaveBeenCalledWith(
                '[PermissionService] revoke announce failed:',
                failure,
            );
        } finally {
            emit.mockRestore();
            warn.mockRestore();
        }

        expect(await permService.check(memberActor, permission)).toBeFalsy();
    });
});
