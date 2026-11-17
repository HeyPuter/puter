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

import launch_app from './launchApp.js';
import path from '../lib/path.js';
import { default_app_index, default_app_key, set_default_app } from './defaultApp.js';

/**
 * The items of a file's "Open With" submenu. Choosing an app opens the file in
 * it once; the "Always Open … Files With" submenu is where the user changes
 * which app a double-click uses.
 *
 * @param {HTMLElement} el_item - The file's element; its data-path, data-name and data-uid are read when an app is chosen
 * @param {Array<Object>|undefined} suggested_apps - The apps that can open the file, in the server's order
 * @param {Object} [options]
 * @param {boolean} [options.inNewTab] - Open the chosen app in a new browser tab instead of an in-page window
 * @returns {Array<Object|string>} Context menu items
 */
export default function build_open_with_items (el_item, suggested_apps, { inNewTab = false } = {}) {
    const apps = (suggested_apps ?? []).filter(Boolean);
    if ( apps.length === 0 ) {
        return [{
            html: i18n('no_suitable_apps_found'),
            disabled: true,
        }];
    }

    const file_path = $(el_item).attr('data-path');
    const default_index = default_app_index(file_path, apps);
    const default_first = [apps[default_index], ...apps.filter((_, index) => index !== default_index)];

    const items = default_first.map(app => ({
        html: html_encode(app.title),
        icon: `<img src="${html_encode(app.icon ?? window.icons['app.svg'])}" style="width:16px; height: 16px; margin-bottom: -4px;">`,
        onClick: function () {
            // Opened while the click still counts as a user gesture, or the
            // popup blocker refuses it; refused, the app opens in-page.
            // Without 'noopener': the app asks this tab for its token (see launch_app).
            const newTab = inNewTab ? window.open('', '_blank') : null;
            launch_app({
                name: app.name,
                file_path: $(el_item).attr('data-path'),
                window_title: $(el_item).attr('data-name'),
                file_uid: $(el_item).attr('data-uid'),
                ...(newTab ? { newTab } : {}),
            });
        },
    }));

    if ( apps.length > 1 && default_app_key(file_path) ) {
        items.push('-');
        items.push({
            html: i18n('always_open_ext_files_with', { ext: path.extname(file_path).toLowerCase() }),
            items: apps.map((app, index) => ({
                html: html_encode(app.title),
                checked: index === default_index,
                onClick: () => set_default_app(file_path, app),
            })),
        });
    }

    return items;
}
