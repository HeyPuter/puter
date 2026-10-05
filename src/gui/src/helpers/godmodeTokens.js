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

import { isAttestedOrigin } from './attestedOrigin.js';

/**
 * Godmode apps that run on their own full-access token instead of the
 * desktop's session. The server lets that token lapse 12 hours after the
 * desktop last asked for it, so the desktop asks again for every open window
 * long before then, and whenever an app reports that its token stopped working.
 */

// Renew once less than this much of the token's life is left.
const RENEW_WHEN_LEFT_MS = 6 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
// An app asking again this soon gets the token it was just sent.
const RENEW_COOLDOWN_MS = 30 * 1000;

/**
 * @type {Map<string, {
 *     appUid: string;
 *     token: string;
 *     expiresAt: number;
 *     renewedAt: number;
 *     origin?: string;
 * }>}
 */
const tracked = new Map();
let checkTimer = null;

/**
 * Whether a token expiring at `expiresAt` (unix seconds) is due for renewal.
 *
 * @param {number} expiresAt
 * @param {number} nowMs
 * @returns {boolean}
 */
export const shouldRenew = (expiresAt, nowMs) =>
    !Number.isFinite(expiresAt) || expiresAt * 1000 - nowMs < RENEW_WHEN_LEFT_MS;

/** The token row a JWT belongs to; renewals of a live row keep it. */
const tokenRowOf = (token) => {
    try {
        const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(part))?.token_uid ?? null;
    } catch {
        return null;
    }
};

/**
 * Whether two tokens are the same row, so the app already holds a working one.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export const sameTokenRow = (a, b) => {
    const row = tokenRowOf(a);
    return !!row && row === tokenRowOf(b);
};

/**
 * Ask the server for the token a godmode app launches with. Anything other
 * than a godmode token (an ordinary app token from a server that doesn't treat
 * the app as godmode) is a failure: the app never runs on the desktop session.
 *
 * @param {string} appUid
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string} [deps.apiOrigin]
 * @param {string} [deps.authToken]
 * @returns {Promise<
 *     | { ok: true; token: string; expiresAt: number }
 *     | { ok: false; status?: number; error?: unknown }
 * >}
 */
export const mintGodmodeToken = async (appUid, deps = {}) => {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const apiOrigin = deps.apiOrigin ?? window.api_origin;
    const authToken = deps.authToken ?? window.auth_token;
    try {
        const response = await fetchImpl(`${apiOrigin}/auth/get-user-app-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ app_uid: appUid }),
        });
        if ( ! response.ok ) return { ok: false, status: response.status };
        const body = await response.json().catch(() => null);
        if ( body?.godmode === true && typeof body.token === 'string' && body.token ) {
            return { ok: true, token: body.token, expiresAt: Number(body.expires_at) };
        }
        return { ok: false, status: response.status };
    } catch ( error ) {
        return { ok: false, error };
    }
};

// Pinned to the app's origin, so a frame that navigated elsewhere gets nothing.
const postToken = (instanceId, token, origin) => {
    const iframe = window.iframe_for_app_instance?.(instanceId);
    if ( ! iframe?.contentWindow ) return false;
    let targetOrigin = origin;
    if ( ! targetOrigin ) {
        try {
            targetOrigin = new URL(iframe.src).origin;
        } catch {
            return false;
        }
    }
    try {
        iframe.contentWindow.postMessage({ msg: 'puter.token', token }, targetOrigin);
    } catch {
        return false;
    }
    return true;
};

/**
 * Mint a fresh token for an open godmode window and hand it to the app. A
 * window that isn't tracked, or has closed, is left alone.
 *
 * @param {string} instanceId
 * @param {{ origin?: string }} [from] Set when the app itself asked: where it
 *   asked from, once its message was matched to the window's frame. An app that
 *   asked is always answered; a scheduled renewal that kept the same token
 *   sends nothing.
 * @returns {Promise<boolean>} Whether the app was sent a token
 */
export const renewGodmodeToken = async (instanceId, from = {}) => {
    const entry = tracked.get(instanceId);
    if ( ! entry ) return false;
    if ( ! window.iframe_for_app_instance?.(instanceId) ) {
        tracked.delete(instanceId);
        return false;
    }
    if ( isAttestedOrigin(from.origin) ) entry.origin = from.origin;
    if ( Date.now() - entry.renewedAt < RENEW_COOLDOWN_MS ) {
        return postToken(instanceId, entry.token, entry.origin);
    }

    const result = await mintGodmodeToken(entry.appUid);
    if ( ! result.ok ) return false;
    entry.expiresAt = result.expiresAt;
    entry.renewedAt = Date.now();
    if ( !from.origin && sameTokenRow(entry.token, result.token) ) return false;
    entry.token = result.token;
    return postToken(instanceId, result.token, entry.origin);
};

const renewDue = () => {
    const now = Date.now();
    for ( const [instanceId, entry] of tracked ) {
        if ( shouldRenew(entry.expiresAt, now) ) {
            renewGodmodeToken(instanceId).catch(() => {});
        }
    }
    if ( tracked.size === 0 && checkTimer ) {
        clearInterval(checkTimer);
        checkTimer = null;
    }
};

/**
 * Keep an open godmode window's token renewed for as long as it stays open.
 *
 * @param {string} instanceId
 * @param {string} appUid
 * @param {string} token
 * @param {number} expiresAt Unix seconds
 */
export const trackGodmodeToken = (instanceId, appUid, token, expiresAt) => {
    tracked.set(instanceId, { appUid, token, expiresAt, renewedAt: Date.now() });
    if ( ! checkTimer ) {
        checkTimer = setInterval(renewDue, CHECK_INTERVAL_MS);
    }
};

// Timers stall while a laptop sleeps; catch up as soon as the tab is back.
if ( typeof document !== 'undefined' ) {
    document.addEventListener('visibilitychange', () => {
        if ( document.visibilityState === 'visible' ) renewDue();
    });
}
