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

import { describe, it, expect } from 'vitest';
import { is_window_hidden, is_window_on_screen, is_unseen_background_window } from './window_visibility.js';

// A `.window` element carrying the given data- attributes, in the shapes
// UIWindow actually writes them (is_visible as 0/1, is_minimized as either
// 0/1 from the markup or the string 'true'/'false' from later .attr() calls).
const win = (attrs = {}) => {
    const el = document.createElement('div');
    el.className = 'window';
    el.setAttribute('data-is_visible', attrs.visible ?? '1');
    if ( attrs.minimized !== undefined ) el.setAttribute('data-is_minimized', attrs.minimized);
    if ( attrs.launched_hidden ) el.setAttribute('data-launched_hidden', '1');
    return el;
};

describe('is_window_hidden', () => {
    it('is false for a window on screen', () => {
        expect(is_window_hidden(win())).toBe(false);
        expect(is_window_hidden(win({ minimized: '0' }))).toBe(false);
        expect(is_window_hidden(win({ minimized: 'false' }))).toBe(false);
    });

    it('is true for a window created hidden by a background launch', () => {
        expect(is_window_hidden(win({ visible: '0', minimized: '0' }))).toBe(true);
    });

    it('is true for a window hidden by puter.ui.hideWindow()', () => {
        // makeWindowInvisible only flips data-is_visible; nothing minimizes.
        expect(is_window_hidden(win({ visible: '0' }))).toBe(true);
    });

    it('is false for a merely minimized window, in either attribute shape', () => {
        expect(is_window_hidden(win({ minimized: '1' }))).toBe(false);
        expect(is_window_hidden(win({ minimized: 'true' }))).toBe(false);
    });

    it('is false for a missing element', () => {
        expect(is_window_hidden(null)).toBe(false);
        expect(is_window_hidden(undefined)).toBe(false);
    });
});

describe('is_window_on_screen', () => {
    it('is true only for a window the user can actually see', () => {
        expect(is_window_on_screen(win())).toBe(true);
        expect(is_window_on_screen(win({ minimized: 'false' }))).toBe(true);
    });

    it('is false for a minimized window', () => {
        expect(is_window_on_screen(win({ minimized: '1' }))).toBe(false);
        expect(is_window_on_screen(win({ minimized: 'true' }))).toBe(false);
    });

    it('is false for a hidden window, so reopening the app shows it', () => {
        // The dashboard tile / file row would otherwise focus a window that
        // stays invisible, and the click would do nothing at all.
        expect(is_window_on_screen(win({ visible: '0' }))).toBe(false);
        expect(is_window_on_screen(win({ visible: '0', minimized: '0' }))).toBe(false);
    });
});

describe('is_unseen_background_window', () => {
    it('is true only while a background launch has never been shown', () => {
        expect(is_unseen_background_window(win({ visible: '0', launched_hidden: true }))).toBe(true);
        // makeWindowVisible drops the marker the first time the window is
        // shown, whether the app showed itself or the user did.
        expect(is_unseen_background_window(win({ visible: '1' }))).toBe(false);
    });

    it('is false for an ordinary window, minimized or not', () => {
        expect(is_unseen_background_window(win())).toBe(false);
        expect(is_unseen_background_window(win({ minimized: 'true' }))).toBe(false);
        // A window the app hid itself with puter.ui.hideWindow() is the user's
        // too — it just isn't on screen.
        expect(is_unseen_background_window(win({ visible: '0' }))).toBe(false);
    });

    it('is false for a missing element', () => {
        expect(is_unseen_background_window(null)).toBe(false);
    });
});
