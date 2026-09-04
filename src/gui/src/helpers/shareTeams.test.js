import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    team_for_share,
    team_label,
    teams_for_sharing,
} from './shareTeams.js';

const ACME = { uid: 't-1', name: 'Acme', handle: 'acme' };
const NAMELESS = { uid: 't-2', name: null, handle: 'ops' };

const original_puter = globalThis.puter;

// The helper runs in the browser; this suite does not, so the flag it reads
// has to exist. Set on, since these cover what happens past the gate.
globalThis.window = globalThis.window ?? {};
beforeEach(() => {
    window.teams_ui = true;
});

afterEach(() => {
    globalThis.puter = original_puter;
});

describe('teams_for_sharing', () => {
    it('offers nothing while the teams interface is turned off', async () => {
        // A team the SDK would happily return, so the flag is the only thing
        // deciding. Without this the catch returns [] and proves nothing.
        const list = vi.fn(async () => [ACME]);
        globalThis.puter = { teams: { list } };
        window.teams_ui = false;

        expect(await teams_for_sharing()).toEqual([]);
        expect(list).not.toHaveBeenCalled();
    });

    it('returns the teams the user belongs to', async () => {
        globalThis.puter = { teams: { list: vi.fn(async () => [ACME]) } };
        await expect(teams_for_sharing()).resolves.toEqual([ACME]);
    });

    it('offers nothing where the route does not exist, rather than surfacing the 404', async () => {
        // Teams off means no `/teams` route at all; the dialog must be
        // unchanged for that deployment, not show an error.
        globalThis.puter = {
            teams: {
                list: vi.fn(async () => {
                    throw Object.assign(new Error('not found'), { code: 'not_found' });
                }),
            },
        };
        await expect(teams_for_sharing()).resolves.toEqual([]);
    });

    it('offers nothing when the user has no team', async () => {
        globalThis.puter = { teams: { list: vi.fn(async () => []) } };
        await expect(teams_for_sharing()).resolves.toEqual([]);
    });

    it('offers nothing against an SDK too old to have the module', async () => {
        globalThis.puter = {};
        await expect(teams_for_sharing()).resolves.toEqual([]);
    });
});

describe('team_for_share', () => {
    it('takes the team the share names, whoever the caller is', () => {
        // A team share has no holder user, so `holder` is empty and the
        // team itself rides on the row.
        const share = { holder: null, holderTeam: ACME };
        expect(team_for_share([], share)).toBe(ACME);
    });

    it('falls back to a holder reported as the uid or the handle', () => {
        expect(team_for_share([ACME], { holder: 't-1' })).toBe(ACME);
        expect(team_for_share([ACME], { holder: 'acme' })).toBe(ACME);
    });

    it('leaves a share held by a person alone', () => {
        expect(team_for_share([ACME], { holder: 'alice' })).toBeNull();
        expect(team_for_share([ACME], { holder: 'alice@example.com' })).toBeNull();
    });

    it('reads nothing from a share with no holder at all', () => {
        // A pending invite has neither, and must not be mistaken for a
        // team whose own handle is missing.
        const handleless = { uid: 't-3', name: 'Solo', handle: null };
        expect(team_for_share([handleless], { holder: null })).toBeNull();
        expect(team_for_share([handleless], { holder: '' })).toBeNull();
        expect(team_for_share([handleless], {})).toBeNull();
    });

    it('survives an empty or missing team list', () => {
        expect(team_for_share([], { holder: 't-1' })).toBeNull();
        expect(team_for_share(undefined, { holder: 't-1' })).toBeNull();
    });
});

describe('team_label', () => {
    it('prefers the name', () => {
        expect(team_label(ACME)).toBe('Acme');
    });

    it('falls back to the handle, then the uid', () => {
        expect(team_label(NAMELESS)).toBe('ops');
        expect(team_label({ uid: 't-4', name: null, handle: null })).toBe('t-4');
    });
});
