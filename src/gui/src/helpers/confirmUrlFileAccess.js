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

import UIPermissionDialog from '../UI/UIPermissionDialog.js';

/**
 * Consent gate for a launch whose file was named by the URL rather than by the
 * user. Both the app and the path come from whoever wrote the link, so signing
 * one over silently would let a single navigation hand a stranger's app a
 * standing grant on a file the user never picked.
 *
 * Directories are refused outright: an `fs:` grant covers every descendant, so
 * a folder here is not "open this file with this app" — it is access to the
 * whole tree beneath it.
 *
 * @param {object} request
 * @param {string} request.path - Absolute path, already home-expanded.
 * @param {string} request.appUid - The app the grant would be written against.
 * @param {string} [request.appName] - Registered name, for display only.
 * @param {object} [deps] Injectable seams for tests.
 * @param {(path: string) => Promise<{ is_dir?: boolean }>} [deps.stat]
 * @param {(options: object) => Promise<boolean>} [deps.permissionDialog]
 * @returns {Promise<boolean>} `true` only if the user allowed it.
 */
export const confirmUrlFileAccess = async (
    { path, appUid, appName },
    {
        stat = (p) => puter.fs.stat({ path: p, consistency: 'eventual' }),
        permissionDialog = UIPermissionDialog,
    } = {},
) => {
    if ( ! path || ! appUid ) return false;

    let fsentry;
    try {
        fsentry = await stat(path);
    } catch (e) {
        // A path that can't be resolved can't be signed either, so there is
        // nothing to consent to.
        return false;
    }

    if ( fsentry?.is_dir ) {
        console.warn(`launch_app: refusing to open the folder ${path}`);
        return false;
    }

    const granted = await permissionDialog({
        app_uid: appUid,
        app_name: appName,
        permission: `fs:${path}:write`,
        // The entry was just stat'd; nothing here should bring one into being.
        create: false,
    });
    return granted === true;
};

export default confirmUrlFileAccess;
