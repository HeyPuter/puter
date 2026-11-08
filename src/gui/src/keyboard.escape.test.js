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
import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UI/UIAlert.js', () => ({ default: vi.fn() }));
vi.mock('./UI/UIWindowSearch.js', () => ({ default: vi.fn() }));
vi.mock('./helpers/launchApp.js', () => ({ default: vi.fn() }));
vi.mock('./helpers/openItem.js', () => ({ default: vi.fn() }));

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.i18n = key => key;
globalThis.def = globalThis.def ?? (value => value);
globalThis.use = globalThis.use ?? (() => class {});

await import('./keyboard.js');

const escape = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));

describe('Escape on a file dialog', () => {
    const closed = [];

    beforeEach(() => {
        closed.length = 0;
        jQuery.fn.close = function () {
            closed.push(...this.toArray());
            return this;
        };
        document.body.innerHTML = '<div class="window window-active window-filedialog"></div>';
    });

    it('closes the file dialog', () => {
        escape();
        expect(closed).toEqual([document.querySelector('.window-filedialog')]);
    });

    it('closes only a context menu open over it', () => {
        document.body.insertAdjacentHTML('beforeend', '<div class="context-menu"></div>');
        escape();
        expect(document.querySelector('.context-menu')).toBeNull();
        expect(closed).toEqual([]);

        escape();
        expect(closed).toEqual([document.querySelector('.window-filedialog')]);
    });
});
