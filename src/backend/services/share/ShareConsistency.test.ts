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

/**
 * Cross-store consistency for sharing.
 *
 * A share is three writes in two stores plus a cache: the flat KV grant (the
 * terminal answer), the SQL delegation row, and the SQL share index, with a
 * Redis generation counter invalidating the scan cache. Every consistency bug
 * in this feature lives in the gaps between them, so each case here snapshots
 * all four around the action and asserts the invariants from
 * FILE-SHARING-TEST-PLAN.md §1.
 *
 * Set SHARE_REPORT=<path> to write the before/after tables out as markdown.
 */

import { writeFileSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { createTestUser, setupTestServer } from '../../testUtil.js';
import { PermissionUtil } from '../permission/permissionUtil';

const MODES = ['see', 'list', 'read', 'write'] as const;

interface Party {
    label: string;
    id: number;
    uuid: string;
    username: string;
    actor: Actor;
    email: string;
}

interface Snapshot {
    kv: Record<string, string>;
    sqlPerms: Record<string, string>;
    sqlIndex: Record<string, string>;
    redisGen: Record<string, number>;
    canRead: Record<string, boolean>;
}

const report: string[] = [];

describe('share consistency across KV, SQL and Redis', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        const out = process.env.SHARE_REPORT;
        if (out) writeFileSync(out, report.join('\n'));
        await server?.shutdown();
    });

    const makeParty = async (label: string): Promise<Party> => {
        const username = `p${label.toLowerCase()}${Math.random().toString(36).slice(2, 8)}`;
        await createTestUser(server, { username, password: 'pw-test-1234' });
        const found = await server.stores.user.getByUsername(username);
        if (!found) throw new Error('test user missing');
        const email = `${username}@test.local`;
        await server.stores.user.update(found.id, {
            email,
            email_confirmed: true,
        });
        const user = await server.stores.user.getById(found.id, {
            force: true,
        });
        return {
            label,
            id: user!.id,
            uuid: user!.uuid,
            username,
            email,
            actor: { user: user as Actor['user'], effectiveApp: null },
        };
    };

    const makeEntry = async (owner: Party, isDir = false, parent?: string) => {
        const uuid = uuidv4();
        const name = `${isDir ? 'd' : 'f'}-${uuid.slice(0, 8)}${isDir ? '' : '.txt'}`;
        const base = parent ?? `/${owner.username}`;
        const path = `${base}/${name}`;
        await server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, ?, ?)',
            [
                uuid,
                name,
                path,
                owner.id,
                isDir ? 1 : 0,
                Math.floor(Date.now() / 1000),
            ],
        );
        const entry = await server.stores.fsEntry.getEntryByPath(path);
        if (!entry) throw new Error('fsentry not created');
        return entry;
    };

    const canRead = (actor: Actor, path: string) =>
        server.services.acl.check(
            actor,
            {
                path,
                resolveAncestors: () =>
                    server.services.fs.getAncestorChain(path),
            },
            'read',
        );

    /** All four layers, for one entry and a fixed cast. */
    const snapshot = async (
        parties: Party[],
        entry: { id: number; uuid: string; path: string },
    ): Promise<Snapshot> => {
        const kv: Record<string, string> = {};
        for (const p of parties) {
            for (const mode of [
                ...MODES.map((m) => `fs:${entry.uuid}:${m}`),
                `manage:fs:${entry.uuid}`,
            ]) {
                const key = PermissionUtil.join('perm', String(p.id), mode);
                const got = await server.stores.kv.get({ key });
                const val = (got as { res?: unknown })?.res ?? got;
                if (val !== null && val !== undefined) {
                    const short = mode.startsWith('manage:')
                        ? 'manage'
                        : mode.split(':').pop()!;
                    // A flat key is either an authoritative grant (`deleted`
                    // present, no expiry) or a 60s warm-cache entry derived
                    // from the SQL scan. Only the first is a share.
                    const v = val as { deleted?: boolean; data?: unknown };
                    kv[`${p.label}:${short}`] =
                        v.deleted === undefined
                            ? 'warm'
                            : v.deleted
                              ? 'tombstone'
                              : 'grant';
                }
            }
        }

        const permRows = (await server.clients.db.read(
            'SELECT holder_user_id, issuer_user_id, permission FROM `user_to_user_permissions` WHERE `permission` LIKE ?',
            [`%${entry.uuid}%`],
        )) as Array<{
            holder_user_id: number;
            issuer_user_id: number;
            permission: string;
        }>;
        const byId = new Map(parties.map((p) => [p.id, p.label]));
        const sqlPerms: Record<string, string> = {};
        for (const r of permRows) {
            const mode = r.permission.startsWith('manage:')
                ? 'manage'
                : r.permission.split(':').pop()!;
            sqlPerms[
                `${byId.get(r.holder_user_id) ?? r.holder_user_id}:${mode}`
            ] = `from ${byId.get(r.issuer_user_id) ?? r.issuer_user_id}`;
        }

        const indexRows = (await server.clients.db.read(
            'SELECT holder_user_id, issuer_user_id, mode FROM `share` WHERE `fsentry_id` = ?',
            [entry.id],
        )) as Array<{
            holder_user_id: number;
            issuer_user_id: number;
            mode: string;
        }>;
        const sqlIndex: Record<string, string> = {};
        for (const r of indexRows) {
            sqlIndex[`${byId.get(r.holder_user_id) ?? r.holder_user_id}`] =
                `${r.mode} from ${byId.get(r.issuer_user_id) ?? r.issuer_user_id}`;
        }

        const redisGen: Record<string, number> = {};
        for (const p of parties) {
            redisGen[p.label] =
                await server.stores.permission.getCacheGeneration(
                    `user:${p.uuid}`,
                );
        }

        const reads: Record<string, boolean> = {};
        for (const p of parties)
            reads[p.label] = await canRead(p.actor, entry.path);

        return { kv, sqlPerms, sqlIndex, redisGen, canRead: reads };
    };

    const fmt = (s: Snapshot) => ({
        'KV (flat grants)': Object.keys(s.kv).length
            ? JSON.stringify(s.kv)
            : '—',
        'SQL user_to_user_permissions': Object.keys(s.sqlPerms).length
            ? JSON.stringify(s.sqlPerms)
            : '—',
        'SQL share (index)': Object.keys(s.sqlIndex).length
            ? JSON.stringify(s.sqlIndex)
            : '—',
        'Redis cachegen': JSON.stringify(s.redisGen),
        'acl.check(read)': JSON.stringify(s.canRead),
    });

    const record = (
        title: string,
        note: string,
        before: Snapshot,
        after: Snapshot,
    ) => {
        const b = fmt(before);
        const a = fmt(after);
        report.push(
            `\n### ${title}\n`,
            note,
            '',
            '| Layer | Before | After |',
            '| --- | --- | --- |',
        );
        for (const k of Object.keys(b)) {
            report.push(
                `| ${k} | \`${b[k as keyof typeof b]}\` | \`${a[k as keyof typeof a]}\` |`,
            );
        }
    };

    /**
     * I1/I3/I5 from the plan, checked against whatever the stores currently
     * hold. Every case ends with this — a scenario that leaves the layers
     * disagreeing is a failure even when its own assertions pass.
     */
    const assertInvariants = async (
        parties: Party[],
        entry: { id: number; uuid: string },
        owner: Party,
    ) => {
        const indexRows = (await server.clients.db.read(
            'SELECT holder_user_id, issuer_user_id, mode FROM `share` WHERE `fsentry_id` = ?',
            [entry.id],
        )) as Array<{
            holder_user_id: number;
            issuer_user_id: number;
            mode: string;
        }>;

        for (const row of indexRows) {
            // I5 — the owner's access comes from ownership, never a grant row.
            expect(row.holder_user_id).not.toBe(owner.id);

            // I1 — an index row must have both a KV grant and a SQL row behind it.
            const perm =
                row.mode === 'manage'
                    ? `manage:fs:${entry.uuid}`
                    : `fs:${entry.uuid}:${row.mode}`;
            const key = PermissionUtil.join(
                'perm',
                String(row.holder_user_id),
                perm,
            );
            const kvVal = await server.stores.kv.get({ key });
            expect((kvVal as { res?: unknown })?.res ?? kvVal).toBeTruthy();

            const sql = (await server.clients.db.read(
                'SELECT permission FROM `user_to_user_permissions` WHERE `holder_user_id` = ? AND `issuer_user_id` = ? AND `permission` = ?',
                [row.holder_user_id, row.issuer_user_id, perm],
            )) as unknown[];
            expect(sql.length).toBeGreaterThan(0);
        }

        // I6 — never two live *granted* modes for the same (holder, entry).
        // Warm-cache entries are excluded: the scan derives implied modes from
        // the granted one, so `write` legitimately warms `read` alongside it.
        for (const p of parties) {
            const granted = [] as string[];
            for (const mode of MODES) {
                const key = PermissionUtil.join(
                    'perm',
                    String(p.id),
                    `fs:${entry.uuid}:${mode}`,
                );
                const got = await server.stores.kv.get({ key });
                const val = (got as { res?: unknown })?.res ?? got;
                if ((val as { deleted?: boolean })?.deleted === false)
                    granted.push(mode);
            }
            expect(granted.length).toBeLessThanOrEqual(1);
        }
    };

    const share = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () =>
            server.services.share.share(actor, input as never),
        );
    const unshare = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () =>
            server.services.share.unshare(actor, input as never),
        );

    describe('granting access', () => {
        it('writes the grant, the row and the index together', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);
            const cast = [A, B];

            const before = await snapshot(cast, entry);
            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });
            const after = await snapshot(cast, entry);

            record(
                'A shares a file with B, read-only',
                "The baseline. All three stores must gain the grant, and B's cache generation must move so any cached deny is retired.",
                before,
                after,
            );

            expect(before.canRead.B).toBe(false);
            expect(after.canRead.B).toBe(true);
            expect(after.kv['B:read']).toBe('grant');
            expect(after.sqlPerms['B:read']).toBeDefined();
            expect(after.sqlIndex.B).toContain('read');
            expect(after.redisGen.B).toBeGreaterThan(before.redisGen.B);
            await assertInvariants(cast, entry, A);
        });

        it('replaces a mode rather than stacking a second grant', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);
            const cast = [A, B];

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });
            const before = await snapshot(cast, entry);
            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'write',
            });
            const after = await snapshot(cast, entry);

            record(
                'A raises B from read to write',
                'I6: the superseded mode must be gone from KV, not merely shadowed. A leaked second key is silent privilege retention.',
                before,
                after,
            );

            expect(before.kv['B:read']).toBe('grant');
            // The granted read is gone; a warm entry may remain because `write`
            // implies `read` and the scan caches what it derived.
            expect(after.kv['B:read']).not.toBe('grant');
            expect(after.kv['B:write']).toBe('grant');
            expect(Object.keys(after.sqlIndex)).toHaveLength(1);
            await assertInvariants(cast, entry, A);
        });

        it("records a delegate's re-share where the owner can see it", async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const C = await makeParty('C');
            const entry = await makeEntry(A);
            const cast = [A, B, C];

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'manage',
            });
            const before = await snapshot(cast, entry);
            await share(B.actor, {
                uid: entry.uuid,
                recipient: { email: C.email },
                mode: 'read',
            });
            const after = await snapshot(cast, entry);

            record(
                'B, who manages, re-shares with C',
                'The permission tables are keyed issuer→holder, so the index is the only thing that can show A what B did.',
                before,
                after,
            );

            expect(after.canRead.C).toBe(true);
            expect(after.sqlIndex.C).toBe('read from B');
            await assertInvariants(cast, entry, A);
        });
    });

    describe('withdrawing access', () => {
        it('takes the re-shares of a revoked delegate with it', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const C = await makeParty('C');
            const entry = await makeEntry(A);
            const cast = [A, B, C];

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'manage',
            });
            await share(B.actor, {
                uid: entry.uuid,
                recipient: { email: C.email },
                mode: 'read',
            });
            const before = await snapshot(cast, entry);
            const res = await unshare(A.actor, {
                uid: entry.uuid,
                recipient: { username: B.username },
            });
            const after = await snapshot(cast, entry);

            record(
                'A revokes B, whose grant was all C had',
                `C's authority derived from B's, so it cannot outlive it. Reported \`revoked: ${res.revoked}\`.`,
                before,
                after,
            );

            expect(after.canRead.B).toBe(false);
            expect(after.canRead.C).toBe(false);
            expect(Object.keys(after.sqlIndex)).toHaveLength(0);
            expect(after.kv['C:read']).not.toBe('grant');
            await assertInvariants(cast, entry, A);
        });

        it('takes the re-shares of a delegate who leaves', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const C = await makeParty('C');
            const entry = await makeEntry(A);
            const cast = [A, B, C];

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'manage',
            });
            await share(B.actor, {
                uid: entry.uuid,
                recipient: { email: C.email },
                mode: 'read',
            });
            const before = await snapshot(cast, entry);
            await unshare(B.actor, {
                uid: entry.uuid,
                recipient: { username: B.username },
            });
            const after = await snapshot(cast, entry);

            record(
                'B leaves the share themselves',
                "Regression guard. Cascading after clearing B's own grant would strip the authority the cascade needs, orphaning C with a live grant and no index row — invisible and unrevocable.",
                before,
                after,
            );

            expect(after.canRead.B).toBe(false);
            expect(after.canRead.C).toBe(false);
            expect(Object.keys(after.sqlIndex)).toHaveLength(0);
            expect(Object.keys(after.sqlPerms)).toHaveLength(0);
            await assertInvariants(cast, entry, A);
        });

        it('refuses to revoke the owner, and disturbs nothing else', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);
            const cast = [A, B];

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });
            const before = await snapshot(cast, entry);
            await expect(
                unshare(A.actor, {
                    uid: entry.uuid,
                    recipient: { username: A.username },
                }),
            ).rejects.toMatchObject({ statusCode: 400 });
            const after = await snapshot(cast, entry);

            record(
                'Someone tries to revoke the owner',
                'Ownership resolves through the `is-owner` implicator at scan time, not a grant row, so there is nothing to revoke. The refusal must not disturb the unrelated share to B.',
                before,
                after,
            );

            expect(after.canRead.A).toBe(true);
            expect(after.sqlIndex).toEqual(before.sqlIndex);
            expect(after.kv).toEqual(before.kv);
            await assertInvariants(cast, entry, A);
        });
    });

    describe('access reached through a folder', () => {
        it('leaves no row on a file reached through its folder', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const dir = await makeEntry(A, true);
            const child = await makeEntry(A, false, dir.path);
            const cast = [A, B];

            const before = await snapshot(cast, child);
            await share(A.actor, {
                uid: dir.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });
            const after = await snapshot(cast, child);

            record(
                'A shares a folder, and B reaches a file inside it',
                'The child gains no row in any store — access is inherited. `getShares` on the child must still report B, or the owner is told nobody can reach a file that someone can.',
                before,
                after,
            );

            expect(after.canRead.B).toBe(true);
            expect(Object.keys(after.sqlIndex)).toHaveLength(0);
            expect(after.kv['B:read']).not.toBe('grant');

            const shares = await server.services.share.listSharesOf(A.actor, {
                uid: child.uuid,
            });
            const row = shares.find((s) => s.holder.username === B.username);
            expect(row?.inheritedFrom).toBe(dir.path);
            await assertInvariants(cast, child, A);
        });
    });

    describe('access outliving its source', () => {
        it('retires every grant when the entry is deleted', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);
            const cast = [A, B];

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });
            const before = await snapshot(cast, entry);
            await server.services.share.onEntryDeleted(entry.uuid);
            await server.clients.db.write(
                'DELETE FROM `fsentries` WHERE `uuid` = ?',
                [entry.uuid],
            );
            const after = await snapshot(cast, entry);

            record(
                'The shared file is deleted',
                'I3: no grant may outlive its entry. The FK cascade covers the index row; the permission has to be retired explicitly.',
                before,
                after,
            );

            expect(
                Object.values(after.kv).filter((v) => v === 'grant'),
            ).toHaveLength(0);
            expect(Object.keys(after.sqlPerms)).toHaveLength(0);
            expect(after.canRead.B).toBe(false);
        });

        it('stops answering "allowed" once the entry is gone', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });
            expect(await canRead(B.actor, entry.path)).toBe(true);

            await server.services.share.onEntryDeleted(entry.uuid);
            await server.clients.db.write(
                'DELETE FROM `fsentries` WHERE `uuid` = ?',
                [entry.uuid],
            );

            const sql = (await server.clients.db.read(
                'SELECT permission FROM `user_to_user_permissions` WHERE `permission` LIKE ?',
                [`%${entry.uuid}%`],
            )) as unknown[];
            const key = PermissionUtil.join(
                'perm',
                String(B.id),
                `fs:${entry.uuid}:read`,
            );
            const kvRaw = await server.stores.kv.get({ key });
            const kv = ((kvRaw as { res?: unknown })?.res ?? null) as unknown;

            console.log('[S7b] sql rows after delete:', sql.length);
            console.log('[S7b] kv value after delete:', JSON.stringify(kv));
            console.log(
                '[S7b] acl.check(read) after delete:',
                await canRead(B.actor, entry.path),
            );

            expect(sql).toHaveLength(0);
            expect(kv).toBeNull();

            // Both stores being clean is not enough — a holder's cached scan keeps
            // answering "allowed" until its generation moves.
            expect(await canRead(B.actor, entry.path)).toBe(false);
        });

        // Arrives as a replicated SQL delete plus the invalidation events.
        it('applies a revoke that happened in another region', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });
            // Warm this region's scan cache and flat entry.
            expect(await canRead(B.actor, entry.path)).toBe(true);

            const permission = `fs:${entry.uuid}:read`;
            // The peer's write, as SQL replication delivers it: rows only.
            await server.clients.db.write(
                'DELETE FROM `user_to_user_permissions` WHERE `holder_user_id` = ? AND `permission` = ?',
                [B.id, permission],
            );

            // Still allowed — the caches this region owns were never told.
            expect(await canRead(B.actor, entry.path)).toBe(true);

            for (const [event, data] of [
                // Row cache, flat view and generation are each per-cluster.
                [
                    'outer.cacheUpdate',
                    { cacheKey: [`perms:u2u:holder:${B.id}`] },
                ],
                [
                    'outer.permission.flatInvalidated',
                    { entries: [{ holderUserId: B.id, permission }] },
                ],
                [
                    'outer.permission.generationBumped',
                    { actorUids: [`user:${B.uuid}`] },
                ],
            ] as const) {
                await server.clients.event.emitAndWait(event, data, {
                    from_outside: true,
                });
            }

            expect(await canRead(B.actor, entry.path)).toBe(false);
        });
    });

    describe('a caller who cannot see the item', () => {
        it('tells a stranger nothing and writes nothing', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);
            const cast = [A, B];

            const before = await snapshot(cast, entry);
            await expect(
                share(B.actor, {
                    uid: entry.uuid,
                    recipient: { email: B.email },
                    mode: 'read',
                }),
            ).rejects.toMatchObject({ statusCode: 404 });
            const after = await snapshot(cast, entry);

            record(
                'B, who cannot see the file, tries to share it',
                '404 rather than 403: a 403 would confirm the uuid exists to anyone who guesses one. No store may be touched.',
                before,
                after,
            );

            expect(after.kv).toEqual(before.kv);
            expect(after.sqlPerms).toEqual(before.sqlPerms);
            expect(after.sqlIndex).toEqual(before.sqlIndex);
        });
    });

    describe('under concurrency', () => {
        it('leaves exactly one grant when modes race', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);
            const cast = [A, B];

            const modes = [
                'see',
                'list',
                'read',
                'write',
                'read',
                'write',
                'list',
                'see',
            ];
            const settled = await Promise.allSettled(
                modes.map((mode) =>
                    share(A.actor, {
                        uid: entry.uuid,
                        recipient: { email: B.email },
                        mode,
                    }),
                ),
            );
            expect(settled.some((r) => r.status === 'fulfilled')).toBe(true);

            const after = await snapshot(cast, entry);
            // I6 is what `#withNodeLock` exists to protect: whichever write
            // lands last, the holder must not end up with two live grants.
            const grants = Object.entries(after.kv).filter(
                ([k, v]) => k.startsWith('B:') && v === 'grant',
            );
            expect(grants.length).toBeLessThanOrEqual(1);
            expect(Object.keys(after.sqlIndex)).toHaveLength(1);
            await assertInvariants(cast, entry, A);
        });

        it('settles a racing share and unshare to one answer', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const entry = await makeEntry(A);
            const cast = [A, B];

            await share(A.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });
            await Promise.allSettled([
                share(A.actor, {
                    uid: entry.uuid,
                    recipient: { email: B.email },
                    mode: 'write',
                }),
                unshare(A.actor, {
                    uid: entry.uuid,
                    recipient: { username: B.username },
                }),
            ]);

            // Either outcome is legitimate; "revoked but the KV grant remains"
            // is not. The stores and the effective answer must agree.
            const after = await snapshot(cast, entry);
            const hasGrant = Object.entries(after.kv).some(
                ([k, v]) => k.startsWith('B:') && v === 'grant',
            );
            expect(hasGrant).toBe(after.canRead.B);
            expect(Object.keys(after.sqlIndex).length > 0).toBe(hasGrant);
            await assertInvariants(cast, entry, A);
        });

        it('lands every recipient when many share one entry', async () => {
            const A = await makeParty('A');
            const entry = await makeEntry(A);
            const recipients = await Promise.all(
                Array.from({ length: 8 }, (_, i) => makeParty(`R${i}`)),
            );

            const settled = await Promise.allSettled(
                recipients.map((r) =>
                    share(A.actor, {
                        uid: entry.uuid,
                        recipient: { email: r.email },
                        mode: 'read',
                    }),
                ),
            );
            expect(
                settled.filter((r) => r.status === 'fulfilled'),
            ).toHaveLength(8);

            // The lock is per (holder, entry), so distinct holders must not
            // contend — every one of them ends up with access.
            for (const r of recipients) {
                expect(await canRead(r.actor, entry.path)).toBe(true);
            }
            await assertInvariants([A, ...recipients], entry, A);
        });

        it('terminates on a delegation cycle', async () => {
            const A = await makeParty('A');
            const B = await makeParty('B');
            const C = await makeParty('C');
            const entry = await makeEntry(A);

            // Only the owner can hand out `manage`, so the cycle is built from
            // two peers who then grant each other plain access.
            for (const p of [B, C]) {
                await share(A.actor, {
                    uid: entry.uuid,
                    recipient: { email: p.email },
                    mode: 'manage',
                });
            }
            await share(B.actor, {
                uid: entry.uuid,
                recipient: { email: C.email },
                mode: 'read',
            });
            await share(C.actor, {
                uid: entry.uuid,
                recipient: { email: B.email },
                mode: 'read',
            });

            // The `seen` guard is the only thing keeping this from recursing
            // forever; a hang here is the failure.
            await unshare(A.actor, {
                uid: entry.uuid,
                recipient: { username: B.username },
            });
            expect(await canRead(B.actor, entry.path)).toBe(false);
            await assertInvariants([A, B, C], entry, A);
        });

        it('holds the day budget however many requests race', async () => {
            const A = await makeParty('A');
            const limit = 3;
            const concurrency = 12;
            const recipients = await Promise.all(
                Array.from({ length: concurrency }, (_, i) =>
                    makeParty(`Q${i}`),
                ),
            );
            const entry = await makeEntry(A);

            const cfg = (
                server.services.share as unknown as {
                    config: { share_daily_limit?: number };
                }
            ).config;
            const original = cfg.share_daily_limit;
            cfg.share_daily_limit = limit;
            let granted = 0;
            try {
                const settled = await Promise.allSettled(
                    recipients.map((r) =>
                        share(A.actor, {
                            uid: entry.uuid,
                            recipient: { email: r.email },
                            mode: 'read',
                        }),
                    ),
                );
                granted = settled.filter(
                    (r) => r.status === 'fulfilled',
                ).length;
            } finally {
                cfg.share_daily_limit = original;
            }

            // The reservation is atomic, so concurrency cannot widen the
            // budget: exactly `limit` shares land however many race for them.
            expect(granted).toBe(limit);
            report.push(
                `\n_Daily budget: limit ${limit}, ${concurrency} concurrent → ${granted} granted (exactly the limit)._`,
            );
        });
    });

    describe('cost', () => {
        /** A chain of nested directories, deepest last. */
        const makeChain = async (owner: Party, depth: number) => {
            const dirs = [];
            let parent = `/${owner.username}`;
            for (let i = 0; i < depth; i++) {
                const dir = await makeEntry(owner, true, parent);
                dirs.push(dir);
                parent = dir.path;
            }
            const leaf = await makeEntry(owner, false, parent);
            return { dirs, leaf };
        };

        /**
         * Round trips, not milliseconds. Local SQLite answers in ~0ms, so wall
         * clock hides an N+1 that costs 2ms a hop against a real database.
         */
        const countQueries = async (fn: () => Promise<unknown>) => {
            const db = server.clients.db as unknown as {
                read: (...a: unknown[]) => Promise<unknown>;
            };
            const original = db.read.bind(db);
            let n = 0;
            db.read = (...args: unknown[]) => {
                n++;
                return original(...args);
            };
            try {
                await fn();
            } finally {
                db.read = original;
            }
            return n;
        };

        it('reads one row per ancestor when listing shares', async () => {
            const rows: string[] = [];
            for (const depth of [1, 4, 8, 12]) {
                const A = await makeParty('A');
                const B = await makeParty('B');
                const { dirs, leaf } = await makeChain(A, depth);
                await share(A.actor, {
                    uid: dirs[0].uuid,
                    recipient: { email: B.email },
                    mode: 'manage',
                });

                const listQ = await countQueries(() =>
                    server.services.share.listSharesOf(A.actor, {
                        uid: leaf.uuid,
                    }),
                );

                // The delegate's manage on the leaf resolves by walking up to
                // the shared root — the cost this implicator introduced.
                let canManage = false;
                const manageQ = await countQueries(async () => {
                    canManage =
                        await server.services.permission.canManagePermission(
                            B.actor,
                            `fs:${leaf.uuid}:read`,
                        );
                });
                expect(canManage).toBe(true);

                rows.push(`| ${depth} | ${listQ} | ${manageQ} |`);
            }
            report.push(
                '\n### Cost against path depth\n',
                '| depth | listSharesOf queries | manage-walk queries |',
                '| --- | --- | --- |',
                ...rows,
            );
        });

        it('scales a cascade with the number of descendant shares', async () => {
            const rows: string[] = [];
            for (const width of [1, 5, 15]) {
                const A = await makeParty('A');
                const B = await makeParty('B');
                const dir = await makeEntry(A, true);
                await share(A.actor, {
                    uid: dir.uuid,
                    recipient: { email: B.email },
                    mode: 'manage',
                });

                const holders = await Promise.all(
                    Array.from({ length: width }, (_, i) => makeParty(`H${i}`)),
                );
                for (const h of holders) {
                    const child = await makeEntry(A, false, dir.path);
                    await share(B.actor, {
                        uid: child.uuid,
                        recipient: { email: h.email },
                        mode: 'read',
                    });
                }

                let res = { revoked: 0 };
                const q = await countQueries(async () => {
                    res = await unshare(A.actor, {
                        uid: dir.uuid,
                        recipient: { username: B.username },
                    });
                });
                rows.push(`| ${width} | ${q} | ${res.revoked} |`);

                for (const h of holders) {
                    expect(await canRead(h.actor, dir.path)).toBe(false);
                }
            }
            report.push(
                '\n### Cost of a cascade against descendant count\n',
                '| descendant shares | unshare queries | revoked |',
                '| --- | --- | --- |',
                ...rows,
            );
        });
    });
});
