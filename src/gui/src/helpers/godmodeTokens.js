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
// A launch this soon after a mint reuses that token instead of asking again.
// Short, because a token revoked elsewhere goes unnoticed until the next ask.
const REUSE_WITHIN_MS = 10 * 60 * 1000;

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
 * The last token minted for each godmode app, and the desktop session token it
 * was minted with.
 *
 * @type {Map<string, {
 *     token: string;
 *     expiresAt: number;
 *     mintedAt: number;
 *     authToken: string;
 * }>}
 */
const lastMinted = new Map();
// Bumped by every forget, so a mint already in flight isn't remembered.
let mintGeneration = 0;

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
    const generation = mintGeneration;
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
            const expiresAt = Number(body.expires_at);
            if ( generation === mintGeneration ) {
                lastMinted.set(appUid, { token: body.token, expiresAt, mintedAt: Date.now(), authToken });
            }
            const tokenRow = tokenRowOf(body.token);
            if ( tokenRow ) tellPeers(appUid, tokenRow);
            return { ok: true, token: body.token, expiresAt };
        }
        return { ok: false, status: response.status };
    } catch ( error ) {
        return { ok: false, error };
    }
};

/**
 * A token minted for `appUid` moments ago under the same desktop session, for
 * a launch to use instead of asking again; null when there is none.
 *
 * @param {string} appUid
 * @param {object} [deps]
 * @param {string} [deps.authToken]
 * @param {number} [deps.nowMs]
 * @returns {{ ok: true; token: string; expiresAt: number; mintedAt: number } | null}
 */
export const reusableGodmodeToken = (appUid, deps = {}) => {
    const authToken = deps.authToken ?? window.auth_token;
    const nowMs = deps.nowMs ?? Date.now();
    const entry = lastMinted.get(appUid);
    if ( !entry || !authToken || entry.authToken !== authToken ) return null;
    const age = nowMs - entry.mintedAt;
    if ( age < 0 || age >= REUSE_WITHIN_MS || shouldRenew(entry.expiresAt, nowMs) ) return null;
    return { ok: true, token: entry.token, expiresAt: entry.expiresAt, mintedAt: entry.mintedAt };
};

/**
 * Stop reusing tokens minted for launches, for one app or all of them. Call
 * after revoking sessions, so the next launch asks for a live token.
 *
 * @param {string} [appUid]
 */
export const forgetGodmodeTokens = (appUid) => {
    forgetLocally(appUid);
    tellPeers(appUid ?? null, null);
};

const forgetLocally = (appUid) => {
    mintGeneration++;
    if ( appUid === undefined ) lastMinted.clear();
    else lastMinted.delete(appUid);
};

// Other tabs of this desktop share its session and so its token rows. They are
// told which row an app is on now, or to forget it; never the token itself.
const peers = typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel('puter-godmode-tokens');

/**
 * @param {string | null} appUid Null for every app
 * @param {string | null} tokenRow The app's current row; null to forget it
 */
const tellPeers = (appUid, tokenRow) => {
    try {
        peers?.postMessage({ appUid, tokenRow });
    } catch {
        // A closed channel only costs other tabs one extra mint.
    }
};

peers?.addEventListener('message', ({ data }) => {
    const appUid = data?.appUid;
    const tokenRow = data?.tokenRow;
    if ( appUid === null ) {
        forgetLocally();
        return;
    }
    if ( typeof appUid !== 'string' ) return;
    const entry = lastMinted.get(appUid);
    if ( typeof tokenRow === 'string' && (!entry || tokenRowOf(entry.token) === tokenRow) ) return;
    forgetLocally(appUid);
});

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
    // The app says its token stopped working; don't launch others with it.
    if ( from.origin ) forgetGodmodeTokens(entry.appUid);
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
 * @param {number} [renewedAt] When the token was minted, if not just now
 */
export const trackGodmodeToken = (instanceId, appUid, token, expiresAt, renewedAt = Date.now()) => {
    tracked.set(instanceId, { appUid, token, expiresAt, renewedAt });
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
