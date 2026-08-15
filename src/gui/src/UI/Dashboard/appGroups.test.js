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

import { describe, it, expect } from 'vitest';
import {
    parseAppGroups,
    serializeAppGroups,
    normalizeGroupName,
    defaultGroupName,
    findGroupOfApp,
    findGroupById,
    buildGridItems,
    flattenGridItems,
    orderWithAppAfter,
    createGroup,
    addAppToGroup,
    removeAppFromGroups,
    removeGroup,
    renameGroup,
    reorderGroupApps,
    MAX_GROUP_NAME_LENGTH,
} from './appGroups.js';
import { reconcileAppOrder, serializeAppOrder } from './appOrder.js';

const mk = (...ns) => ns.map(n => ({ name: n }));
const names = apps => apps.map(a => a.name);
const group = (id, name, ...apps) => ({ id, name, apps });
// The grid as the user reads it: 'a' for a loose app, '[Work: a, b]' for a folder.
const shape = items => items.map(item => (
    item.type === 'group'
        ? `[${item.group.name}: ${names(item.apps).join(', ')}]`
        : item.app.name
));

describe('normalizeGroupName', () => {
    it('collapses whitespace and trims', () => {
        expect(normalizeGroupName('  Work   Stuff \n')).toBe('Work Stuff');
    });

    it('clips to the stored maximum', () => {
        expect(normalizeGroupName('x'.repeat(200))).toHaveLength(MAX_GROUP_NAME_LENGTH);
    });

    it('returns an empty string for anything unusable', () => {
        expect(normalizeGroupName('   ')).toBe('');
        expect(normalizeGroupName(null)).toBe('');
        expect(normalizeGroupName(42)).toBe('');
    });
});

describe('parseAppGroups', () => {
    it('parses a JSON string and an already-deserialized array alike', () => {
        const raw = [group('g1', 'Work', 'a', 'b')];
        expect(parseAppGroups(JSON.stringify(raw))).toEqual(raw);
        expect(parseAppGroups(raw)).toEqual(raw);
    });

    it('returns no folders for never-saved or corrupt values', () => {
        expect(parseAppGroups(null)).toEqual([]);
        expect(parseAppGroups('not json')).toEqual([]);
        expect(parseAppGroups('{"nope":1}')).toEqual([]);
        expect(parseAppGroups(7)).toEqual([]);
    });

    it('drops folders of fewer than two apps', () => {
        // A folder of one is strictly worse than a plain tile.
        const out = parseAppGroups([group('g1', 'Solo', 'a'), group('g2', 'Pair', 'b', 'c')]);
        expect(out.map(g => g.id)).toEqual(['g2']);
    });

    it('gives an app claimed by two folders to the first, and drops the loser if that empties it', () => {
        const out = parseAppGroups([
            group('g1', 'First', 'a', 'b'),
            group('g2', 'Second', 'a', 'b'),
            group('g3', 'Third', 'a', 'c', 'd'),
        ]);
        expect(out.map(g => g.id)).toEqual(['g1', 'g3']);
        expect(out[1].apps).toEqual(['c', 'd']);
    });

    it('drops entries without a usable id and de-duplicates ids', () => {
        const out = parseAppGroups([
            { name: 'No id', apps: ['a', 'b'] },
            group('g1', 'Keep', 'a', 'b'),
            group('g1', 'Dup id', 'c', 'd'),
        ]);
        expect(out).toEqual([group('g1', 'Keep', 'a', 'b')]);
    });

    it('drops non-string and duplicate member names', () => {
        const out = parseAppGroups([{ id: 'g1', name: 'Work', apps: ['a', '', null, 'a', 'b', 3] }]);
        expect(out[0].apps).toEqual(['a', 'b']);
    });

    it('normalizes the name', () => {
        expect(parseAppGroups([{ id: 'g1', name: '  Work  ', apps: ['a', 'b'] }])[0].name).toBe('Work');
        expect(parseAppGroups([{ id: 'g1', apps: ['a', 'b'] }])[0].name).toBe('');
    });
});

describe('serializeAppGroups', () => {
    it('round-trips through parseAppGroups', () => {
        const groups = [group('g1', 'Work', 'a', 'b')];
        expect(parseAppGroups(JSON.stringify(serializeAppGroups(groups)))).toEqual(groups);
    });

    it('drops a folder an edit emptied below two members', () => {
        expect(serializeAppGroups([group('g1', 'Work', 'a')])).toEqual([]);
    });
});

describe('defaultGroupName', () => {
    it('uses the base name when it is free', () => {
        expect(defaultGroupName([], 'Folder')).toBe('Folder');
    });

    it('numbers around names already in use', () => {
        const groups = [group('g1', 'Folder', 'a', 'b'), group('g2', 'Folder 2', 'c', 'd')];
        expect(defaultGroupName(groups, 'Folder')).toBe('Folder 3');
    });
});

describe('findGroupOfApp / findGroupById', () => {
    const groups = [group('g1', 'Work', 'a', 'b')];

    it('finds the folder holding an app', () => {
        expect(findGroupOfApp(groups, 'b').id).toBe('g1');
        expect(findGroupOfApp(groups, 'z')).toBe(null);
        expect(findGroupOfApp(null, 'a')).toBe(null);
    });

    it('finds a folder by id', () => {
        expect(findGroupById(groups, 'g1').name).toBe('Work');
        expect(findGroupById(groups, 'nope')).toBe(null);
    });
});

describe('buildGridItems', () => {
    it('passes apps straight through when there are no folders', () => {
        expect(shape(buildGridItems(mk('a', 'b'), []))).toEqual(['a', 'b']);
        expect(shape(buildGridItems(mk('a', 'b'), null))).toEqual(['a', 'b']);
    });

    it('puts a folder in the slot of its first present member', () => {
        const items = buildGridItems(mk('a', 'b', 'c', 'd'), [group('g1', 'Work', 'b', 'd')]);
        expect(shape(items)).toEqual(['a', '[Work: b, d]', 'c']);
    });

    it('orders members by the folder record, not by grid order', () => {
        const items = buildGridItems(mk('a', 'b', 'c'), [group('g1', 'Work', 'c', 'a')]);
        expect(shape(items)).toEqual(['[Work: c, a]', 'b']);
    });

    it('renders a folder whose members mostly failed to load as a loose tile', () => {
        // 'b' is missing this session; the record is untouched, but one member
        // is not a folder — it draws as the plain app it is.
        const items = buildGridItems(mk('a', 'c'), [group('g1', 'Work', 'a', 'b')]);
        expect(shape(items)).toEqual(['a', 'c']);
    });

    it('drops nothing when every member is missing', () => {
        expect(shape(buildGridItems(mk('c'), [group('g1', 'Work', 'a', 'b')]))).toEqual(['c']);
    });

    it('does not mutate the folder records it reads', () => {
        const groups = [group('g1', 'Work', 'c', 'a')];
        buildGridItems(mk('a', 'b', 'c'), groups);
        expect(groups[0].apps).toEqual(['c', 'a']);
    });

    it('handles non-array input defensively', () => {
        expect(buildGridItems(null, [])).toEqual([]);
    });
});

describe('flattenGridItems', () => {
    it('expands folders in place, members contiguous', () => {
        const apps = mk('a', 'b', 'c', 'd');
        const items = buildGridItems(apps, [group('g1', 'Work', 'b', 'd')]);
        expect(names(flattenGridItems(items))).toEqual(['a', 'b', 'd', 'c']);
    });

    it('round-trips into a saved app order that rebuilds the same grid', () => {
        const apps = mk('a', 'b', 'c', 'd');
        const groups = [group('g1', 'Work', 'b', 'd')];
        const order = serializeAppOrder(flattenGridItems(buildGridItems(apps, groups)));
        const rebuilt = buildGridItems(reconcileAppOrder(apps, order), groups);
        expect(shape(rebuilt)).toEqual(['a', '[Work: b, d]', 'c']);
    });

    it('handles non-array input defensively', () => {
        expect(flattenGridItems(null)).toEqual([]);
    });
});

describe('orderWithAppAfter', () => {
    it('moves a name to just after the last anchor', () => {
        expect(orderWithAppAfter(['a', 'b', 'c', 'd'], 'd', ['b', 'c'])).toEqual(['a', 'b', 'c', 'd']);
        expect(orderWithAppAfter(['a', 'b', 'c', 'd'], 'a', ['b', 'c'])).toEqual(['b', 'c', 'a', 'd']);
    });

    it('appends when no anchor is present rather than jumping to the front', () => {
        expect(orderWithAppAfter(['a', 'b'], 'a', ['zz'])).toEqual(['b', 'a']);
    });

    it('inserts a name that was not in the list at all', () => {
        expect(orderWithAppAfter(['a', 'b'], 'new', ['a'])).toEqual(['a', 'new', 'b']);
    });

    it('does not mutate its input', () => {
        const order = ['a', 'b', 'c'];
        orderWithAppAfter(order, 'c', ['a']);
        expect(order).toEqual(['a', 'b', 'c']);
    });
});

describe('createGroup', () => {
    it('creates a folder from two apps', () => {
        const { groups, id } = createGroup([], ['a', 'b'], 'Work');
        expect(id).toBeTruthy();
        expect(groups).toEqual([{ id, name: 'Work', apps: ['a', 'b'] }]);
    });

    it('takes the apps out of the folders they were in', () => {
        const before = [group('g1', 'Old', 'a', 'x', 'y')];
        const { groups, id } = createGroup(before, ['a', 'b'], 'New');
        expect(groups.find(g => g.id === 'g1').apps).toEqual(['x', 'y']);
        expect(groups.find(g => g.id === id).apps).toEqual(['a', 'b']);
    });

    it('dissolves a folder the move emptied below two members', () => {
        const { groups, id } = createGroup([group('g1', 'Old', 'a', 'x')], ['a', 'b'], 'New');
        expect(groups.map(g => g.id)).toEqual([id]);
    });

    it('refuses to make a folder without two distinct apps', () => {
        expect(createGroup([], ['a', 'a'], 'Work')).toEqual({ groups: [], id: null });
        expect(createGroup([], ['a'], 'Work')).toEqual({ groups: [], id: null });
    });
});

describe('addAppToGroup', () => {
    it('appends to the folder, where the drop landed', () => {
        const out = addAppToGroup([group('g1', 'Work', 'a', 'b')], 'g1', 'c');
        expect(out[0].apps).toEqual(['a', 'b', 'c']);
    });

    it('moves the app out of the folder it was in', () => {
        const before = [group('g1', 'Work', 'a', 'b'), group('g2', 'Play', 'c', 'd')];
        const out = addAppToGroup(before, 'g1', 'c');
        expect(out.find(g => g.id === 'g1').apps).toEqual(['a', 'b', 'c']);
        // 'g2' is down to one member, so it dissolves.
        expect(out.find(g => g.id === 'g2')).toBeUndefined();
    });

    it('is a no-op for an unknown folder or an app already in it', () => {
        const before = [group('g1', 'Work', 'a', 'b')];
        expect(addAppToGroup(before, 'nope', 'c')).toEqual(before);
        expect(addAppToGroup(before, 'g1', 'a')).toEqual(before);
    });

    it('does not mutate its input', () => {
        const before = [group('g1', 'Work', 'a', 'b')];
        addAppToGroup(before, 'g1', 'c');
        expect(before[0].apps).toEqual(['a', 'b']);
    });
});

describe('removeAppFromGroups / removeGroup', () => {
    it('takes an app out of its folder', () => {
        const out = removeAppFromGroups([group('g1', 'Work', 'a', 'b', 'c')], 'b');
        expect(out[0].apps).toEqual(['a', 'c']);
    });

    it('dissolves the folder when that leaves one member', () => {
        expect(removeAppFromGroups([group('g1', 'Work', 'a', 'b')], 'b')).toEqual([]);
    });

    it('dissolves a folder outright', () => {
        const before = [group('g1', 'Work', 'a', 'b'), group('g2', 'Play', 'c', 'd')];
        expect(removeGroup(before, 'g1').map(g => g.id)).toEqual(['g2']);
    });
});

describe('renameGroup', () => {
    it('renames and normalizes', () => {
        expect(renameGroup([group('g1', 'Work', 'a', 'b')], 'g1', '  Play  ')[0].name).toBe('Play');
    });

    it('keeps the old name when the new one is unusable', () => {
        expect(renameGroup([group('g1', 'Work', 'a', 'b')], 'g1', '   ')[0].name).toBe('Work');
    });
});

describe('reorderGroupApps', () => {
    it('applies the on-screen order', () => {
        const out = reorderGroupApps([group('g1', 'Work', 'a', 'b', 'c')], 'g1', ['c', 'a', 'b']);
        expect(out[0].apps).toEqual(['c', 'a', 'b']);
    });

    it('keeps members that were not on screen at the tail', () => {
        // 'm' did not load this session, so no drag could place it.
        const out = reorderGroupApps([group('g1', 'Work', 'a', 'm', 'b')], 'g1', ['b', 'a']);
        expect(out[0].apps).toEqual(['b', 'a', 'm']);
    });

    it('ignores names that are not members', () => {
        const out = reorderGroupApps([group('g1', 'Work', 'a', 'b')], 'g1', ['zz', 'b', 'a']);
        expect(out[0].apps).toEqual(['b', 'a']);
    });

    it('is a no-op for an unknown folder', () => {
        const before = [group('g1', 'Work', 'a', 'b')];
        expect(reorderGroupApps(before, 'nope', ['b', 'a'])).toEqual(before);
    });
});
