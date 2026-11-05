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

// Mirrors the real i18n: named placeholders, encoded unless the third argument is false.
globalThis.i18n = (key, args, encode = true) => {
    const raw = `${key}:${Object.values(args ?? {}).join(',')}`;
    return encode ? raw.replace(/&/g, '&amp;').replace(/</g, '&lt;') : raw;
};
globalThis.window = {
    html_encode: (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
};

const {
    compareSharers,
    filterBySharer,
    fitSharedByWidth,
    sharedByCellHtml,
    sharedByTitle,
    sharerFilterHtml,
    sharerOf,
    summarizeSharers,
} = await import('./sharedBy.js');

const row = (shared_by, owner = shared_by, name = 'f') => ({ shared_by, owner, name });

describe('sharerOf', () => {
    it('names whoever granted the share', () => {
        expect(sharerOf(row('ann', 'bob'))).toBe('ann');
    });

    it('falls back to the owner for a grant with no issuer', () => {
        expect(sharerOf({ shared_by: null, owner: 'bob' })).toBe('bob');
    });

    it('is empty when the row names nobody', () => {
        expect(sharerOf({})).toBe('');
        expect(sharerOf(undefined)).toBe('');
    });
});

describe('summarizeSharers', () => {
    it('counts each sharer, most items first', () => {
        const sharers = summarizeSharers([row('ann'), row('bob'), row('bob'), row('cy')]);
        expect(sharers).toEqual([
            { name: 'bob', count: 2 },
            { name: 'ann', count: 1 },
            { name: 'cy', count: 1 },
        ]);
    });

    it('orders ties by name, ignoring case', () => {
        expect(summarizeSharers([row('Zed'), row('amy'), row('Bo')]).map((s) => s.name))
            .toEqual(['amy', 'Bo', 'Zed']);
    });

    it('skips rows that name nobody', () => {
        expect(summarizeSharers([{}, row('ann')])).toEqual([{ name: 'ann', count: 1 }]);
    });
});

describe('filterBySharer', () => {
    const rows = [row('ann', 'ann', 'a'), row('bob', 'bob', 'b'), row(null, 'ann', 'c')];

    it('keeps only what that person shared, owner fallback included', () => {
        expect(filterBySharer(rows, 'ann').map((r) => r.name)).toEqual(['a', 'c']);
    });

    it('keeps everything without a filter', () => {
        expect(filterBySharer(rows, null)).toBe(rows);
        expect(filterBySharer(rows, '')).toBe(rows);
    });
});

describe('compareSharers', () => {
    it('sorts by sharer, ignoring case', () => {
        const sorted = [row('carl'), row('Ann'), row('bob')].sort(compareSharers);
        expect(sorted.map(sharerOf)).toEqual(['Ann', 'bob', 'carl']);
    });

    it('treats accented and plain letters alike', () => {
        expect(compareSharers(row('José'), row('jose'))).toBe(0);
    });
});

describe('fitSharedByWidth', () => {
    it('keeps the width while the name has the larger part', () => {
        expect(fitSharedByWidth(160, 1200)).toBe(160);
    });

    it('yields to the name in a narrow listing', () => {
        // A 530px listing leaves 230px for the name and "Shared by" together.
        expect(fitSharedByWidth(160, 230)).toBe(92);
    });

    it('never goes under the column minimum', () => {
        expect(fitSharedByWidth(160, 50)).toBe(60);
    });
});

describe('sharedByTitle', () => {
    it('names the sharer', () => {
        expect(sharedByTitle(row('ann'))).toBe('shared_by_user:ann');
    });

    it('names the owner too when someone else re-shared it', () => {
        expect(sharedByTitle(row('ann', 'bob'))).toBe('shared_by_user_owned_by:ann,bob');
    });
});

describe('sharedByCellHtml', () => {
    it('shows an avatar and the sharer', () => {
        const h = sharedByCellHtml(row('ann'));
        expect(h).toContain('class="item-shared-by"');
        expect(h).toContain('>A</span>');
        expect(h).toContain('<span class="item-shared-by-name">ann</span>');
    });

    it('marks the avatar for the sharer\'s picture', () => {
        expect(sharedByCellHtml(row('ann', 'bob'))).toContain('data-avatar-user="ann"');
    });

    it('encodes the username', () => {
        const h = sharedByCellHtml(row('<b>"x"'));
        expect(h).not.toContain('<b>');
        expect(h).toContain('&lt;b>&quot;x&quot;');
    });

    it('still renders an empty cell, so the columns line up', () => {
        expect(sharedByCellHtml({})).toBe('<div class="item-shared-by"></div>');
    });
});

describe('sharerFilterHtml', () => {
    it('is empty with fewer than two sharers', () => {
        expect(sharerFilterHtml([], null)).toBe('');
        expect(sharerFilterHtml([{ name: 'ann', count: 3 }], null)).toBe('');
    });

    it('leads with Everyone, counting every item', () => {
        const h = sharerFilterHtml([{ name: 'bob', count: 2 }, { name: 'ann', count: 1 }], null);
        const chips = h.match(/<button[^>]*>/g);
        expect(chips).toHaveLength(3);
        expect(chips[0]).toContain('data-sharer=""');
        expect(chips[0]).toContain('aria-pressed="true"');
        expect(h).toContain('shared_filter_everyone:</span><span class="sharer-chip-count">3</span>');
        expect(chips[1]).toContain('data-sharer="bob"');
        expect(h).toContain('data-avatar-user="bob"');
    });

    it('presses the active sharer only', () => {
        const h = sharerFilterHtml([{ name: 'bob', count: 2 }, { name: 'ann', count: 1 }], 'ann');
        const pressed = h.match(/<button[^>]*aria-pressed="true"[^>]*>/g);
        expect(pressed).toHaveLength(1);
        expect(pressed[0]).toContain('data-sharer="ann"');
        expect(pressed[0]).toContain('sharer-chip active');
    });

    it('encodes usernames in values and labels', () => {
        const h = sharerFilterHtml([{ name: 'a"b', count: 1 }, { name: '<i>', count: 1 }], null);
        expect(h).toContain('data-sharer="a&quot;b"');
        expect(h).not.toContain('<i>');
    });
});
