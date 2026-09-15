import { describe, expect, it } from 'vitest';
import { aggregateOwners, aggregateShares, missingPathsFor } from './shareAggregate.js';

const grant = (holder, mode, extra = {}) => ({ holder, mode, ...extra });

describe('aggregateShares', () => {
    it('gives a person one row across the items they hold', () => {
        const groups = aggregateShares(['/me/a', '/me/b'], new Map([
            ['/me/a', [grant('ann', 'read')]],
            ['/me/b', [grant('ann', 'read')]],
        ]));

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            key: 'user:ann',
            name: 'ann',
            directPaths: ['/me/a', '/me/b'],
            mode: 'read',
            accessCount: 2,
        });
    });

    it('reports a mode of null when the grants disagree', () => {
        const groups = aggregateShares(['/me/a', '/me/b'], new Map([
            ['/me/a', [grant('ann', 'read')]],
            ['/me/b', [grant('ann', 'write')]],
        ]));

        // The dialog opens on a placeholder rather than presenting one item's
        // mode as the whole selection's.
        expect(groups[0].mode).toBe(null);
    });

    it('counts a person who holds only some of the items', () => {
        const groups = aggregateShares(['/me/a', '/me/b', '/me/c'], new Map([
            ['/me/a', [grant('ann', 'read')]],
            ['/me/b', []],
            ['/me/c', [grant('ann', 'read')]],
        ]));

        expect(groups[0].accessCount).toBe(2);
        expect(groups[0].directPaths).toEqual(['/me/a', '/me/c']);
    });

    it('keeps inherited grants out of what the dialog can change', () => {
        const groups = aggregateShares(['/me/a', '/me/b'], new Map([
            ['/me/a', [grant('ann', 'read')]],
            ['/me/b', [grant('ann', 'read', { inheritedFrom: '/me/Documents' })]],
        ]));

        expect(groups[0].directPaths).toEqual(['/me/a']);
        expect(groups[0].inheritedPaths).toEqual(['/me/b']);
        expect(groups[0].inheritedFrom).toBe('/me/Documents');
        // Reachable either way, so both items count as shared with them.
        expect(groups[0].accessCount).toBe(2);
    });

    it('drops the single-ancestor label when inherited grants come from several', () => {
        const groups = aggregateShares(['/me/a', '/me/b'], new Map([
            ['/me/a', [grant('ann', 'read', { inheritedFrom: '/me/Documents' })]],
            ['/me/b', [grant('ann', 'read', { inheritedFrom: '/me/Pictures' })]],
        ]));

        expect(groups[0].inheritedFrom).toBe(null);
        expect(groups[0].inheritedMode).toBe('read');
    });

    it('keys an invitation by its email, apart from any username', () => {
        const groups = aggregateShares(['/me/a', '/me/b'], new Map([
            ['/me/a', [grant(null, 'read', { pending: true, recipientEmail: 'ann@example.com' })]],
            ['/me/b', [grant('ann', 'write')]],
        ]));

        expect(groups.map((g) => g.key)).toEqual(['invite:ann@example.com', 'user:ann']);
        expect(groups[0]).toMatchObject({
            pending: true,
            pendingPaths: ['/me/a'],
            pendingMode: 'read',
            directPaths: [],
        });
        expect(groups[1].directPaths).toEqual(['/me/b']);
    });

    it('counts an item once when two grants on it name the same person', () => {
        // Two holders can grant the same access; the item is still one item.
        const groups = aggregateShares(['/me/a'], new Map([
            ['/me/a', [
                grant('ann', 'read', { issuer: 'me' }),
                grant('ann', 'read', { issuer: 'bob' }),
            ]],
        ]));

        expect(groups[0].directPaths).toEqual(['/me/a']);
        expect(groups[0].accessCount).toBe(1);
    });

    it('lists people in the order the items first mention them', () => {
        const groups = aggregateShares(['/me/a', '/me/b'], new Map([
            ['/me/a', [grant('zed', 'read')]],
            ['/me/b', [grant('ann', 'read'), grant('zed', 'read')]],
        ]));

        expect(groups.map((g) => g.name)).toEqual(['zed', 'ann']);
    });

    it('ignores items with no listing behind them', () => {
        // A getShares that failed contributes nothing rather than throwing.
        const groups = aggregateShares(['/me/a', '/me/b'], new Map([
            ['/me/a', [grant('ann', 'read')]],
        ]));

        expect(groups[0].accessCount).toBe(1);
    });

    it('skips a grant that names nobody', () => {
        const groups = aggregateShares(['/me/a'], new Map([
            ['/me/a', [grant(null, 'read'), grant('ann', 'read')]],
        ]));

        expect(groups.map((g) => g.name)).toEqual(['ann']);
    });

    it('gives a team a row of its own, named and keyed on the team', () => {
        // A team share names no holder; without this it would be dropped as a
        // grant that names nobody and the share would vanish from the list.
        const groups = aggregateShares(['/me/a'], new Map([
            ['/me/a', [grant(null, 'read', {
                holderTeam: { uid: 't-1', name: 'Acme', handle: 'acme' },
            })]],
        ]));

        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
            key: 'team:t-1',
            name: 'Acme',
            teamUid: 't-1',
            mode: 'read',
        });
    });

    it('falls back to the handle, then the uid, for an unnamed team', () => {
        // Whatever team_label says, so a team reads the same here as it does
        // in the desktop dialog's access list.
        const named = (team) => aggregateShares(['/me/a'], new Map([
            ['/me/a', [grant(null, 'read', { holderTeam: team })]],
        ]))[0].name;

        expect(named({ uid: 't-1', name: null, handle: 'acme' })).toBe('acme');
        expect(named({ uid: 't-1', name: null, handle: null })).toBe('t-1');
    });

    it('keeps a team and a person of the same name apart', () => {
        const groups = aggregateShares(['/me/a'], new Map([
            ['/me/a', [
                grant('ann', 'read'),
                grant(null, 'write', { holderTeam: { uid: 't-1', name: 'ann' } }),
            ]],
        ]));

        expect(groups.map((g) => g.key)).toEqual(['user:ann', 'team:t-1']);
    });

    it('leaves teamUid null on a person, so their row still shares by name', () => {
        const groups = aggregateShares(['/me/a'], new Map([
            ['/me/a', [grant('ann', 'read')]],
        ]));

        expect(groups[0].teamUid).toBe(null);
    });
});

describe('missingPathsFor', () => {
    it('returns the items the person cannot reach at all', () => {
        const paths = ['/me/a', '/me/b', '/me/c'];
        const [group] = aggregateShares(paths, new Map([
            ['/me/a', [grant('ann', 'read')]],
            ['/me/b', [grant('ann', 'read', { inheritedFrom: '/me/Documents' })]],
        ]));

        // Inherited access still counts as reaching the item.
        expect(missingPathsFor(paths, group)).toEqual(['/me/c']);
    });

    it('returns nothing when the person already has every item', () => {
        const paths = ['/me/a'];
        const [group] = aggregateShares(paths, new Map([
            ['/me/a', [grant('ann', 'read')]],
        ]));

        expect(missingPathsFor(paths, group)).toEqual([]);
    });
});

describe('aggregateOwners', () => {
    it('counts each owner once, in first-seen order', () => {
        expect(aggregateOwners(['ann', 'bob', 'ann'])).toEqual([
            { name: 'ann', count: 2 },
            { name: 'bob', count: 1 },
        ]);
    });

    it('skips items whose path names no owner', () => {
        expect(aggregateOwners([null, 'ann', undefined])).toEqual([
            { name: 'ann', count: 1 },
        ]);
    });
});
