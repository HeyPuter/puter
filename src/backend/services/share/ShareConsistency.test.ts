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
        await server.stores.user.update(found.id, { email });
        const user = await server.stores.user.getById(found.id, { force: true });
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
            [uuid, name, path, owner.id, isDir ? 1 : 0, Math.floor(Date.now() / 1000)],
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
                resolveAncestors: () => server.services.fs.getAncestorChain(path),
            },
            'read',
        );

    /** All four layers, for one entry and a fixed cast. */
    const snapshot = async (parties: Party[], entry: { id: number; uuid: string; path: string }): Promise<Snapshot> => {
        const kv: Record<string, string> = {};
        for (const p of parties) {
            for (const mode of [...MODES.map((m) => `fs:${entry.uuid}:${m}`), `manage:fs:${entry.uuid}`]) {
                const key = PermissionUtil.join('perm', String(p.id), mode);
                const got = await server.stores.kv.get({ key });
                const val = (got as { res?: unknown })?.res ?? got;
                if (val !== null && val !== undefined) {
                    const short = mode.startsWith('manage:') ? 'manage' : mode.split(':').pop()!;
                    // A flat key is either an authoritative grant (`deleted`
                    // present, no expiry) or a 60s warm-cache entry derived
                    // from the SQL scan. Only the first is a share.
                    const v = val as { deleted?: boolean; data?: unknown };
                    kv[`${p.label}:${short}`] =
                        v.deleted === undefined ? 'warm' : v.deleted ? 'tombstone' : 'grant';
                }
            }
        }

        const permRows = (await server.clients.db.read(
            'SELECT holder_user_id, issuer_user_id, permission FROM `user_to_user_permissions` WHERE `permission` LIKE ?',
            [`%${entry.uuid}%`],
        )) as Array<{ holder_user_id: number; issuer_user_id: number; permission: string }>;
        const byId = new Map(parties.map((p) => [p.id, p.label]));
        const sqlPerms: Record<string, string> = {};
        for (const r of permRows) {
            const mode = r.permission.startsWith('manage:') ? 'manage' : r.permission.split(':').pop()!;
            sqlPerms[`${byId.get(r.holder_user_id) ?? r.holder_user_id}:${mode}`] =
                `from ${byId.get(r.issuer_user_id) ?? r.issuer_user_id}`;
        }

        const indexRows = (await server.clients.db.read(
            'SELECT holder_user_id, issuer_user_id, mode FROM `share` WHERE `fsentry_id` = ?',
            [entry.id],
        )) as Array<{ holder_user_id: number; issuer_user_id: number; mode: string }>;
        const sqlIndex: Record<string, string> = {};
        for (const r of indexRows) {
            sqlIndex[`${byId.get(r.holder_user_id) ?? r.holder_user_id}`] =
                `${r.mode} from ${byId.get(r.issuer_user_id) ?? r.issuer_user_id}`;
        }

        const redisGen: Record<string, number> = {};
        for (const p of parties) {
            redisGen[p.label] = await server.stores.permission.getCacheGeneration(`user:${p.uuid}`);
        }

        const reads: Record<string, boolean> = {};
        for (const p of parties) reads[p.label] = await canRead(p.actor, entry.path);

        return { kv, sqlPerms, sqlIndex, redisGen, canRead: reads };
    };

    const fmt = (s: Snapshot) => ({
        'KV (flat grants)': Object.keys(s.kv).length ? JSON.stringify(s.kv) : '—',
        'SQL user_to_user_permissions': Object.keys(s.sqlPerms).length ? JSON.stringify(s.sqlPerms) : '—',
        'SQL share (index)': Object.keys(s.sqlIndex).length ? JSON.stringify(s.sqlIndex) : '—',
        'Redis cachegen': JSON.stringify(s.redisGen),
        'acl.check(read)': JSON.stringify(s.canRead),
    });

    const record = (title: string, note: string, before: Snapshot, after: Snapshot) => {
        const b = fmt(before);
        const a = fmt(after);
        report.push(`\n### ${title}\n`, note, '', '| Layer | Before | After |', '| --- | --- | --- |');
        for (const k of Object.keys(b)) {
            report.push(`| ${k} | \`${b[k as keyof typeof b]}\` | \`${a[k as keyof typeof a]}\` |`);
        }
    };

    /**
     * I1/I3/I5 from the plan, checked against whatever the stores currently
     * hold. Every case ends with this — a scenario that leaves the layers
     * disagreeing is a failure even when its own assertions pass.
     */
    const assertInvariants = async (parties: Party[], entry: { id: number; uuid: string }, owner: Party) => {
        const indexRows = (await server.clients.db.read(
            'SELECT holder_user_id, issuer_user_id, mode FROM `share` WHERE `fsentry_id` = ?',
            [entry.id],
        )) as Array<{ holder_user_id: number; issuer_user_id: number; mode: string }>;

        for (const row of indexRows) {
            // I5 — the owner's access comes from ownership, never a grant row.
            expect(row.holder_user_id).not.toBe(owner.id);

            // I1 — an index row must have both a KV grant and a SQL row behind it.
            const perm = row.mode === 'manage' ? `manage:fs:${entry.uuid}` : `fs:${entry.uuid}:${row.mode}`;
            const key = PermissionUtil.join('perm', String(row.holder_user_id), perm);
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
                const key = PermissionUtil.join('perm', String(p.id), `fs:${entry.uuid}:${mode}`);
                const got = await server.stores.kv.get({ key });
                const val = (got as { res?: unknown })?.res ?? got;
                if ((val as { deleted?: boolean })?.deleted === false) granted.push(mode);
            }
            expect(granted.length).toBeLessThanOrEqual(1);
        }
    };

    const share = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () => server.services.share.share(actor, input as never));
    const unshare = (actor: Actor, input: Record<string, unknown>) =>
        runWithContext({ actor }, () => server.services.share.unshare(actor, input as never));

    it('S1 — a fresh share writes KV, SQL and the index together', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const entry = await makeEntry(A);
        const cast = [A, B];

        const before = await snapshot(cast, entry);
        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'read' });
        const after = await snapshot(cast, entry);

        record(
            'S1 — A shares a file with B (read)',
            'The baseline. All three stores must gain the grant, and B\'s cache generation must move so any cached deny is retired.',
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

    it('S2 — raising the mode replaces rather than stacks', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const entry = await makeEntry(A);
        const cast = [A, B];

        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'read' });
        const before = await snapshot(cast, entry);
        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'write' });
        const after = await snapshot(cast, entry);

        record(
            'S2 — A raises B from read to write',
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

    it('S3 — a delegate re-share is visible in every layer', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const C = await makeParty('C');
        const entry = await makeEntry(A);
        const cast = [A, B, C];

        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'manage' });
        const before = await snapshot(cast, entry);
        await share(B.actor, { uid: entry.uuid, recipient: { email: C.email }, mode: 'read' });
        const after = await snapshot(cast, entry);

        record(
            'S3 — B (manage) re-shares with C (read)',
            'The permission tables are keyed issuer→holder, so the index is the only thing that can show A what B did.',
            before,
            after,
        );

        expect(after.canRead.C).toBe(true);
        expect(after.sqlIndex.C).toBe('read from B');
        await assertInvariants(cast, entry, A);
    });

    it('S4 — revoking a delegate cascades to what they re-shared', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const C = await makeParty('C');
        const entry = await makeEntry(A);
        const cast = [A, B, C];

        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'manage' });
        await share(B.actor, { uid: entry.uuid, recipient: { email: C.email }, mode: 'read' });
        const before = await snapshot(cast, entry);
        const res = await unshare(A.actor, { uid: entry.uuid, recipient: { username: B.username } });
        const after = await snapshot(cast, entry);

        record(
            'S4 — A revokes B; C held access only through B',
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

    it('S5 — a delegate leaving takes their re-shares with them', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const C = await makeParty('C');
        const entry = await makeEntry(A);
        const cast = [A, B, C];

        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'manage' });
        await share(B.actor, { uid: entry.uuid, recipient: { email: C.email }, mode: 'read' });
        const before = await snapshot(cast, entry);
        await unshare(B.actor, { uid: entry.uuid, recipient: { username: B.username } });
        const after = await snapshot(cast, entry);

        record(
            'S5 — B leaves the share ("Remove from Shared")',
            'Regression guard. Cascading after clearing B\'s own grant would strip the authority the cascade needs, orphaning C with a live grant and no index row — invisible and unrevocable.',
            before,
            after,
        );

        expect(after.canRead.B).toBe(false);
        expect(after.canRead.C).toBe(false);
        expect(Object.keys(after.sqlIndex)).toHaveLength(0);
        expect(Object.keys(after.sqlPerms)).toHaveLength(0);
        await assertInvariants(cast, entry, A);
    });

    it('S6 — access inherited from a folder leaves no row on the child', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const dir = await makeEntry(A, true);
        const child = await makeEntry(A, false, dir.path);
        const cast = [A, B];

        const before = await snapshot(cast, child);
        await share(A.actor, { uid: dir.uuid, recipient: { email: B.email }, mode: 'read' });
        const after = await snapshot(cast, child);

        record(
            'S6 — A shares a folder; B reaches a file inside it',
            'The child gains no row in any store — access is inherited. `getShares` on the child must still report B, or the owner is told nobody can reach a file that someone can.',
            before,
            after,
        );

        expect(after.canRead.B).toBe(true);
        expect(Object.keys(after.sqlIndex)).toHaveLength(0);
        expect(after.kv['B:read']).not.toBe('grant');

        const shares = await server.services.share.listSharesOf(A.actor, { uid: child.uuid });
        const row = shares.find((s) => s.holder.username === B.username);
        expect(row?.inheritedFrom).toBe(dir.path);
        await assertInvariants(cast, child, A);
    });

    it('S7 — deleting the entry retires the grant in every store', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const entry = await makeEntry(A);
        const cast = [A, B];

        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'read' });
        const before = await snapshot(cast, entry);
        await server.services.share.onEntryDeleted(entry.uuid);
        await server.clients.db.write('DELETE FROM `fsentries` WHERE `uuid` = ?', [entry.uuid]);
        const after = await snapshot(cast, entry);

        record(
            'S7 — the shared file is deleted',
            'I3: no grant may outlive its entry. The FK cascade covers the index row; the permission has to be retired explicitly.',
            before,
            after,
        );

        expect(Object.values(after.kv).filter((v) => v === 'grant')).toHaveLength(0);
        expect(Object.keys(after.sqlPerms)).toHaveLength(0);
        expect(after.canRead.B).toBe(false);
    });

    it('S7b — access must not survive the entry it was granted on', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const entry = await makeEntry(A);

        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'read' });
        expect(await canRead(B.actor, entry.path)).toBe(true);

        await server.services.share.onEntryDeleted(entry.uuid);
        await server.clients.db.write('DELETE FROM `fsentries` WHERE `uuid` = ?', [entry.uuid]);

        const sql = (await server.clients.db.read(
            'SELECT permission FROM `user_to_user_permissions` WHERE `permission` LIKE ?',
            [`%${entry.uuid}%`],
        )) as unknown[];
        const key = PermissionUtil.join('perm', String(B.id), `fs:${entry.uuid}:read`);
        const kvRaw = await server.stores.kv.get({ key });
        const kv = ((kvRaw as { res?: unknown })?.res ?? null) as unknown;

        console.log('[S7b] sql rows after delete:', sql.length);
        console.log('[S7b] kv value after delete:', JSON.stringify(kv));
        console.log('[S7b] acl.check(read) after delete:', await canRead(B.actor, entry.path));

        expect(sql).toHaveLength(0);
        expect(kv).toBeNull();

        // Both stores being clean is not enough — a holder's cached scan keeps
        // answering "allowed" until its generation moves.
        expect(await canRead(B.actor, entry.path)).toBe(false);
    });

    it('S8 — revoking the owner is refused and changes nothing', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const entry = await makeEntry(A);
        const cast = [A, B];

        await share(A.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'read' });
        const before = await snapshot(cast, entry);
        await expect(
            unshare(A.actor, { uid: entry.uuid, recipient: { username: A.username } }),
        ).rejects.toMatchObject({ statusCode: 400 });
        const after = await snapshot(cast, entry);

        record(
            'S8 — someone tries to revoke the owner',
            'Ownership resolves through the `is-owner` implicator at scan time, not a grant row, so there is nothing to revoke. The refusal must not disturb the unrelated share to B.',
            before,
            after,
        );

        expect(after.canRead.A).toBe(true);
        expect(after.sqlIndex).toEqual(before.sqlIndex);
        expect(after.kv).toEqual(before.kv);
        await assertInvariants(cast, entry, A);
    });

    it('S9 — a stranger probing an entry learns nothing and writes nothing', async () => {
        const A = await makeParty('A');
        const B = await makeParty('B');
        const entry = await makeEntry(A);
        const cast = [A, B];

        const before = await snapshot(cast, entry);
        await expect(
            share(B.actor, { uid: entry.uuid, recipient: { email: B.email }, mode: 'read' }),
        ).rejects.toMatchObject({ statusCode: 404 });
        const after = await snapshot(cast, entry);

        record(
            'S9 — B, who cannot see the file, tries to share it',
            '404 rather than 403: a 403 would confirm the uuid exists to anyone who guesses one. No store may be touched.',
            before,
            after,
        );

        expect(after.kv).toEqual(before.kv);
        expect(after.sqlPerms).toEqual(before.sqlPerms);
        expect(after.sqlIndex).toEqual(before.sqlIndex);
    });
});
