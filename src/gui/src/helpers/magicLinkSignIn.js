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

// Pure pieces of the sign-in link window, kept out of the window so they
// can be unit tested.

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

/**
 * Whether a sign-in popup carries its opener's return URL, so a sign-in link
 * can land the user back on the opener's site.
 */
export const magicLinkOffered = ({ embeddedInPopup, openerOrigin, params }) =>
    !!embeddedInPopup &&
    originOf(openerOrigin) !== null &&
    returnUrlAllowed(params?.get('return_url'), openerOrigin);

/**
 * Which auth window to open after one settles, or null when the user is
 * done. A window asks for another by resolving `{ next: 'login' | 'signup' | 'magic', email? }`.
 */
export const nextAuthWindow = (result) => {
    const next = result?.next;
    return next === 'login' || next === 'signup' || next === 'magic' ? next : null;
};

/** Loose client-side email check; the backend validates for real. */
export const looksLikeEmail = (value) =>
    typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * The request body for `/auth/magic-link/request`, or null when the inputs
 * can't make a valid one. With an opener origin the link signs the user in
 * to that site and lands on `returnUrl`; without one it signs them in to
 * Puter itself and the backend lands them on the desktop.
 */
export const buildRequestBody = ({ email, returnUrl, openerOrigin }) => {
    if ( !looksLikeEmail(email) ) return null;
    const body = { email: email.trim() };
    if ( openerOrigin === undefined || openerOrigin === null || openerOrigin === '' ) {
        return body;
    }
    const origin = originOf(openerOrigin);
    if ( !origin || !returnUrlAllowed(returnUrl, origin) ) return null;
    return {
        ...body,
        return_url: returnUrl,
        opener_origin: origin,
    };
};
