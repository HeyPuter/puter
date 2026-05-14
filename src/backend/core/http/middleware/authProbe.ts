/**
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
import type { AuthService } from '../../../services/auth/AuthService';

// Ensure the `Request.actor` / `Request.token` augmentation is in scope
// wherever this middleware is imported.
import '../expressAugmentation';

interface AuthProbeOptions {
    authService: AuthService;
    /** Name of the session cookie to inspect. Falls back to `config.cookie_name`. */
    cookieName?: string;
}

/**
 * Non-enforcing auth probe. Runs globally (installed by `PuterServer`) on
 * every request, tries to locate a token in the usual places, and — if one
 * is present and valid — attaches an `Actor` to `req.actor`.
 *
 * Key property: this middleware **never rejects**. Missing tokens, malformed
 * tokens, expired tokens, tokens pointing at deleted users — all result in
 * `req.actor` being left undefined. Per-route gates decide whether absence
 * is acceptable.
 *
 * Token lookup order:
 *   1. `req.body.auth_token`
 *   2. `Authorization: Bearer <token>` header
 *   3. `x-api-key` header — third-party SDK convention (Anthropic etc.)
 *   4. Session cookie, only when the browser request is same-origin
 *   5. `?auth_token=...` query param
 *   6. Socket handshake query (for ws upgrades that pass through HTTP first)
 */
export const createAuthProbe = (opts: AuthProbeOptions): RequestHandler => {
    const { authService, cookieName } = opts;
    return async (req, _res, next): Promise<void> => {
        // If something upstream already attached an actor, respect it.
        if (req.actor) {
            next();
            return;
        }

        const token = extractToken(req, cookieName);
        if (!token) {
            next();
            return;
        }

        try {
            const actor = await authService.authenticateFromToken(token);
            if (actor) {
                req.actor = actor;
                req.token = token;
            } else {
                // Token was present but didn't resolve — covers v1-shape
                // tokens v2 can't authenticate (e.g. FPE-encrypted session
                // UUIDs), as well as tokens whose session/user/app rows
                // have been deleted. `requireAuthGate` reads this flag
                // to emit `token_auth_failed` (matching v1) so clients
                // trigger their re-login flow instead of retrying.
                req.tokenAuthFailed = true;
            }
        } catch {
            // Probe never rejects — invalid tokens just leave `req.actor`
            // undefined. Same flag as above so the gate's response shape
            // is identical regardless of whether the failure came from
            // jwt.verify or a downstream lookup.
            req.tokenAuthFailed = true;
        }
        next();
    };
};

/**
 * Token extraction logic covering the request sources clients use to
 * authenticate.
 */
const extractToken = (req: Request, cookieName?: string): string | null => {
    // 1. Body (`{ "auth_token": "..." }`)
    const bodyToken = (req.body as { auth_token?: unknown } | undefined)
        ?.auth_token;
    if (typeof bodyToken === 'string' && bodyToken.length > 0) {
        return stripBearer(bodyToken);
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
            return stripped;
        }
    }

    // 3. `x-api-key` header — some third-party SDKs (Anthropic's in
    // particular) send their API key in this header. Accepted globally
    // so every route gated on auth works uniformly for those clients.
    const xApiKey =
        typeof req.header === 'function' ? req.header('x-api-key') : undefined;
    if (typeof xApiKey === 'string' && xApiKey.length > 0) {
        return stripBearer(xApiKey);
    }

    // 4. Cookie (set by login flow for session tokens). Do not let an
    // arbitrary browser Origin spend an ambient session cookie against the
    // credentialed API CORS surface; bearer/body/x-api-key tokens remain
    // available for cross-origin SDK requests.
    if (cookieName && !isCrossOriginBrowserRequest(req)) {
        const cookieToken = req.cookies?.[cookieName];
        if (typeof cookieToken === 'string' && cookieToken.length > 0) {
            return stripBearer(cookieToken);
        }
    }

    // 5. Query string (used by e.g. QR login, asset URLs).
    const queryToken = (req.query as { auth_token?: unknown } | undefined)
        ?.auth_token;
    if (typeof queryToken === 'string' && queryToken.length > 0) {
        return stripBearer(queryToken);
    }

    // 6. Socket handshake (for websocket upgrades that pass through HTTP).
    const handshake = (
        req as unknown as { handshake?: { query?: { auth_token?: unknown } } }
    ).handshake;
    const handshakeToken = handshake?.query?.auth_token;
    if (typeof handshakeToken === 'string' && handshakeToken.length > 0) {
        return stripBearer(handshakeToken);
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
