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

import { BUILTIN_PREFIX, appLaunchUrl, appendLaunchContext } from './appLaunchUrl.js';
import { fetchUserAppTokenForLaunch, reportAppOpen } from './appLaunchApi.js';
import { uuidv4 } from './uuidv4.js';

/**
 * Launch data for apps opened in their own browser tab: the app's token and
 * the item it was opened with (whose signed URLs don't expire). Both stay out
 * of the tab's URL, and so out of its history; the app's SDK asks this tab for
 * them once it loads (see requestLaunchFromOpener in puter.js).
 */

// Long enough for a slow app to load; after that the app signs in on its own.
const OFFER_TTL_MS = 2 * 60 * 1000;

/**
 * @typedef {object} AppTabLaunch
 * @property {string} appInstanceID
 * @property {Window} tab - the tab the app was opened in
 * @property {string} origin - origin of the URL the tab was sent to
 * @property {string} token
 * @property {Record<string, string> | null} item - the opened item's `puter.item.*` params
 */

/** @type {Map<string, AppTabLaunch & { timer: ReturnType<typeof setTimeout> }>} */
const offers = new Map();
let listening = false;

const withdraw = (appInstanceID) => {
    const offer = offers.get(appInstanceID);
    if ( ! offer ) return;
    clearTimeout(offer.timer);
    offers.delete(appInstanceID);
};

const onMessage = (event) => {
    const data = event.data;
    if ( data?.msg !== 'puter.requestLaunch' || typeof data.appInstanceID !== 'string' ) return;
    const offer = offers.get(data.appInstanceID);
    // Only the tab this launch opened, still showing the app it was opened
    // for, gets the launch data — and only once.
    if ( !offer || event.source !== offer.tab || event.origin !== offer.origin ) return;
    withdraw(data.appInstanceID);
    offer.tab.postMessage({
        msg: 'puter.launch',
        appInstanceID: data.appInstanceID,
        token: offer.token,
        item: offer.item,
    }, offer.origin);
};

/**
 * Holds an app tab's launch data until the app asks for it from `origin`.
 *
 * @param {AppTabLaunch} offer
 */
export const offerAppTabLaunch = ({ appInstanceID, tab, origin, token, item }) => {
    if ( ! listening ) {
        window.addEventListener('message', onMessage);
        listening = true;
    }
    withdraw(appInstanceID);
    offers.set(appInstanceID, {
        appInstanceID,
        tab,
        origin,
        token,
        item,
        timer: setTimeout(() => withdraw(appInstanceID), OFFER_TTL_MS),
    });
};

/** Apps that only open inside the desktop, at the GUI's `/app/<name>`. */
const needsDesktop = app => app.index_url?.startsWith(BUILTIN_PREFIX)
    || app.godmode === true || app.godmode === 1
    || app.privateAccess?.hasAccess === false;

/** The app's URL for a tab launch, with the params that name the launch. */
const tabLaunchUrl = ({ app, name, guiOrigin, apiOrigin, locale }) => {
    const appInstanceID = uuidv4();
    const appDomain = new URL(guiOrigin).hostname;
    const url = appLaunchUrl({ app, name, appInstanceID, guiOrigin, appDomain });
    appendLaunchContext(url, {
        appDomain,
        pageUrl: guiOrigin,
        apiOrigin,
        locale,
        surface: 'app_browser_embed',
    });
    return { url, appInstanceID };
};

/**
 * Opens an app in `tab` at its own URL, the way launch_app's `newTab` does,
 * for pages without the desktop (the app browser embed). Resolves false,
 * leaving the tab as it is, for a launch that needs the desktop: a built-in
 * or godmode app, a private app the user can't open, or a token that
 * couldn't be fetched. Also false when the user closed the tab meanwhile.
 *
 * @param {object} options
 * @param {string} options.name - the app's name
 * @param {Window} options.tab - opened by the caller, inside the click and
 *   without `noopener`, so the app can ask it for its token
 * @param {string} options.guiOrigin
 * @param {string} options.apiOrigin
 * @param {string} options.authToken - the GUI session token
 * @param {string} options.locale
 * @returns {Promise<boolean>} whether the tab was sent to the app
 */
export const launchAppInTab = async ({ name, tab, guiOrigin, apiOrigin, authToken, locale }) => {
    const app = await puter.apps.get(name);
    if ( needsDesktop(app) ) return false;

    const appUid = app.uid ?? app.uuid;
    const { token } = await fetchUserAppTokenForLaunch({ appUid, apiOrigin, authToken });
    if ( !token || tab.closed ) return false;

    const { url, appInstanceID } = tabLaunchUrl({ app, name, guiOrigin, apiOrigin, locale });
    offerAppTabLaunch({ appInstanceID, tab, origin: url.origin, token, item: null });
    tab.location.href = url.href;
    reportAppOpen({ appUid, apiOrigin, authToken });
    return true;
};

/**
 * Where a visitor without a session opens an app: the same URL a signed-in
 * launch uses, with no token on offer, so the app signs in on its own. Apps
 * that need the desktop get null, for the caller's `/app/<name>` link.
 *
 * @param {object} options
 * @param {{ name: string, uuid?: string, uid?: string, index_url?: string | null, godmode?: boolean }} options.app
 *   - an entry of the recommended list
 * @param {string} options.guiOrigin
 * @param {string} options.apiOrigin
 * @param {string} options.locale
 * @returns {string | null}
 */
export const guestAppLaunchUrl = ({ app, guiOrigin, apiOrigin, locale }) => {
    if ( needsDesktop(app) ) return null;
    return tabLaunchUrl({ app, name: app.name, guiOrigin, apiOrigin, locale }).url.href;
};
