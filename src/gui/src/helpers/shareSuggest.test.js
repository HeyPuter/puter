import { describe, expect, it } from 'vitest';
import {
    build_suggestions,
    recipient_for,
    recipient_key,
    share_key,
} from './shareSuggest.js';

const ACME = { uid: 't-1', name: 'Acme', handle: 'acme' };
const OPS = { uid: 't-2', name: null, handle: 'ops' };

const names = (list) => list.map((entry) => entry.name);
const keys = (list) => list.map((entry) => entry.key);

describe('recipient_key', () => {
    it('keys a person case-insensitively, since an address is', () => {
        expect(recipient_key({ kind: 'invite', id: 'Ann@Example.com' }))
            .toBe('invite:ann@example.com');
    });
});

describe('share_key', () => {
    it('keys a listed share the way the access list does', () => {
        expect(share_key({ holder: 'bob' })).toBe('user:bob');
        expect(share_key({ holderTeam: ACME })).toBe('team:t-1');
        expect(share_key({ pending: true, recipientEmail: 'ann@example.com' }))
            .toBe('invite:ann@example.com');
    });

    it('has no key for a link share, which is nobody in particular', () => {
        expect(share_key({ anyone: true, mode: 'read' })).toBe(null);
    });
});

describe('recipient_for', () => {
    it('names a team by uid, because a bare string reads as a person', () => {
        expect(recipient_for({ kind: 'team', id: 't-1', name: 'Acme' }))
            .toEqual({ team: 't-1' });
        expect(recipient_for({ kind: 'user', id: 'bob', name: 'bob' })).toBe('bob');
    });
});

describe('build_suggestions', () => {
    const base = {
        teams: [ACME, OPS],
        members: [
            { username: 'bob', teamName: 'Acme' },
            { username: 'carol', teamName: 'Acme' },
        ],
        recents: [{ kind: 'invite', id: 'ann@example.com', name: 'ann@example.com' }],
    };

    it('offers recents first, then teams, then colleagues', () => {
        expect(names(build_suggestions(base))).toEqual([
            'ann@example.com',
            'Acme',
            'ops',
            'bob',
            'carol',
        ]);
    });

    it('never offers the signed-in user their own name', () => {
        const out = build_suggestions({ ...base, self: 'bob' });
        expect(names(out)).not.toContain('bob');
    });

    it('leaves out anyone the access list already covers', () => {
        const out = build_suggestions({
            ...base,
            exclude: ['team:t-1', 'invite:ANN@example.com'],
        });
        expect(keys(out)).toEqual(['team:t-2', 'user:bob', 'user:carol']);
    });

    it('lists a colleague once even when they are also a recent', () => {
        const out = build_suggestions({
            ...base,
            recents: [{ kind: 'user', id: 'bob', name: 'bob' }],
        });
        expect(keys(out).filter((key) => key === 'user:bob')).toHaveLength(1);
        // Placed as a recent, but still named by the team they were found in.
        expect(out[0]).toMatchObject({ name: 'bob', recent: true, teamName: 'Acme' });
    });

    it('drops a recent team the user no longer belongs to', () => {
        const out = build_suggestions({
            ...base,
            teams: [OPS],
            recents: [{ kind: 'team', id: 't-1', name: 'Acme' }],
        });
        expect(names(out)).not.toContain('Acme');
    });

    it('renames a recent team from the live list rather than what was stored', () => {
        const out = build_suggestions({
            teams: [{ ...ACME, name: 'Acme Corp' }],
            recents: [{ kind: 'team', id: 't-1', name: 'Acme' }],
        });
        expect(names(out)).toEqual(['Acme Corp']);
    });

    it('ranks a leading match above a match anywhere', () => {
        const out = build_suggestions({
            ...base,
            members: [{ username: 'roberta', teamName: 'Acme' }, { username: 'bob', teamName: 'Acme' }],
            recents: [],
            query: 'ob',
        });
        // "bob" only contains it; "roberta" does too — order holds within the
        // tier, and neither leads, so the roster order decides.
        expect(names(out)).toEqual(['roberta', 'bob']);
        expect(names(build_suggestions({ ...base, recents: [], query: 'bo' })))
            .toEqual(['bob']);
    });

    it('matches a team by its handle as well as its name', () => {
        expect(names(build_suggestions({ ...base, recents: [], query: 'acm' })))
            .toEqual(['Acme']);
        expect(names(build_suggestions({ ...base, recents: [], query: 'ops' })))
            .toEqual(['ops']);
    });

    it('does not match a team by its uid, which nobody types', () => {
        expect(build_suggestions({ ...base, query: 't-1' })).toEqual([]);
    });

    it('keeps a recent ahead of a team when both match equally well', () => {
        const out = build_suggestions({
            teams: [{ uid: 't-9', name: 'Ann', handle: null }],
            recents: [{ kind: 'user', id: 'ann', name: 'ann' }],
            query: 'ann',
        });
        expect(keys(out)).toEqual(['user:ann', 'team:t-9']);
    });

    it('stops at the limit rather than filling the dialog', () => {
        const members = Array.from({ length: 30 }, (_, i) => ({ username: `u${i}` }));
        expect(build_suggestions({ members })).toHaveLength(8);
        expect(build_suggestions({ members, limit: 3 })).toHaveLength(3);
    });

    it('offers nothing when there is nothing to offer', () => {
        expect(build_suggestions()).toEqual([]);
    });
});
