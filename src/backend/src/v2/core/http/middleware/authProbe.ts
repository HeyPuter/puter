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
 *   4. Session cookie
 *   5. `?auth_token=...` query param
 *   6. Socket handshake query (for ws upgrades that pass through HTTP first)
 */
export const createAuthProbe = (opts: AuthProbeOptions): RequestHandler => {
    const { authService, cookieName } = opts;
    return async (req, _res, next): Promise<void> => {
        // If something upstream already attached an actor, respect it.
        if ( req.actor ) {
            next();
            return;
        }

        const token = extractToken(req, cookieName);
        if ( ! token ) {
            next();
            return;
        }

        try {
            const actor = await authService.authenticateFromToken(token);
            if ( actor ) {
                req.actor = actor;
                req.token = token;
            }
        } catch {
            // Probe never rejects — invalid tokens just leave `req.actor` undefined.
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
    const bodyToken = (req.body as { auth_token?: unknown } | undefined)?.auth_token;
    if ( typeof bodyToken === 'string' && bodyToken.length > 0 ) {
        return stripBearer(bodyToken);
    }

    // 2. Authorization header. Reject `Basic ...` (not our scheme) and
    // the bare word `Bearer` (sent by some Office clients as a placeholder).
    const authHeader = typeof req.header === 'function' ? req.header('Authorization') : undefined;
    if (
        typeof authHeader === 'string'
        && ! authHeader.startsWith('Basic ')
        && authHeader !== 'Bearer'
    ) {
        const stripped = authHeader.replace(/^Bearer\s+/i, '').trim();
        if ( stripped.length > 0 && stripped !== 'undefined' ) {
            return stripped;
        }
    }

    // 3. `x-api-key` header — some third-party SDKs (Anthropic's in
    // particular) send their API key in this header. Accepted globally
    // so every route gated on auth works uniformly for those clients.
    const xApiKey = typeof req.header === 'function' ? req.header('x-api-key') : undefined;
    if ( typeof xApiKey === 'string' && xApiKey.length > 0 ) {
        return stripBearer(xApiKey);
    }

    // 4. Cookie (set by login flow for session tokens). We parse the
    // Cookie header directly rather than depending on `cookie-parser`
    // middleware — the probe only needs one named value.
    if ( cookieName ) {
        const cookieToken = readCookie(req, cookieName);
        if ( cookieToken ) {
            return stripBearer(cookieToken);
        }
    }

    // 5. Query string (used by e.g. QR login, asset URLs).
    const queryToken = (req.query as { auth_token?: unknown } | undefined)?.auth_token;
    if ( typeof queryToken === 'string' && queryToken.length > 0 ) {
        return stripBearer(queryToken);
    }

    // 6. Socket handshake (for websocket upgrades that pass through HTTP).
    const handshake = (req as unknown as { handshake?: { query?: { auth_token?: unknown } } }).handshake;
    const handshakeToken = handshake?.query?.auth_token;
    if ( typeof handshakeToken === 'string' && handshakeToken.length > 0 ) {
        return stripBearer(handshakeToken);
    }

    return null;
};

const stripBearer = (t: string): string => t.replace(/^Bearer\s+/i, '').trim();

/**
 * Minimal cookie reader. Avoids pulling in `cookie-parser` for the one
 * lookup the probe needs. Handles quoted values and URL-decodes the result.
 */
const readCookie = (req: Request, name: string): string | null => {
    const header = typeof req.header === 'function' ? req.header('cookie') : undefined;
    if ( ! header || typeof header !== 'string' ) return null;
    const target = `${name}=`;
    for ( const rawPair of header.split(';') ) {
        const pair = rawPair.trim();
        if ( ! pair.startsWith(target) ) continue;
        let value = pair.slice(target.length);
        if ( value.startsWith('"') && value.endsWith('"') ) {
            value = value.slice(1, -1);
        }
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }
    return null;
};
