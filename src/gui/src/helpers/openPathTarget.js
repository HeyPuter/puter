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

import path from '../lib/path.js';
import UIAlert from '../UI/UIAlert.js';
import { resolve_default_app } from './defaultApp.js';
import launch_app from './launchApp.js';

/**
 * The dashboard hash that opens `dir_path` in Files. Each segment is encoded
 * because parseDashboardRoute decodes the hash as a whole before splitting it.
 *
 * @param {string} dir_path
 * @returns {string}
 */
export const files_route_hash = (dir_path) =>
    `#files/${dir_path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;

/**
 * Open a path as double-clicking it would: a file in its app, a folder in the
 * dashboard's Files tab. A file no app can open falls back to its folder.
 *
 * TODO: DRY with open_item, which is coupled to an item element and can't
 *       operate on a path alone.
 *
 * @param {string} item_path
 * @param {{ is_dir: boolean, uid?: string, associated_app?: { name: string } }} stat
 * @returns {Promise<void>}
 */
export const open_path_target = async (item_path, stat) => {
    if ( ! stat.is_dir ) {
        if ( stat.associated_app ) {
            launch_app({ name: stat.associated_app.name });
            return;
        }

        const default_app = await resolve_default_app({ uid: stat.uid, path: item_path });
        if ( default_app ) {
            launch_app({
                name: default_app.name,
                app_obj: default_app,
                file_path: item_path,
            });
            return;
        }

        const open_item_meta = await $.ajax({
            url: `${window.api_origin}/open_item`,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ path: item_path }),
            headers: { 'Authorization': `Bearer ${window.auth_token}` },
            statusCode: {
                401: function (xhr) {
                    window.handle401(xhr);
                },
            },
        });
        const suggested_apps = open_item_meta?.suggested_apps
            ?? await window.suggest_apps_for_fsentry({ path: item_path });

        if ( suggested_apps.length !== 0 ) {
            launch_app({
                name: suggested_apps[0].name,
                token: open_item_meta.token,
                file_path: item_path,
                app_obj: suggested_apps[0],
                window_title: path.basename(item_path),
                file_signature: open_item_meta.signature,
                custom_path: window.location.pathname,
            });
            return;
        }

        await UIAlert({
            message: 'Cannot find an app to open this file; opening directory instead.',
        });
        item_path = path.dirname(item_path);
    }

    window.location.hash = files_route_hash(item_path);
};
