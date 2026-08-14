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
 * hidden AND launched by another app (data-parent_instance_id), and never
 * shown since. UIWindow stamps the hidden marker at creation and drops it the
 * first time the window becomes visible, because from then on the window is
 * the user's — theirs to keep when the app that launched it closes, and theirs
 * to come back to when they reopen the app.
 *
 * The launcher is half of the definition, not decoration. An app that is
 * ALWAYS windowless (`background` on the app itself) also starts hidden, but
 * when the USER opens it there is nobody it is serving: it is the instance
 * their tile has to find, or every click would start another one they cannot
 * see.
 *
 * @param {Element} [el_window] a `.window` element
 * @returns {boolean}
 */
export const is_unseen_background_window = (el_window) => {
    return attr(el_window, 'data-launched_hidden') === '1'
        && !! attr(el_window, 'data-parent_instance_id');
};

/**
 * Of the windows an app has open, the ones that are the USER's. An instance
 * another app launched in the background and never showed exists to serve that
 * app alone, so everything the user drives — reopening the app, its running
 * dot, its taskbar item, the dashboard's Back/Forward — has to look straight
 * past it and act on the user's own instances instead, launching a fresh one
 * when there are none. (Paths that act on the APP rather than on a window it
 * happens to have open — uninstall, and the launcher's close taking its
 * background children down with it — deliberately keep the unfiltered list.)
 *
 * @param {ArrayLike<Element>} [el_windows] `.window` elements: a jQuery set, a
 *   NodeList, or an array
 * @returns {Element[]}
 */
export const user_facing_windows = (el_windows) => {
    return Array.prototype.filter.call(el_windows ?? [],
        el_window => ! is_unseen_background_window(el_window));
};
