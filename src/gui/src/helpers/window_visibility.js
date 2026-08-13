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

/**
 * The two ways a window can be off screen, told apart. Both are restored by
 * `showWindow()`, and neither is reachable with `focusWindow()` — which would
 * hand the keyboard to a window nobody can see and leave it invisible.
 */

const attr = (el_window, name) => (el_window?.getAttribute
    ? el_window.getAttribute(name)
    : null);

/** Minimized: hidden with geometry to restore (data-orig-*, or in place). */
const is_minimized = (el_window) => {
    const minimized = attr(el_window, 'data-is_minimized');
    return minimized === '1' || minimized === 'true';
};

/**
 * Hidden outright rather than minimized: the window was created hidden by a
 * background launch (see starts_hidden) or hidden later by
 * `puter.ui.hideWindow()`. It kept its geometry, so un-hiding is the whole job.
 *
 * @param {Element} [el_window] a `.window` element
 * @returns {boolean}
 */
export const is_window_hidden = (el_window) => {
    return attr(el_window, 'data-is_visible') === '0' && ! is_minimized(el_window);
};

/**
 * Whether the user can see this window right now — the question anything that
 * reopens an app already running has to ask: a window on screen only needs
 * focus, while one the user cannot see has to be shown first.
 *
 * @param {Element} [el_window] a `.window` element
 * @returns {boolean}
 */
export const is_window_on_screen = (el_window) => {
    return ! is_minimized(el_window) && ! is_window_hidden(el_window);
};

/**
 * Whether this window exists only to serve the app that launched it: started
 * hidden by a background launch and never shown since. UIWindow stamps the
 * marker at creation and drops it the first time the window becomes visible,
 * because from then on the window is the user's — theirs to keep when the app
 * that launched it closes, and theirs to come back to when they reopen the app.
 *
 * @param {Element} [el_window] a `.window` element
 * @returns {boolean}
 */
export const is_unseen_background_window = (el_window) => {
    return attr(el_window, 'data-launched_hidden') === '1';
};
