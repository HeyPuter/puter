/*
 * Copyright (C) 2026-present Puter Technologies Inc.
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

import TeePromise from './TeePromise.js';

/**
 * This file contains common functions that are used to re-authenticate an
 * OIDC-authenticated user when performing actions on protected endpoints.
 *
 * No design patterns, no abstractions; only simple functions.
 * (this is not merely a description; it is a guideline for future changes)
 */

const POPUP_FEATURES = 'width=500,height=600';

// Provider ids the GUI renders with dedicated branded buttons. Any other id
// returned by `/auth/oidc/providers` (i.e. a self-hosted admin's custom OIDC
// provider) gets a generic button built from these helpers instead.
export const KNOWN_OIDC_PROVIDERS = ['google', 'apple', 'microsoft'];

// Brand icons for the providers in KNOWN_OIDC_PROVIDERS.
export const OIDC_PROVIDER_ICONS = {
    google: '<img style="width: 20px; height: 20px;" src="data:image/webp;base64,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" />',
    microsoft: '<svg style="width:20px; height:20px;" viewBox="0 0 23 23" fill="none"><rect x="1" y="1" width="10" height="10" fill="#f25022"/><rect x="12" y="1" width="10" height="10" fill="#7fba00"/><rect x="1" y="12" width="10" height="10" fill="#00a4ef"/><rect x="12" y="12" width="10" height="10" fill="#ffb900"/></svg>',
    apple: '<svg style="width:20px; height:20px;" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>',
};

// Generic key icon for OIDC providers without dedicated branding.
export const OIDC_GENERIC_PROVIDER_ICON = '<svg style="width:20px;height:20px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.5 12.5 19 4"/><path d="M16 7l3 3"/><path d="M13 10l3 3"/></svg>';

// Turns a config provider id ("custom-oidc", "acme_sso") into a display
// label ("Custom Oidc", "Acme Sso") for the generic button.
export const humanizeOidcProviderId = (id) => String(id)
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

export const openRevalidatePopup = async (revalidateUrl) => {
    const donePromise = new TeePromise();

    const url = revalidateUrl;
    if ( ! url ) {
        throw new Error('No revalidate URL');
    }
    let doneCalled = false;
    const popup = window.open(url, 'puter-revalidate', POPUP_FEATURES);
    // A blocked popup never closes, so waiting for it would never end.
    if ( ! popup ) {
        throw new Error('Popup blocked');
    }
    const onMessage = ev => {
        if ( (ev.origin !== window.gui_origin) && (ev.origin !== window.location.origin) ) return;
        if ( !ev.data || ev.data.type !== 'puter-revalidate-done' ) return;
        if ( doneCalled ) return;
        doneCalled = true;
        window.removeEventListener('message', onMessage);
        donePromise.resolve();
    };
    window.addEventListener('message', onMessage);
    const checkClosed = setInterval(() => {
        if ( popup && popup.closed ) {
            clearInterval(checkClosed);
            window.removeEventListener('message', onMessage);
            if ( ! doneCalled ) {
                doneCalled = true;
                donePromise.reject(new Error('Popup closed'));
            }
        }
    }, 300);
    await donePromise;
};
