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

describe('Ctrl/Cmd+Z', () => {
    it('undoes one action per press', () => {
        window.undo_last_action = vi.fn();
        const z = { key: 'z', keyCode: 90, which: 90, metaKey: true, bubbles: true };
        document.body.dispatchEvent(new KeyboardEvent('keydown', z));
        // Z let go before Cmd.
        document.body.dispatchEvent(new KeyboardEvent('keyup', z));
        expect(window.undo_last_action).toHaveBeenCalledTimes(1);
    });
});
