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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UIWindowItemProperties.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowSaveAccount.js', () => ({ default: vi.fn() }));
vi.mock('./UIPopover.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowEmailConfirmationRequired.js', () => ({ default: vi.fn() }));
vi.mock('./UIContextMenu.js', () => ({ default: vi.fn() }));
vi.mock('./UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowPublishWorker.js', () => ({ default: vi.fn() }));
vi.mock('./UIWindowShare.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/launchApp.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/openItem.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/publishAsWebsite.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/openWithAI.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/refreshItemContainer.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.def = globalThis.def ?? ((value) => value);
globalThis.use = globalThis.use ?? (() => class {});
globalThis.html_encode = (value) =>
    jQuery('<div>')
        .text(value ?? '')
        .html();
globalThis.i18n = (key) => key;
globalThis.isMobile = { phone: false, tablet: false };
globalThis.timeago = { format: () => '' };
for (const plugin of ['draggable', 'droppable', 'dragster']) {
    jQuery.fn[plugin] = function () {
        return this;
    };
}
jQuery.fn.removeItems = function () {
    return this.remove();
};
window.icons = {};
Object.assign(window, {
    determine_website_url: () => null,
    check_fsentry_against_allowed_file_types_string: () => true,
    toggle_empty_folder_message: () => {},
    update_explorer_footer_item_count: () => {},
    byte_format: (bytes) => `${bytes} B`,
    suggest_apps_for_fsentry: async () => [],
    feature_flags: {},
    clipboard: [],
});

const { default: UIItem } = await import('./UIItem.js');
const { default: UIContextMenu } = await import('./UIContextMenu.js');
const { default: refresh_item_container } =
    await import('../helpers/refreshItemContainer.js');

const menuLabels = async (options) => {
    document.body.innerHTML =
        '<div class="window"><div class="item-container"></div></div>';
    await UIItem({
        appendTo: $('.item-container'),
        uid: 'u-1',
        path: '/bob/u-1/Photos',
        name: 'Photos',
        is_dir: true,
        icon: { image: '', type: 'icon' },
        shared_with_me: true,
        share_mode: 'read',
        shared_by: 'bob',
        owner: 'bob',
        ...options,
    });
    UIContextMenu.mockClear();
    $('.item').trigger('contextmenu');
    await vi.waitFor(() => expect(UIContextMenu).toHaveBeenCalled());
    return UIContextMenu.mock.calls[0][0].items.map((item) => item?.html);
};

const removeFromShared = async (options) => {
    await menuLabels(options);
    await UIContextMenu.mock.calls[0][0].items
        .find((item) => item?.html === 'share_remove_from_shared')
        .onClick();
};

describe('UIItem Remove from Shared', () => {
    beforeEach(() => {
        window.user = { username: 'alice' };
        window.trash_path = '/alice/Trash';
        window.puter = {
            fs: {
                listShared: vi.fn(async () => ({ items: [] })),
                unshare: vi.fn(async () => ({ revoked: 1 })),
            },
        };
        globalThis.puter = window.puter;
        refresh_item_container.mockClear();
    });

    it('is offered on an item shared with the user directly', async () => {
        expect(await menuLabels({})).toContain('share_remove_from_shared');
    });

    it('is not offered on an item shared through a team', async () => {
        const labels = await menuLabels({ is_team_share: true });
        expect($('.item').attr('data-is_team_share')).toBe('1');
        expect(labels).not.toContain('share_remove_from_shared');
    });

    it('takes the item away once the user has left it', async () => {
        await removeFromShared({});
        expect(puter.fs.unshare).toHaveBeenCalledWith('/bob/u-1/Photos', 'alice');
        expect($('.item')).toHaveLength(0);
        expect(refresh_item_container).not.toHaveBeenCalled();
    });

    it('lists the item again when a team still shares it', async () => {
        await removeFromShared({ is_also_team_share: true });
        expect(puter.fs.unshare).toHaveBeenCalledWith('/bob/u-1/Photos', 'alice');
        expect($('.item')).toHaveLength(1);
        expect(refresh_item_container).toHaveBeenCalledTimes(1);
        expect(refresh_item_container.mock.calls[0][0][0]).toBe($('.item-container')[0]);
    });
});
