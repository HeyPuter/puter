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

import type { Request, RequestHandler } from 'express';
import type {
    AuthService,
    ReauthReason,
} from '../../../services/auth/AuthService';
import { assertResolvedActor } from '../../actor';
import type { TokenSource } from '../types';

// Ensure the `Request.actor` / `Request.token` augmentation is in scope
// wherever this middleware is imported.
import '../expressAugmentation';

interface AuthProbeOptions {
    authService: AuthService;
    /**
     * Name of the session cookie to inspect. Falls back to
     * `config.cookie_name`.
     */
    cookieName?: string;
}

/**
 * Non-enforcing auth probe. Runs globally (installed by `PuterServer`) on every
 * request, tries to locate a token in the usual places, and — if one is present
 * and valid — attaches an `Actor` to `req.actor`.
 *
 * Key property: this middleware **never rejects**. Missing tokens, malformed
 * tokens, expired tokens, tokens pointing at deleted users — all result in
 * `req.actor` being left undefined. Per-route gates decide whether absence is
 * acceptable.
 *
 * Token lookup order:
 *
 * 1. `req.body.auth_token`
 * 2. `Authorization: Bearer <token>` header
 * 3. `x-api-key` header — third-party SDK convention (Anthropic etc.)
 * 4. Session cookie, only when the browser request is same-origin
 * 5. `?auth_token=...` query param
 * 6. Socket handshake query (for ws upgrades that pass through HTTP first)
 */
// Reauth is a property of a session, not an event: a client still holding a
// legacy token repeats the identical line on every request it makes, which
// buries every other log line without adding information. Keep the forensic
// signal but emit it at most once per auth_id per window.
const REAUTH_LOG_WINDOW_MS = 10 * 60 * 1000;
// Bounds the map so a flood of distinct ids can't grow it without limit.
const REAUTH_LOG_MAX_KEYS = 1024;

export const createAuthProbe = (opts: AuthProbeOptions): RequestHandler => {
    const { authService, cookieName } = opts;

    const reauthLoggedAt = new Map<string, number>();
    const shouldLogReauth = (key: string): boolean => {
        const now = Date.now();
        const last = reauthLoggedAt.get(key);
        if (last !== undefined && now - last < REAUTH_LOG_WINDOW_MS) {
            return false;
        }
        if (reauthLoggedAt.size >= REAUTH_LOG_MAX_KEYS) {
            // Map iterates in insertion order and every log re-inserts, so
            // the first key is the least recently logged.
            const oldest = reauthLoggedAt.keys().next().value;
            if (oldest !== undefined) reauthLoggedAt.delete(oldest);
        }
        reauthLoggedAt.delete(key);
        reauthLoggedAt.set(key, now);
        return true;
    };

    return async (req, _res, next): Promise<void> => {
        // If something upstream already attached an actor, respect it.
        if (req.actor) {
            next();
            return;
        }

        const extracted = extractToken(req, cookieName);
        if (!extracted) {
            next();
            return;
        }
        const { token, source } = extracted;

        try {
            // Thread the request IP and User-Agent into authenticate so
            // SessionStore.touch can refresh `last_ip` / `last_user_agent`
            // when a session roams to a new network / browser.
            const result = await authService.authenticate(token, {
                ip: req.ip,
                userAgent: req.headers['user-agent'] ?? undefined,
            });

            if (result.reauth) {
                const { reason, auth_id } = result.reauth;
                // Bind a short-lived JWT proving the rejected session
                // identified this auth_id. The GUI echoes this back on
                // /login or /signup; the raw auth_id is informational
                // only and is not accepted as authoritative on its own.
                //
                // Signed on read, not here: a legacy-but-still-valid token
                // sets `reauth` on a request that then succeeds, and only
                // the 401 path ever reads the token, so signing eagerly
                // burns a JWT per request for a value nobody looks at.
                let signed = false;
                let signedToken: string | undefined;
                req.requiresReauth = {
                    reason: reason as ReauthReason,
                    auth_id,
                    get reauth_token() {
                        if (!signed) {
                            signed = true;
                            try {
                                signedToken = auth_id
                                    ? authService.signReauthToken(auth_id)
                                    : undefined;
                            } catch {
                                // Losing the hint is survivable; the client
                                // still gets `reauth_required` and can log in.
                                signedToken = undefined;
                            }
                        }
                        return signedToken;
                    },
                };
                if (shouldLogReauth(`${reason}:${auth_id ?? '-'}`)) {
                    console.info(
                        `[auth-v2] reauth reason=${reason} auth_id=${auth_id ?? '-'}`,
                    );
                }
            }

            if (result.blocked) {
                // App is on the origin blocklist: leave `actor` unset so gates
                // reject. `appBlocked` lets the gate emit a clear 403 instead
                // of the generic "token failed" 401.
                req.appBlocked = { reason: result.blocked.reason };
            }

            if (result.actor) {
                req.actor = assertResolvedActor(result.actor);
                req.token = token;
                req.tokenSource = source;
            } else if (result.invalid) {
                req.tokenAuthFailed = true;
            }
        } catch {
            req.tokenAuthFailed = true;
        }
        next();
    };
};

/**
 * Token extraction logic covering the request sources clients use to
 * authenticate.
 */
const extractToken = (
    req: Request,
    cookieName?: string,
): { token: string; source: TokenSource } | null => {
    // 1. Body (`{ "auth_token": "..." }`)
    const bodyToken = (req.body as { auth_token?: unknown } | undefined)
        ?.auth_token;
    if (typeof bodyToken === 'string' && bodyToken.length > 0) {
        return { token: stripBearer(bodyToken), source: 'body' };
    }

    // 2. Authorization header. Reject `Basic ...` (not our scheme) and
    // the bare word `Bearer` (sent by some Office clients as a placeholder).
    const authHeader =
        typeof req.header === 'function'
            ? req.header('Authorization')
            : undefined;
    if (
        typeof authHeader === 'string' &&
        !authHeader.startsWith('Basic ') &&
        authHeader !== 'Bearer'
    ) {
        const stripped = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (stripped.length > 0 && stripped !== 'undefined') {
            return { token: stripped, source: 'header' };
        }
    }

    // 3. `x-api-key` header — some third-party SDKs (Anthropic's in
    // particular) send their API key in this header. Accepted globally
    // so every route gated on auth works uniformly for those clients.
    const xApiKey =
        typeof req.header === 'function' ? req.header('x-api-key') : undefined;
    if (typeof xApiKey === 'string' && xApiKey.length > 0) {
        return { token: stripBearer(xApiKey), source: 'x-api-key' };
    }

    // 4. Cookie (set by login flow for session tokens). Do not let an
    // arbitrary browser Origin spend an ambient session cookie against the
    // credentialed API CORS surface; bearer/body/x-api-key tokens remain
    // available for cross-origin SDK requests.
    //
    // `puter_token_v2` was the cookie companion to app-under-user tokens
    // handed out by the retired token migration. Nothing issues it any more;
    // values still sitting in browsers are honored (under the same
    // same-origin gate as the primary session cookie) until they expire, and
    // logout clears it.
    if (!isCrossOriginBrowserRequest(req)) {
        if (cookieName) {
            const cookieToken = req.cookies?.[cookieName];
            if (typeof cookieToken === 'string' && cookieToken.length > 0) {
                return { token: stripBearer(cookieToken), source: 'cookie' };
            }
        }
        const v2Token = req.cookies?.puter_token_v2;
        if (typeof v2Token === 'string' && v2Token.length > 0) {
            return { token: stripBearer(v2Token), source: 'cookie' };
        }
    }

    // 5. Query string (used by e.g. QR login, asset URLs).
    const queryToken = (req.query as { auth_token?: unknown } | undefined)
        ?.auth_token;
    if (typeof queryToken === 'string' && queryToken.length > 0) {
        return { token: stripBearer(queryToken), source: 'query' };
    }

    // 6. Socket handshake (for websocket upgrades that pass through HTTP).
    const handshake = (
        req as unknown as { handshake?: { query?: { auth_token?: unknown } } }
    ).handshake;
    const handshakeToken = handshake?.query?.auth_token;
    if (typeof handshakeToken === 'string' && handshakeToken.length > 0) {
        return { token: stripBearer(handshakeToken), source: 'handshake' };
    }

    return null;
};

const stripBearer = (t: string): string => t.replace(/^Bearer\s+/i, '').trim();

const isCrossOriginBrowserRequest = (req: Request): boolean => {
    const origin =
        typeof req.header === 'function' ? req.header('origin') : undefined;
    if (!origin) return false;

    const host =
        typeof req.header === 'function' ? req.header('host') : undefined;
    if (!host) return true;

    const protocol =
        typeof req.protocol === 'string' && req.protocol.length > 0
            ? req.protocol
            : undefined;
    if (!protocol) return true;

    try {
        const requestOrigin = new URL(`${protocol}://${host.trim()}`).origin;
        return new URL(origin).origin !== requestOrigin;
    } catch {
        return true;
    }
};
