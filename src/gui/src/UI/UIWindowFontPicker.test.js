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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

vi.mock('./UIWindow.js', () => ({ default: async options => {
    const el = document.createElement('div');
    el.innerHTML = options.body_content;
    document.body.append(el);
    return el;
} }));

globalThis.$ = jQuery;
window.html_encode = value => String(value);
window.i18n = key => key;
window.isString = variable => typeof variable === 'string' || variable instanceof String;
document.fonts = { ready: Promise.resolve(), check: () => true };

const { default: UIWindowFontPicker } = await import('./UIWindowFontPicker.js');

const activeFont = () => {
    const el = document.querySelector('.font-selector-active');
    return el ? el.getAttribute('data-font-family') : null;
};

describe('UIWindowFontPicker default selection', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it.each([
        ['defaultFont', { defaultFont: 'Verdana' }, 'Verdana'],
        ['defaultValue', { defaultValue: 'Georgia' }, 'Georgia'],
        ['default', { default: 'Tahoma' }, 'Tahoma'],
        ['a bare font name', 'Georgia', 'Georgia'],
        ['defaultFont over both aliases', { defaultFont: 'Georgia', defaultValue: 'Arial', default: 'Verdana' }, 'Georgia'],
        ['defaultValue over default', { defaultValue: 'Arial', default: 'Verdana' }, 'Arial'],
        ['an alias when defaultFont is empty', { defaultFont: '', defaultValue: 'Georgia' }, 'Georgia'],
        ['nothing without a default', {}, null],
    ])('preselects %s', async (_, options, expected) => {
        UIWindowFontPicker(options);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(activeFont()).toBe(expected);
    });
});
