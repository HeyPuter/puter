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

// Pure pieces of the magic-link sign-in popup, kept out of the window so
// they can be unit tested.

export const POLL_INTERVAL_MS = 2000;

/** Origin of a URL, or null when it is not an http(s) URL. */
export const originOf = (value) => {
    if ( typeof value !== 'string' || !value ) return null;
    try {
        const url = new URL(value);
        if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) return null;
        return url.origin;
    } catch {
        return null;
    }
};

/** Whether `returnUrl` lives on `origin`, so the link can safely land there. */
export const returnUrlAllowed = (returnUrl, origin) => {
    const target = originOf(returnUrl);
    return target !== null && target === originOf(origin);
};

/** The host shown in the popup's "uses Puter" line. */
export const appHostOf = (origin) => {
    try {
        return new URL(origin).host;
    } catch {
        return origin ?? '';
    }
};

/** Loose client-side email check; the backend validates for real. */
export const looksLikeEmail = (value) =>
    typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/** A secret only the popup holds; it proves the popup is the one that asked. */
export const generatePopupSecret = (randomBytes = defaultRandomBytes) => {
    const bytes = randomBytes(32);
    let out = '';
    for ( const b of bytes ) out += b.toString(16).padStart(2, '0');
    return out;
};

const defaultRandomBytes = (n) => {
    const bytes = new Uint8Array(n);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
};

/**
 * The popup's request body for `/auth/magic-link/request`, or null when the
 * inputs can't make a valid one.
 */
export const buildRequestBody = ({ email, session, returnUrl, openerOrigin, popupSecret }) => {
    const origin = originOf(openerOrigin);
    if ( !looksLikeEmail(email) || !session || !origin || !popupSecret ) return null;
    if ( !returnUrlAllowed(returnUrl, origin) ) return null;
    return {
        email: email.trim(),
        session,
        return_url: returnUrl,
        opener_origin: origin,
        popup_secret: popupSecret,
    };
};
