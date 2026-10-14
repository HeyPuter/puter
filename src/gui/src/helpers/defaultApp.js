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
import { get_app_by_uid } from './getAppByUid.js';

/** The `user_preferences` key holding the "always open with" app for a file's extension. */
const default_app_key = (file_path) => `default_apps${path.extname(file_path).toLowerCase()}`;

/**
 * Whether a stored "always open with" value names `app`. New values are the
 * app's uid; older ones are its name.
 */
export const is_default_app = (pref, app) => !!pref && !!app && (pref === app.uuid || pref === app.name);

/**
 * The app the user chose to always open this file's type with, or null. Pass
 * it to `launch_app` as `app_obj`.
 *
 * The choice only counts while it names one of the file's suggested apps
 * (built-ins and apps approved for opening files): an app name is free for
 * anyone to claim once the app is renamed or deleted, and older choices are
 * stored by name. Suggestions are cached server-side and can carry a name
 * that has since moved to another app, so the match is re-read by uid, which
 * also brings the launch gates `puter.apps.get` applies.
 */
export const resolve_default_app = async ({ uid, path: file_path }) => {
    const pref = window.user_preferences?.[default_app_key(file_path)];
    if ( ! pref ) return null;
    let match;
    try {
        const suggested_apps = await window.suggest_apps_for_fsentry({ uid, path: file_path });
        match = suggested_apps?.find(app => is_default_app(pref, app));
    } catch (e) {
        console.warn('Could not resolve default app', e);
        return null;
    }
    if ( ! match?.uuid ) return null;
    return await get_app_by_uid(match.uuid, { icon_size: 64 });
};
