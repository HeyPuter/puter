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

// Pure pieces of email sign-in, kept out of the windows so they can be
// unit tested.

/** Same-origin channel a link's tab uses to tell the window that asked. */
export const MAGIC_LINK_CHANNEL = 'puter-magic-link';

/** How long a link's tab waits for the window that asked to answer. */
export const MAGIC_LINK_ACK_TIMEOUT_MS = 1500;

// Consumer domains whose provider verifies the address itself, so its
// sign-in proves the inbox as well as a link does.
const OIDC_EMAIL_DOMAINS = {
    google: ['gmail.com', 'googlemail.com'],
    microsoft: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
};

/** Loose client-side email check; the backend validates for real. */
export const looksLikeEmail = (value) =>
    typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * The enabled provider an address should sign in with instead of a link, or
 * null when a link is the way in.
 *
 * @param {string} email
 * @param {string[]} enabledProviders ids from `/auth/oidc/providers`
 * @returns {string | null}
 */
export const oidcProviderForEmail = (email, enabledProviders) => {
    if ( ! looksLikeEmail(email) ) return null;
    const domain = email.trim().toLowerCase().split('@').pop();
    for ( const [provider, domains] of Object.entries(OIDC_EMAIL_DOMAINS) ) {
        if ( domains.includes(domain) && enabledProviders?.includes(provider) ) {
            return provider;
        }
    }
    return null;
};

/** The host shown for the site a sign-in is for. */
export const appHostOf = (origin) => {
    try {
        return new URL(origin).host;
    } catch {
        return '';
    }
};

/**
 * The display text for a failed link, from the error body the consume route
 * answered with.
 *
 * @param {number} status
 * @param {{ code?: string, message?: string } | null} body
 * @returns {{ key: string } | { text: string }}
 */
export const consumeErrorMessage = (status, body) => {
    if ( status === 429 ) return { key: 'magic_link_too_many_requests' };
    switch ( body?.code ) {
    case 'link_expired': return { key: 'magic_link_expired_message' };
    case 'account_suspended': return { key: 'account_suspended_message' };
    // The server's text names what to do, or carries the Request Code.
    case 'email_unconfirmed':
    case 'signup_blocked':
        if ( typeof body.message === 'string' && body.message ) {
            return { text: body.message };
        }
    }
    return { key: 'auth_error_generic' };
};

/**
 * Tell the window that asked for a link that its tab signed in. Resolves
 * whether that window answered, i.e. is still open in this browser.
 *
 * @param {{ requestId: string, userUuid: string, openChannel: () => BroadcastChannel, timeoutMs?: number }} opts
 * @returns {Promise<boolean>}
 */
export const announceMagicLinkSignIn = ({ requestId, userUuid, openChannel, timeoutMs = MAGIC_LINK_ACK_TIMEOUT_MS }) =>
    new Promise((resolve) => {
        let channel;
        try {
            channel = openChannel();
        } catch {
            resolve(false);
            return;
        }
        let done = false;
        const finish = (acked) => {
            if ( done ) return;
            done = true;
            clearTimeout(timer);
            channel.close();
            resolve(acked);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        channel.onmessage = (ev) => {
            if ( ev.data?.type === 'ack' && ev.data.request_id === requestId ) finish(true);
        };
        channel.postMessage({ type: 'signed-in', request_id: requestId, user_uuid: userUuid });
    });

/**
 * Wait for the tab of the link `requestId` mailed to sign in. Calls
 * `onSignedIn` with the account's uuid; returns a function that stops
 * waiting.
 *
 * @param {{ requestId: string, openChannel: () => BroadcastChannel, onSignedIn: (userUuid: string) => void }} opts
 * @returns {() => void}
 */
export const watchMagicLinkSignIn = ({ requestId, openChannel, onSignedIn }) => {
    let channel;
    try {
        channel = openChannel();
    } catch {
        return () => {};
    }
    channel.onmessage = (ev) => {
        const msg = ev.data;
        if ( msg?.type !== 'signed-in' || msg.request_id !== requestId ) return;
        channel.postMessage({ type: 'ack', request_id: requestId });
        onSignedIn(msg.user_uuid);
    };
    return () => channel.close();
};
