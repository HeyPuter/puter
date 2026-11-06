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
import { launchAppInTab } from './helpers/appTabLaunch.js';

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
// Apps whose launch is still fetching; a second click would open a second tab.
const launching = new Set();

/**
 * Opens a tile's app in a new tab at its own URL, as the dashboard does.
 * Website shortcuts, and apps that need the desktop, open their tile link.
 */
function launchTile ({ appName, targetLink }) {
    const href = appTileLink({ appName, targetLink }, window.location.origin);
    if ( targetLink || !appName ) {
        if ( href ) window.open(href, '_blank', 'noopener,noreferrer');
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
    const stored = localStorage.getItem('auth_token_v2');
    if ( stored ) return stored;
    const response = await fetch('/get-gui-token', { credentials: 'include' });
    if ( ! response.ok ) return null;
    return (await response.json())?.token || null;
}

async function mount () {
    window.auth_token = await readSession();
    if ( ! window.auth_token ) throw new Error('Missing session');

    await Promise.all([new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = config.sdkUrl;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    }), localeReady]);
    puter.setAPIOrigin(config.apiOrigin);
    installAppIconFallback();

    const browser = createAppBrowser({
        editable: false,
        onLaunch: launchTile,
    });
    const $root = $(root);
    $root.html(`<section class="dashboard-section dashboard-section-apps active">${browser.html()}</section>`);
    browser.init($root);
}

mount().catch(async () => {
    await localeReady;
    root.innerHTML = `<p class="myapps-empty" role="status">${i18n('app_browser_unavailable')}</p>`;
});
