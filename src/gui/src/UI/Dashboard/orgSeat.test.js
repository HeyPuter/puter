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

import { describe, expect, it } from 'vitest';
import { isOrgSeat, orgSeatTeamName } from './orgSeat.js';

describe('recognising a team-owned account', () => {
    it('is a seat when whoami sent a team', () => {
        expect(isOrgSeat({ team: { uid: 't-1', name: 'Acme' } })).toBe(true);
    });

    it('is not a seat for an ordinary account, or before whoami lands', () => {
        // Every restriction keys on this, so a missing user must not read as
        // "seat" and lock an ordinary account out of its own settings.
        expect(isOrgSeat({})).toBe(false);
        expect(isOrgSeat(undefined)).toBe(false);
        expect(isOrgSeat(null)).toBe(false);
    });

    it('needs the uid, not just the key', () => {
        expect(isOrgSeat({ team: {} })).toBe(false);
        expect(isOrgSeat({ team: { uid: '' } })).toBe(false);
        expect(isOrgSeat({ team: { name: 'Acme' } })).toBe(false);
    });

    it('reads the team name, and treats a blank one as none', () => {
        expect(orgSeatTeamName({ team: { uid: 't', name: 'Acme' } })).toBe('Acme');
        expect(orgSeatTeamName({ team: { uid: 't', name: '  ' } })).toBe(null);
        expect(orgSeatTeamName({ team: { uid: 't' } })).toBe(null);
        expect(orgSeatTeamName(undefined)).toBe(null);
    });
});
