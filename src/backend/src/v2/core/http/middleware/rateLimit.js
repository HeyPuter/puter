import crypto from 'node:crypto';
import { HttpError } from '../HttpError.js';

/**
 * In-memory sliding-window rate limiter.
 *
 * Keyed by arbitrary string. Each key tracks an array of timestamps;
 * `check()` counts how many fall within the window and rejects if
 * the limit is exceeded. A periodic cleanup sweeps stale entries.
 *
 * Single instance shared across all routes and the driver endpoint.
 */
class RateLimiter {
    #windows = new Map();
    #cleanupTimer = null;

    constructor () {
        this.#cleanupTimer = setInterval(() => this.#cleanup(), 4.5 * 60_000);
        this.#cleanupTimer.unref?.();
    }

    /**
     * Check whether the key is within its limit. If yes, records the
     * request and returns true. If no, returns false (does NOT record).
     */
    check (key, limit, windowMs) {
        const now = Date.now();
        const cutoff = now - windowMs;
        let timestamps = this.#windows.get(key);

        if ( ! timestamps ) {
            timestamps = [];
            this.#windows.set(key, timestamps);
        }

        // Trim expired
        while ( timestamps.length > 0 && timestamps[0] < cutoff ) {
            timestamps.shift();
        }

        if ( timestamps.length >= limit ) return false;

        timestamps.push(now);
        return true;
    }

    /**
     * Increment without checking — used when you want to penalise a
     * failed attempt (e.g. wrong password) separately from the gate.
     */
    incr (key) {
        let timestamps = this.#windows.get(key);
        if ( ! timestamps ) {
            timestamps = [];
            this.#windows.set(key, timestamps);
        }
        timestamps.push(Date.now());
    }

    #cleanup () {
        for ( const [key, timestamps] of this.#windows.entries() ) {
            if ( timestamps.length === 0 ) {
                this.#windows.delete(key);
            }
        }
    }
}

/** Singleton — shared across routes + drivers. */
export const rateLimiter = new RateLimiter();

// ── Key strategies ──────────────────────────────────────────────────

/**
 * Build a rate-limit key from the request.
 *
 * Strategies:
 *   'fingerprint' — IP + User-Agent hash (default). Good for
 *                    unauthenticated endpoints where the same IP may
 *                    serve many users (offices, VPNs).
 *   'ip'          — bare IP. Simpler but coarser.
 *   'user'        — actor UUID. Use for authenticated endpoints where
 *                    you want per-account limits regardless of IP.
 *   function      — custom `(req) => string`.
 */
function resolveKey (req, scope, strategy) {
    const prefix = scope ? `${scope}:` : '';

    if ( typeof strategy === 'function' ) {
        return prefix + strategy(req);
    }

    switch ( strategy ) {
        case 'user': {
            const id = req.actor?.user?.id;
            if ( ! id ) {
                // Fall back to fingerprint if no actor (shouldn't happen
                // on requireAuth routes, but be safe)
                return prefix + fingerprint(req);
            }
            return prefix + id;
        }
        case 'ip':
            return prefix + ip(req);
        case 'fingerprint':
        default:
            return prefix + fingerprint(req);
    }
}

function ip (req) {
    return req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        || req.socket?.remoteAddress
        || 'unknown';
}

function fingerprint (req) {
    const parts = [
        ip(req),
        req.headers?.['user-agent'] || '',
        req.headers?.['accept-language'] || '',
        req.headers?.['accept-encoding'] || '',
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('base64url').slice(0, 16);
}

// ── Route middleware ────────────────────────────────────────────────

/**
 * Express middleware factory. Reads from the materialised route option:
 *
 *   { rateLimit: { limit: 10, window: 15 * 60_000, key: 'user' } }
 *   { rateLimit: { limit: 100, window: 60_000 } }           // fingerprint default
 *
 * Rejects with 429.
 */
export function rateLimitGate (opts) {
    const { limit, window: windowMs, key: strategy = 'fingerprint', scope } = opts;

    return (req, _res, next) => {
        const key = resolveKey(req, scope ?? req.route?.path ?? 'route', strategy);
        if ( ! rateLimiter.check(key, limit, windowMs) ) {
            return next(new HttpError(429, 'Too many requests.'));
        }
        next();
    };
}

// ── Driver-call helper ──────────────────────────────────────────────

/**
 * Check rate limit for a driver call. Called from DriverRegistry's
 * /call handler. Keyed by user + interface:method.
 *
 * Returns true if allowed, false if rate-limited.
 */
export function checkDriverRateLimit (req, ifaceName, method, limit = 60, windowMs = 60_000) {
    const uid = req.actor?.user?.uuid || fingerprint(req);
    const key = `driver:${ifaceName}:${method}:${uid}`;
    return rateLimiter.check(key, limit, windowMs);
}
