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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import list_all_shared, { mergeGrants } from './listAllShared.js';

const BUDGET = '33333333-3333-3333-3333-333333333333';
const REPORT = '44444444-4444-4444-4444-444444444444';
const TEAM = { uid: 'team-1', name: 'Finance', handle: 'finance' };

const grant = (entryUid, name, extra) => ({
    entryUid,
    path: `/jf/${entryUid}/${name}`,
    name,
    ...extra,
});

describe('mergeGrants', () => {
    it('lists an item once, with its strongest grant', () => {
        const merged = mergeGrants([
            grant(BUDGET, 'Budget', { mode: 'manage', issuer: 'jf' }),
            grant(REPORT, 'report.pdf', { mode: 'read', issuer: 'jf' }),
            grant(BUDGET, 'Budget', { mode: 'read', issuer: 'delegate' }),
            grant(REPORT, 'report.pdf', { mode: 'write', issuer: 'delegate' }),
        ]);
        expect(merged.map((share) => [share.entryUid, share.mode, share.issuer])).toEqual([
            [BUDGET, 'manage', 'jf'],
            [REPORT, 'write', 'delegate'],
        ]);
    });

    it('names everyone who granted the item, strongest grant first', () => {
        const [share] = mergeGrants([
            grant(BUDGET, 'Budget', { mode: 'read', issuer: 'jf' }),
            grant(BUDGET, 'Budget', { mode: 'write', issuer: 'delegate' }),
            grant(BUDGET, 'Budget', { mode: 'read', issuer: 'jf', holderTeam: TEAM }),
        ]);
        expect(share.issuer).toBe('delegate');
        expect(share.issuers).toEqual(['delegate', 'jf']);
    });

    it('keeps the first of two equal grants', () => {
        const [share] = mergeGrants([
            grant(BUDGET, 'Budget', { mode: 'read', issuer: 'jf' }),
            grant(BUDGET, 'Budget', { mode: 'read', issuer: 'delegate' }),
        ]);
        expect(share.issuer).toBe('jf');
    });

    it('is not a team share when one grant names the user directly', () => {
        const [share] = mergeGrants([
            grant(BUDGET, 'Budget', { mode: 'read', issuer: 'jf' }),
            grant(BUDGET, 'Budget', { mode: 'write', issuer: 'jf', holderTeam: TEAM }),
        ]);
        expect(share.mode).toBe('write');
        expect(share.holderTeam).toBeUndefined();
        expect(share.alsoHeldByTeam).toBe(true);
    });

    it('marks only an item held both ways as also held by a team', () => {
        const [direct, team] = mergeGrants([
            grant(BUDGET, 'Budget', { mode: 'read', issuer: 'jf' }),
            grant(BUDGET, 'Budget', { mode: 'write', issuer: 'delegate' }),
            grant(REPORT, 'report.pdf', { mode: 'read', holderTeam: TEAM }),
            grant(REPORT, 'report.pdf', { mode: 'write', holderTeam: TEAM }),
        ]);
        expect(direct.alsoHeldByTeam).toBe(false);
        expect(team.alsoHeldByTeam).toBe(false);
    });

    it('still marks it when a later grant is direct again', () => {
        const [share] = mergeGrants([
            grant(BUDGET, 'Budget', { mode: 'read', holderTeam: TEAM }),
            grant(BUDGET, 'Budget', { mode: 'read', issuer: 'jf' }),
            grant(BUDGET, 'Budget', { mode: 'write', issuer: 'delegate' }),
        ]);
        expect(share.holderTeam).toBeUndefined();
        expect(share.alsoHeldByTeam).toBe(true);
    });

    it('stays a team share when every grant is to a team', () => {
        const [share] = mergeGrants([
            grant(BUDGET, 'Budget', { mode: 'read', holderTeam: { ...TEAM, uid: 'team-2' } }),
            grant(BUDGET, 'Budget', { mode: 'write', holderTeam: TEAM }),
        ]);
        expect(share.holderTeam).toEqual(TEAM);
    });
});

describe('list_all_shared', () => {
    beforeEach(() => {
        globalThis.window = { puter: { fs: { listShared: vi.fn() } } };
    });

    it('merges grants for one item that arrive on different pages', async () => {
        window.puter.fs.listShared
            .mockResolvedValueOnce({
                items: [grant(BUDGET, 'Budget', { mode: 'manage' })],
                cursor: 'next',
            })
            .mockResolvedValueOnce({
                items: [grant(BUDGET, 'Budget', { mode: 'read' })],
            });

        const shares = await list_all_shared();

        expect(shares).toHaveLength(1);
        expect(shares[0].mode).toBe('manage');
        expect(window.puter.fs.listShared).toHaveBeenLastCalledWith({ limit: 200, cursor: 'next' });
    });
});
