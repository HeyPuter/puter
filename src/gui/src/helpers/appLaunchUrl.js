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
 * The URL an app is launched at, in a desktop window or its own tab. Kept free
 * of desktop globals so the app browser embed builds the same URL.
 */

// This can be any trusted URL that won't be used for other apps
export const BUILTIN_PREFIX = 'https://builtins.namespaces.puter.com/';

// Newer IPC dialogs this GUI can answer, comma-separated. The SDK consults
// this before posting a message an older GUI has no handler for: such a
// message is never replied to, and a reply timeout can't stand in for the
// check because legitimate replies only arrive when the user closes the dialog.
const GUI_FEATURES = 'feedback-dialog,enable-push,custom-domains,push-status,disable-push';

/**
 * Where an app was launched from, sent to the app as `utm_campaign` so its
 * analytics can tell the GUI's launch surfaces apart.
 *
 * @typedef {'desktop' | 'dashboard' | 'app_browser_embed'} LaunchSurface
 */

/**
 * The app's index URL with the params that name the launch.
 *
 * @param {object} options
 * @param {{ uid?: string, uuid?: string, name: string, index_url?: string }} options.app
 * @param {string} [options.name] - the name the app was launched by
 * @param {string} options.appInstanceID
 * @param {string} options.guiOrigin
 * @param {string} options.appDomain
 * @returns {URL}
 */
export const appLaunchUrl = ({ app, name = app.name, appInstanceID, guiOrigin, appDomain }) => {
    let url;
    if ( ! app.index_url ) {
        url = new URL(`https://${name}.${appDomain}/index.html`);
    } else if ( app.index_url.startsWith(BUILTIN_PREFIX) ) {
        url = new URL(`${guiOrigin}/builtin/${app.index_url.slice(BUILTIN_PREFIX.length)}`);
    } else {
        url = new URL(app.index_url);
    }
    url.searchParams.append('puter.app_instance_id', appInstanceID);
    url.searchParams.append('puter.app.id', app.uuid ?? app.uid);
    url.searchParams.append('puter.app.name', app.name);
    return url;
};

/**
 * Appends the params that tell the app where Puter is and how it was
 * launched.
 *
 * @param {URL} url
 * @param {object} options
 * @param {string} options.appDomain
 * @param {string} options.pageUrl - the GUI page launching the app
 * @param {string} [options.apiOrigin]
 * @param {Record<string, string>} [options.params] - extra params from the caller
 * @param {string} options.locale
 * @param {unknown} [options.args]
 * @param {LaunchSurface} options.surface
 */
export const appendLaunchContext = (url, { appDomain, pageUrl, apiOrigin, params, locale, args, surface }) => {
    url.searchParams.append('puter.domain', appDomain);

    const page = new URL(pageUrl);
    url.searchParams.append('puter.origin', page.origin);
    url.searchParams.append('puter.hostname', page.hostname);
    url.searchParams.append('puter.port', page.port);
    url.searchParams.append('puter.protocol', page.protocol.slice(0, -1));

    if ( apiOrigin ) {
        url.searchParams.append('puter.api_origin', apiOrigin);
    }
    for ( const property in params ?? {} ) {
        url.searchParams.append(property, params[property]);
    }
    url.searchParams.append('puter.locale', locale);
    url.searchParams.append('puter.gui_features', GUI_FEATURES);
    url.searchParams.append('puter.args', JSON.stringify(args ?? {}));
    url.searchParams.append('utm_source', 'puter.com');
    url.searchParams.append('utm_medium', 'referral');
    url.searchParams.append('utm_campaign', surface);
};
