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
