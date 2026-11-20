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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

// As the real window does, opens once: a second one focuses the first and returns nothing.
vi.mock('./UIWindow.js', () => ({
    default: vi.fn(async (opts) => {
        if ( document.querySelector('.window-save-account') ) return undefined;
        const el = document.createElement('div');
        el.className = `window ${opts.window_class}`;
        el.innerHTML = opts.body_content;
        el.onClose = opts.on_close;
        document.body.append(el);
        return el;
    }),
}));
vi.mock('./UIWindowEmailConfirmationRequired.js', () => ({ default: vi.fn() }));

globalThis.def = globalThis.def ?? (value => value);

const { default: UIWindowSaveAccount } = await import('./UIWindowSaveAccount.js');

const PENDING = Symbol('pending');
const settled = (promise) => Promise.race([promise, new Promise((r) => setTimeout(() => r(PENDING), 0))]);
const win = () => jQuery('.window-save-account');

beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.$ = jQuery;
    jQuery.fn.close = function () {
        this.each((_, el) => {
            el.remove();
            el.onClose?.();
        });
        return this;
    };
    globalThis.i18n = (key) => key;
    globalThis.html_encode = (value) => String(value);
    window.icons = {};
    window.uuidv4 = () => 'id-1';
});

afterEach(() => {
    delete jQuery.fn.close;
});

describe('UIWindowSaveAccount', () => {
    it('resolves false when it closes without saving', async () => {
        const result = UIWindowSaveAccount();
        await vi.waitFor(() => expect(win()).toHaveLength(1));
        win().close();
        await expect(result).resolves.toBe(false);
    });

    it('resolves false when one is already open, and leaves that one waiting', async () => {
        const first = UIWindowSaveAccount();
        await vi.waitFor(() => expect(win()).toHaveLength(1));

        await expect(UIWindowSaveAccount()).resolves.toBe(false);
        expect(win()).toHaveLength(1);
        expect(await settled(first)).toBe(PENDING);
    });
});
