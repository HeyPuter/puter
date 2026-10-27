// @vitest-environment jsdom
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

import { describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('../UI/UIItem.js', () => ({ default: vi.fn() }));
vi.mock('./itemIcon.js', () => ({
    default: vi.fn(async () => ({ image: '', type: 'icon' })),
}));
vi.mock('./listAllShared.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = (key) => key;
jQuery.fn.removeItems = function () {
    return this.remove();
};
window.icons = {};
Object.assign(window, {
    Transaction: class {
        start() {}
        end() {}
    },
    shared_path: '/alice/Shared',
    trash_path: '/alice/Trash',
    user_preferences: {},
    desktop_item_positions: {},
    check_fsentry_against_allowed_file_types_string: () => true,
    sort_items: () => {},
    update_explorer_footer_item_count: () => {},
});

const { default: refresh_item_container } =
    await import('./refreshItemContainer.js');
const { default: UIItem } = await import('../UI/UIItem.js');
const { default: list_all_shared } = await import('./listAllShared.js');

describe('refresh_item_container in the Shared view', () => {
    it('flags rows shared through a team, and only those', async () => {
        list_all_shared.mockResolvedValue([
            {
                entryUid: 'u-1',
                name: 'a.txt',
                path: '/bob/u-1/a.txt',
                isDir: false,
                mode: 'read',
                issuer: 'bob',
                owner: 'bob',
            },
            {
                entryUid: 'u-2',
                name: 'b.txt',
                path: '/bob/u-2/b.txt',
                isDir: false,
                mode: 'read',
                issuer: 'bob',
                owner: 'bob',
                holderTeam: { uid: 't-1', name: 'Acme' },
            },
        ]);
        document.body.innerHTML =
            '<div class="window"><div class="item-container" data-path="/alice/Shared"></div></div>';

        refresh_item_container($('.item-container'));

        await vi.waitFor(() => expect(UIItem).toHaveBeenCalledTimes(2));
        const [direct, team] = UIItem.mock.calls.map(([options]) => options);
        expect(direct).toMatchObject({
            uid: 'u-1',
            shared_with_me: true,
            share_mode: 'read',
            shared_by: 'bob',
            is_team_share: false,
        });
        expect(team).toMatchObject({
            uid: 'u-2',
            shared_with_me: true,
            is_team_share: true,
        });
    });
});
