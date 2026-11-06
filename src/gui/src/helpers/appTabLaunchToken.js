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
 * Launch tokens for apps opened in their own browser tab. The token stays out
 * of the tab's URL (and so out of its history); the app's SDK asks this tab
 * for it once it loads (see requestLaunchTokenFromOpener in puter.js).
 */

// Long enough for a slow app to load; after that the app signs in on its own.
const OFFER_TTL_MS = 2 * 60 * 1000;

/** @type {Map<string, { tab: Window, origin: string, token: string, timer: ReturnType<typeof setTimeout> }>} */
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
    if ( data?.msg !== 'puter.requestLaunchToken' || typeof data.appInstanceID !== 'string' ) return;
    const offer = offers.get(data.appInstanceID);
    // Only the tab this launch opened, still showing the app it was opened
    // for, gets the token — and only once.
    if ( !offer || event.source !== offer.tab || event.origin !== offer.origin ) return;
    withdraw(data.appInstanceID);
    offer.tab.postMessage({
        msg: 'puter.launchToken',
        appInstanceID: data.appInstanceID,
        token: offer.token,
    }, offer.origin);
};

/**
 * Holds `token` for the app instance running in `tab` until the app asks for
 * it from `origin`, the origin of the URL the tab was sent to.
 *
 * @param {{ appInstanceID: string, tab: Window, origin: string, token: string }} offer
 */
export const offerAppTabLaunchToken = ({ appInstanceID, tab, origin, token }) => {
    if ( ! listening ) {
        window.addEventListener('message', onMessage);
        listening = true;
    }
    withdraw(appInstanceID);
    offers.set(appInstanceID, {
        tab,
        origin,
        token,
        timer: setTimeout(() => withdraw(appInstanceID), OFFER_TTL_MS),
    });
};
