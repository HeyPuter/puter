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

import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { encode } from 'html-entities';
import { loadLocale } from './i18n/embedI18n.js';
import { createAppBrowser } from './UI/Dashboard/AppBrowser.js';
import { appTileLink } from './UI/Dashboard/appLink.js';
import { installAppIconFallback } from './helpers/appIcon.js';
import { guestAppLaunchUrl, launchAppInTab } from './helpers/appTabLaunch.js';
import { embedHostTheme, forceColorScheme } from './helpers/embedHostTheme.js';
import { embedHostUser } from './helpers/embedHostUser.js';

window.$ = window.jQuery = jQuery;
window.html_encode = value => encode(String(value ?? ''), { mode: 'nonAsciiPrintable' });
window.icons = {
    'app.svg': new URL('./icons/app.svg', import.meta.url).href,
    'app-default.svg': new URL('./icons/app-default.svg', import.meta.url).href,
};

const root = document.querySelector('#app-browser');
const config = JSON.parse(document.querySelector('#app-browser-config').textContent);
window.api_origin = config.apiOrigin;
window.PUTER_API_ORIGIN = config.apiOrigin;
window.PUTER_GUI_ORIGIN = window.location.origin;
window.gui_origin = window.location.origin;
window.puter_gui_enabled = true;
window.puter_socket_enabled = false;
window.locale = 'en';
try {
    window.locale = JSON.parse(localStorage.getItem('user_preferences') || '{}')?.language || 'en';
} catch { /* Corrupt preferences must not prevent loading apps. */ }
const localeReady = loadLocale(window.locale);
// The host names its user and theme in the fragment, which can change without a reload.
window.addEventListener('hashchange', () => window.location.reload());
const hostTheme = embedHostTheme(window.location.hash);
if ( hostTheme ) forceColorScheme(document, hostTheme);
// Apps whose launch is still fetching; a second click would open a second tab.
const launching = new Set();

/**
 * Opens a tile's app in a new tab at its own URL, as the dashboard does.
 * Website shortcuts, and apps that need the desktop, open their tile link.
 * Without a session there is no token to hand the app, so its tab is opened
 * cut off from the embed and the app signs in on its own.
 */
function launchTile ({ appName, targetLink }) {
    const href = appTileLink({ appName, targetLink }, window.location.origin);
    if ( targetLink || !appName ) {
        if ( href ) window.open(href, '_blank', 'noopener,noreferrer');
        return;
    }
    if ( ! window.auth_token ) {
        const app = config.guestApps.find(guestApp => guestApp.name === appName);
        const url = app && guestAppLaunchUrl({
            app,
            guiOrigin: window.location.origin,
            apiOrigin: config.apiOrigin,
            locale: window.locale,
        });
        window.open(url || href, '_blank', 'noopener');
        return;
    }
    if ( launching.has(appName) ) return;
    // Opened inside the click so popup blockers allow it, and without
    // 'noopener' so the app's SDK can ask this page for its token.
    const tab = window.open('', '_blank');
    if ( ! tab ) return;
    launching.add(appName);
    launchAppInTab({
        name: appName,
        tab,
        guiOrigin: window.location.origin,
        apiOrigin: config.apiOrigin,
        authToken: window.auth_token,
        locale: window.locale,
    })
        .catch((err) => {
            console.error(`Failed to launch ${appName}:`, err);
            return false;
        })
        .then((opened) => {
            if ( opened || tab.closed ) return;
            // The desktop's /app/<name> landing handles access and errors.
            tab.opener = null;
            tab.location.href = href;
        })
        .finally(() => launching.delete(appName));
}

/**
 * The GUI session, from local storage or else the session cookie. Safari keys a
 * frame's local storage by the top-level origin, so under a sibling subdomain
 * the GUI's stored token is out of reach while its cookie is still sent.
 */
async function readSession () {
    let stored = null;
    try {
        stored = localStorage.getItem('auth_token_v2');
    } catch { /* Storage the browser refuses holds no session; the cookie may. */ }
    if ( stored ) return stored;
    const response = await fetch('/get-gui-token', { credentials: 'include' });
    // Only a 401 means there is no session; a rate limit or server error
    // must not pass a signed-in user off as signed out.
    if ( response.status === 401 ) return null;
    if ( ! response.ok ) throw new Error(`Session lookup responded ${response.status}`);
    return (await response.json())?.token || null;
}

/**
 * The uuid of the user a GUI token belongs to, or null when the API refuses it.
 */
async function sessionUser (token) {
    const response = await fetch(new URL('/whoami', config.apiOrigin), {
        headers: { Authorization: `Bearer ${token}` },
    });
    if ( response.status === 401 ) return null;
    if ( ! response.ok ) throw new Error(`Session check responded ${response.status}`);
    const uuid = (await response.json())?.uuid;
    return typeof uuid === 'string' ? uuid.toLowerCase() : null;
}

/**
 * The GUI session, only when it belongs to the user the host page names. A
 * host signed out, or signed in as someone else, gets the signed-out view.
 */
async function hostSession () {
    const hostUser = embedHostUser(window.location.hash);
    if ( ! hostUser ) return null;
    const token = await readSession();
    if ( ! token ) return null;
    return await sessionUser(token) === hostUser ? token : null;
}

/**
 * Signed in, the user's own apps through the SDK. Without a session, the
 * recommended apps the page was rendered with, and no SDK.
 */
async function mount () {
    window.auth_token = await hostSession();
    const guestApps = window.auth_token ? undefined : config.guestApps;
    if ( !window.auth_token && !guestApps?.length ) throw new Error('No apps to show without a session');

    if ( ! guestApps ) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = config.sdkUrl;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
        puter.setAPIOrigin(config.apiOrigin);
    }
    await localeReady;
    installAppIconFallback();

    const browser = createAppBrowser({
        editable: false,
        onLaunch: launchTile,
        guestApps,
    });
    const $root = $(root);
    $root.html(`<section class="dashboard-section dashboard-section-apps active">${browser.html()}</section>`);
    browser.init($root);
}

mount().catch(async () => {
    await localeReady;
    root.innerHTML = `<p class="myapps-empty" role="status">${i18n('app_browser_unavailable')}</p>`;
});
