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
