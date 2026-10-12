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
 * The window an app's IPC call may act on: its own window when no
 * `window_id` is given, otherwise only a window it created
 * (`data-parent_uuid`). Other apps' windows, including apps it launched,
 * resolve to null.
 *
 * @param {string} app_instance_id validated instance id of the calling app
 * @param {string | undefined} window_id
 * @returns {HTMLElement | null}
 */
export const ipc_target_window = (app_instance_id, window_id) => {
    if ( !window_id || window_id === app_instance_id ) {
        return document.querySelector(`.window[data-element_uuid="${app_instance_id}"]`);
    }
    // window_id is untrusted, so it is compared rather than put in a selector.
    const owned = document.querySelectorAll(`.window[data-parent_uuid="${app_instance_id}"]`);
    return [...owned].find(el => el.getAttribute('data-element_uuid') === window_id) ?? null;
};
