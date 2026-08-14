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
import {
    is_window_hidden,
    is_window_on_screen,
    is_unseen_background_window,
    user_facing_windows,
} from './window_visibility.js';

// A `.window` element carrying the given data- attributes, in the shapes
// UIWindow actually writes them (is_visible as 0/1, is_minimized as either
// 0/1 from the markup or the string 'true'/'false' from later .attr() calls).
const win = (attrs = {}) => {
    const el = document.createElement('div');
    el.className = 'window';
    el.setAttribute('data-is_visible', attrs.visible ?? '1');
    if ( attrs.minimized !== undefined ) el.setAttribute('data-is_minimized', attrs.minimized);
    if ( attrs.launched_hidden ) el.setAttribute('data-launched_hidden', '1');
    if ( attrs.parent ) el.setAttribute('data-parent_instance_id', attrs.parent);
    return el;
};

// The window a background launch makes: hidden, and serving the app whose
// instance id it carries.
const helper_win = (attrs = {}) => win({ visible: '0', launched_hidden: true, parent: 'parent-uuid', ...attrs });

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
        expect(is_unseen_background_window(helper_win())).toBe(true);
        // makeWindowVisible drops the marker the first time the window is
        // shown, whether the app showed itself or the user did.
        expect(is_unseen_background_window(win({ visible: '1', parent: 'parent-uuid' }))).toBe(false);
    });

    it('is false for an ordinary window, minimized or not', () => {
        expect(is_unseen_background_window(win())).toBe(false);
        expect(is_unseen_background_window(win({ minimized: 'true' }))).toBe(false);
        // A window the app hid itself with puter.ui.hideWindow() is the user's
        // too — it just isn't on screen.
        expect(is_unseen_background_window(win({ visible: '0' }))).toBe(false);
    });

    it('is false for a windowless app the USER opened', () => {
        // `background` on the app itself starts every instance hidden, with no
        // launcher to serve. This one is the user's: their tile has to find it
        // rather than start another invisible instance on every click.
        expect(is_unseen_background_window(win({ visible: '0', launched_hidden: true }))).toBe(false);
    });

    it('is false for a missing element', () => {
        expect(is_unseen_background_window(null)).toBe(false);
    });
});

describe('user_facing_windows', () => {
    it('drops the instances another app launched in the background', () => {
        const mine = win({ minimized: 'true' });
        expect(user_facing_windows([mine, helper_win()])).toEqual([mine]);
    });

    it('is empty when every instance is a background helper', () => {
        // What makes the dashboard tile launch a FRESH instance instead of
        // handing the user the window its launcher is talking to.
        expect(user_facing_windows([helper_win()])).toEqual([]);
    });

    it('keeps a background instance once it has been shown', () => {
        // makeWindowVisible drops the marker: from then on the window is the
        // user's, and the tile/taskbar/history paths act on it again.
        const shown = win({ visible: '1', parent: 'parent-uuid' });
        expect(user_facing_windows([shown])).toEqual([shown]);
    });

    it('keeps windows the app merely hid, and minimized ones', () => {
        const hidden_by_app = win({ visible: '0' });
        const minimized = win({ minimized: '1' });
        expect(user_facing_windows([hidden_by_app, minimized]))
            .toEqual([hidden_by_app, minimized]);
    });

    it('preserves order, so callers can keep taking the last one', () => {
        const first = win();
        const second = win();
        expect(user_facing_windows([first, helper_win(), second]))
            .toEqual([first, second]);
    });

    it('takes any array-like: a NodeList as well as an array', () => {
        // Call sites pass jQuery sets; jsdom's NodeList stands in for one.
        const host = document.createElement('div');
        host.append(win(), helper_win());
        expect(user_facing_windows(host.querySelectorAll('.window'))).toHaveLength(1);
    });

    it('is empty for nothing at all', () => {
        expect(user_facing_windows()).toEqual([]);
        expect(user_facing_windows([])).toEqual([]);
    });
});
