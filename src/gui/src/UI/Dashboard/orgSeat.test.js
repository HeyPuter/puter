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
