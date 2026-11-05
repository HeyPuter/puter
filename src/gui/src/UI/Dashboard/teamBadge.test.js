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

// Mirrors the real i18n: encodes unless the third argument is false.
globalThis.i18n = (key, args, encode = true) => {
    const raw = `${key}:${(args ?? []).join(',')}`;
    return encode ? raw.replace(/&/g, '&amp;') : raw;
};
globalThis.window = { html_encode: (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;') };

const { teamBadgeHtml } = await import('./teamBadge.js');

describe('the sidebar team badge', () => {
    it('names the team for a seat', () => {
        const h = teamBadgeHtml({ team: { uid: 't-1', name: 'Acme Corp' } });
        expect(h).toContain('dashboard-sidebar-team');
        expect(h).toContain('Acme Corp');
    });

    it('says nothing for anyone who is not a seat', () => {
        // whoami omits `team` entirely for an ordinary account or an owner.
        for (const user of [undefined, {}, { team: undefined }, { team: {} }]) {
            expect(teamBadgeHtml(user)).toBe('');
        }
    });

    it('treats a blank name as nothing to say', () => {
        expect(teamBadgeHtml({ team: { uid: 't-1', name: '   ' } })).toBe('');
    });

    it('encodes the name, which an admin chose', () => {
        const h = teamBadgeHtml({ team: { name: '<script>x</script>' } });
        expect(h).not.toContain('<script>');
        expect(h).toContain('&lt;script');
    });

    it('explains itself in the title, for a truncated name', () => {
        const h = teamBadgeHtml({ team: { name: 'Acme' } });
        expect(h).toContain('teams_account_of:Acme');
    });
});

it('does not double-encode the tooltip', () => {
    const h = teamBadgeHtml({ team: { uid: 't-1', name: 'R&D' } });
    expect(h).toContain('title="teams_account_of:R&amp;D"');
    expect(h).not.toContain('&amp;amp;');
});
