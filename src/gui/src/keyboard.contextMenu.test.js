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
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./helpers/launchApp.js', () => ({ default: vi.fn() }));
vi.mock('./helpers/openItem.js', () => ({ default: vi.fn() }));

globalThis.$ = globalThis.jQuery = jQuery;
globalThis.i18n = key => key;
globalThis.html_encode = (value) => jQuery('<div>').text(value ?? '').html();
globalThis.isMobile = { phone: false, tablet: false };
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});

await import('./lib/jquery-ui-1.13.2/jquery-ui.js');
const { default: UIContextMenu } = await import('./UI/UIContextMenu.js');
await import('./keyboard.js');

const KEYS = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
const SUBMENU_DELAY = 300;

const press = (key) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: KEYS[key], which: KEYS[key], bubbles: true }));
    vi.advanceTimersByTime(SUBMENU_DELAY);
};
/** The highlighted rows of every open menu, top menu first. */
const highlighted = () => $('.context-menu').map((_, menu) =>
    $(menu).find('.context-menu-item-active > .contextmenu-label').text()).get();

beforeEach(() => {
    vi.useFakeTimers();
    jQuery.fx.off = true;
    document.body.innerHTML = '';
    Object.assign(window, { global_element_id: 1, icons: {}, mouseX: 0, mouseY: 0 });
    UIContextMenu({
        items: [
            { html: 'Open' },
            {
                html: 'Open With',
                items: [
                    { html: 'Editor' },
                    {
                        html: 'Always Open With',
                        items: [{ html: 'Code' }, { html: 'Viewer' }],
                    },
                ],
            },
        ],
    });
});

afterEach(() => {
    $('.context-menu').remove();
    vi.useRealTimers();
});

describe('arrow keys in a submenu of a submenu', () => {
    const openNestedSubmenu = () => {
        press('ArrowDown');
        press('ArrowDown');
        press('ArrowRight');
        press('ArrowDown');
        press('ArrowDown');
        press('ArrowRight');
    };

    it('leaves the rows of the menu it was opened from alone', () => {
        openNestedSubmenu();
        expect($('.context-menu')).toHaveLength(3);
        expect(highlighted()).toEqual(['', '', '']);
    });

    it('moves through the nested submenu and back out of it', () => {
        openNestedSubmenu();
        press('ArrowDown');
        expect(highlighted()).toEqual(['', '', 'Code']);

        press('ArrowLeft');
        expect($('.context-menu')).toHaveLength(2);
        expect(highlighted()).toEqual(['', 'Always Open With']);
    });
});
