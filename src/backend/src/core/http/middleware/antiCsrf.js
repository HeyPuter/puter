import crypto from 'node:crypto';
import { HttpError } from '../HttpError.js';

/**
 * Anti-CSRF token manager.
 *
 * Per-session circular buffer of one-time tokens. Each session can
 * hold up to MAX_TOKENS tokens; when the buffer fills, the oldest
 * token is evicted. Tokens are consumed on use (one-time).
 *
 * Usage:
 *   // Generate — GET /get-anticsrf-token
 *   const token = antiCsrf.createToken(sessionId);
 *
 *   // Consume — in a route handler
 *   if ( ! antiCsrf.consumeToken(sessionId, req.body.anti_csrf) ) {
 *       throw new HttpError(400, 'incorrect anti-CSRF token');
 *   }
 */

const MAX_TOKENS = 10;

class AntiCsrf {
    /** session → Map<token, true> (acts as an ordered set via insertion order) */
    #sessions = new Map();

    createToken (sessionId) {
        const token = crypto.randomBytes(32).toString('hex');
        let ring = this.#sessions.get(sessionId);
        if ( ! ring ) {
            ring = new Map();
            this.#sessions.set(sessionId, ring);
        }
        // Evict oldest if full
        if ( ring.size >= MAX_TOKENS ) {
            const oldest = ring.keys().next().value;
            ring.delete(oldest);
        }
        ring.set(token, true);
        return token;
    }

    consumeToken (sessionId, token) {
        if ( ! token || ! sessionId ) return false;
        const ring = this.#sessions.get(sessionId);
        if ( ! ring ) return false;
        if ( ! ring.has(token) ) return false;
        ring.delete(token);
        if ( ring.size === 0 ) this.#sessions.delete(sessionId);
        return true;
    }
}

/** Singleton instance. */
export const antiCsrf = new AntiCsrf();

// ── Route middleware ────────────────────────────────────────────────

/**
 * Middleware that requires a valid anti-CSRF token in `req.body.anti_csrf`.
 * The session key is `req.actor.user.uuid` (or configurable).
 */
export function requireAntiCsrf () {
    return (req, _res, next) => {
        const sessionId = req.actor?.user?.uuid;
        if ( ! sessionId ) {
            return next(new HttpError(401, 'Authentication required for CSRF protection.'));
        }
        if ( ! antiCsrf.consumeToken(sessionId, req.body?.anti_csrf) ) {
            return next(new HttpError(400, 'Incorrect anti-CSRF token.'));
        }
        next();
    };
}
