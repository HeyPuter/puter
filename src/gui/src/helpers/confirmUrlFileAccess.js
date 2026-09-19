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
import { isUuid } from './sharePaths.js';

/**
 * The launch options for a `?file=` URL value: a uid (what `getShareLink()`
 * puts in a link) or a path, either way behind the consent gate below.
 *
 * @param {string | null | undefined} value
 * @returns {{ file_uid?: string, file_path?: string, confirm_file_access?: true }}
 */
export const urlFileLaunchOptions = (value) => {
    if ( ! value ) return {};
    return isUuid(value)
        ? { file_uid: value, confirm_file_access: true }
        : { file_path: value, confirm_file_access: true };
};

/**
 * Consent gate for a launch whose file was named by the URL rather than by the
 * user. Both the app and the file come from whoever wrote the link, so signing
 * one over silently would let a single navigation hand a stranger's app a
 * standing grant on a file the user never picked.
 *
 * Directories are refused outright: an `fs:` grant covers every descendant, so
 * a folder here is not "open this file with this app" — it is access to the
 * whole tree beneath it.
 *
 * @param {object} request
 * @param {string} [request.path] - Absolute path, already home-expanded.
 * @param {string} [request.uid] - The file's uid; used instead of `path`.
 * @param {string} request.appUid - The app the grant would be written against.
 * @param {string} [request.appName] - Registered name, for display only.
 * @param {object} [deps] Injectable seams for tests.
 * @param {(target: { path?: string, uid?: string }) => Promise<{ uid?: string, path?: string, is_dir?: boolean }>} [deps.stat]
 * @param {(options: object) => Promise<boolean>} [deps.permissionDialog]
 * @returns {Promise<{ uid: string, path?: string } | null>} The file as
 * stat'd, only if the user allowed it; `null` otherwise.
 */
export const confirmUrlFileAccess = async (
    { path, uid, appUid, appName },
    {
        stat = (target) => puter.fs.stat({ ...target, consistency: 'eventual' }),
        permissionDialog = UIPermissionDialog,
    } = {},
) => {
    if ( (! path && ! uid) || ! appUid ) return null;

    let fsentry;
    try {
        fsentry = await stat(uid ? { uid } : { path });
    } catch (e) {
        // A file that can't be resolved can't be signed either, so there is
        // nothing to consent to.
        return null;
    }

    if ( ! fsentry?.uid ) return null;
    if ( fsentry.is_dir ) {
        console.warn(`launch_app: refusing to open the folder ${fsentry.path ?? uid}`);
        return null;
    }

    const granted = await permissionDialog({
        app_uid: appUid,
        app_name: appName,
        // By uid: it is what the grant is stored against, and a path a
        // recipient sees is a masked stand-in for the owner's.
        permission: `fs:${fsentry.uid}:write`,
        // The entry was just stat'd; nothing here should bring one into being.
        create: false,
    });
    return granted === true ? { uid: fsentry.uid, path: fsentry.path } : null;
};

export default confirmUrlFileAccess;
