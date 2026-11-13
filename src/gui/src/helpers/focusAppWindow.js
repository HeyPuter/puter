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

import { is_window_on_screen, user_facing_windows } from './windowVisibility.js';

/**
 * Brings back the user's open window of an app, if there is one: focused when
 * on screen, otherwise shown, since focusing a minimized or hidden window
 * would leave it invisible. Windows another app launched in the background
 * are its helpers, not the user's, so they don't count.
 *
 * @param {string} appName
 * @returns {boolean} whether a window was brought back
 */
export function focusExistingAppWindow (appName) {
    const $existing = $(user_facing_windows($(`.window[data-app="${html_encode(appName)}"]`)));
    if ( ! $existing.length ) return false;
    const $on_screen = $existing.filter((_, el) => is_window_on_screen(el)).last();
    if ( $on_screen.length ) {
        $on_screen.focusWindow();
        return true;
    }
    $existing.last().showWindow();
    return true;
}
