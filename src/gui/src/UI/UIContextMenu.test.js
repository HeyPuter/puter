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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.html_encode = (value) => jQuery('<div>').text(value ?? '').html();
globalThis.isMobile = { phone: false, tablet: false };
// Supplies the `remove` event the menu cleans up on.
await import('../lib/jquery-ui-1.13.2/jquery-ui.js');
const { default: UIContextMenu } = await import('./UIContextMenu.js');

const SUBMENU_DELAY = 300;
const FADE_OUT = 220;

const menuWith = (label) => $('.context-menu').filter((_, menu) =>
    $(menu).find('.contextmenu-label').toArray().some(el => $(el).text() === label));
const row = (label) => $('.context-menu-item').filter((_, item) =>
    $(item).children('.contextmenu-label').text() === label);
/** Points at a row long enough for its submenu to open. */
const openSubmenu = (label) => {
    row(label).trigger('mouseenter', { keyboard: true });
    vi.advanceTimersByTime(SUBMENU_DELAY);
};
const openLabels = () => $('.context-menu .contextmenu-label').map((_, el) => $(el).text()).get();

/** A menu three levels deep: File > Open With > Always Open With. */
const nestedItems = (onChoose = () => {}) => [
    { html: 'Open' },
    {
        html: 'Open With',
        items: [
            { html: 'Editor' },
            {
                html: 'Always Open With',
                items: [
                    { html: 'Code', onClick: onChoose },
                ],
            },
        ],
    },
];

beforeEach(() => {
    vi.useFakeTimers();
    jQuery.fx.off = true;
    document.body.innerHTML = '';
    Object.assign(window, { global_element_id: 1, icons: {}, mouseX: 0, mouseY: 0 });
});

afterEach(() => {
    $('.context-menu').remove();
    vi.useRealTimers();
});

describe('UIContextMenu submenus', () => {
    it('opens a submenu inside a submenu', () => {
        UIContextMenu({ items: nestedItems() });
        openSubmenu('Open With');
        openSubmenu('Always Open With');
        expect($('.context-menu')).toHaveLength(3);
        expect(menuWith('Code').attr('data-parent-id')).toBe(menuWith('Editor').attr('data-element-id'));
    });

    it('closes every menu above an item chosen in a nested submenu', () => {
        const onChoose = vi.fn();
        const onClose = vi.fn();
        UIContextMenu({ items: nestedItems(onChoose), onClose });
        openSubmenu('Open With');
        openSubmenu('Always Open With');

        row('Code').trigger('click');
        vi.advanceTimersByTime(FADE_OUT);

        expect(onChoose).toHaveBeenCalledOnce();
        expect(openLabels()).toEqual([]);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes a nested submenu with the submenu it belongs to', () => {
        UIContextMenu({ items: nestedItems() });
        openSubmenu('Open With');
        openSubmenu('Always Open With');

        // Pointing at another row of the root menu closes its open submenu.
        row('Open').trigger('mouseenter', { keyboard: true });

        expect(openLabels()).toEqual(['Open', 'Open With']);
    });
});
