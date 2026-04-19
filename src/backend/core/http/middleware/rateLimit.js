import crypto from 'node:crypto';
import { HttpError } from '../HttpError.js';

/**
 * Sliding-window rate limiter with a swappable backend.
 *
 * Three backends, selected once at boot via `configureRateLimit(...)`:
 *   - `memory` (default): per-process counters.
 *   - `redis`:  Redis sorted sets — atomic per key across a cluster.
 *   - `kv`:     one row per hit in the system KV (DynamoDB), with TTL.
 *               `kv.list()` already drops expired rows, so "entries under
 *               the prefix" == "entries still in the window".
 *
 * Each backend exports a `check(key, limit, windowMs)` that returns
 * `true` (and records the hit) or `false` (rate-limited). That's the
 * whole surface.
 */

// ── Memory backend ──────────────────────────────────────────────────

const memoryWindows = new Map();
{
    const sweep = setInterval(() => {
        for ( const [k, ts] of memoryWindows ) if ( ts.length === 0 ) memoryWindows.delete(k);
    }, 4.5 * 60_000);
    sweep.unref?.();
}

async function checkMemory (key, limit, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    let timestamps = memoryWindows.get(key);
    if ( ! timestamps ) {
        timestamps = [];
        memoryWindows.set(key, timestamps);
    }
    while ( timestamps.length > 0 && timestamps[0] < cutoff ) timestamps.shift();
    if ( timestamps.length >= limit ) return false;
    timestamps.push(now);
    return true;
}

// ── Redis backend ───────────────────────────────────────────────────

async function checkRedis (redis, key, limit, windowMs) {
    const redisKey = `rate:${key}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const member = `${now}:${crypto.randomUUID()}`;

    // Trim expired entries and count in the same round-trip.
    const results = await redis.multi()
        .zremrangebyscore(redisKey, 0, cutoff)
        .zcard(redisKey)
        .exec();
    const count = Number(Array.isArray(results[1]) ? results[1][1] : results[1]);
    if ( count >= limit ) return false;

    // Record this hit; bump the key's TTL so idle buckets evict themselves.
    await redis.multi()
        .zadd(redisKey, now, member)
        .pexpire(redisKey, windowMs)
        .exec();
    return true;
}

// ── KV backend ──────────────────────────────────────────────────────

async function checkKv (kv, key, limit, windowMs) {
    const prefix = `rate:${key}:`;
    // `list` filters by TTL already, so a non-expired row ⇒ in-window.
    // Cap the fetch at `limit + 1` — once we know it's over, the exact
    // count doesn't matter.
    const { res } = await kv.list({ as: 'keys', pattern: prefix, limit: limit + 1 });
    const keys = Array.isArray(res) ? res : (res?.items ?? []);
    if ( keys.length >= limit ) return false;

    const now = Date.now();
    await kv.set({
        key: `${prefix}${now}:${crypto.randomUUID()}`,
        value: 1,
        expireAt: Math.ceil((now + windowMs) / 1000),
    });
    return true;
}

// ── Backend selection ───────────────────────────────────────────────

let checkFn = checkMemory;

/**
 * Call once during server boot, after clients/stores are built.
 *   configureRateLimit({ backend: 'redis', redis: clients.redis })
 *   configureRateLimit({ backend: 'kv',    kv: stores.kv })
 *   configureRateLimit()                    // memory
 *
 * Throws if the chosen backend's dependency is missing, so a typo in
 * config surfaces loudly instead of silently downgrading.
 */
export function configureRateLimit ({ backend, redis, kv } = {}) {
    if ( backend === 'redis' ) {
        if ( ! redis ) throw new Error('rate-limit: redis backend requires a redis client');
        checkFn = (key, limit, windowMs) => checkRedis(redis, key, limit, windowMs);
        return;
    }
    if ( backend === 'kv' ) {
        if ( ! kv ) throw new Error('rate-limit: kv backend requires a kv store');
        checkFn = (key, limit, windowMs) => checkKv(kv, key, limit, windowMs);
        return;
    }
    checkFn = checkMemory;
}

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
 * Rejects with 429. Fails open on backend error — a broken Redis/KV
 * shouldn't 500 every request.
 */
export function rateLimitGate (opts) {
    const { limit, window: windowMs, key: strategy = 'fingerprint', scope } = opts;

    return async (req, _res, next) => {
        const key = resolveKey(req, scope ?? req.route?.path ?? 'route', strategy);
        try {
            if ( ! await checkFn(key, limit, windowMs) ) return next(new HttpError(429, 'Too many requests.'));
            next();
        } catch ( err ) {
            console.error('[rate-limit] backend check failed, failing open:', err);
            next();
        }
    };
}

// ── Driver-call helper ──────────────────────────────────────────────

/**
 * Check rate limit for a driver call. Called from DriverController's
 * /call handler. Keyed by user + interface:method so different drivers
 * and different methods don't crowd each other.
 *
 * Defaults to 600/minute (10/sec) — loose enough for chatty UI patterns
 * (app listings, repeated `puter-apps:es:app:read` during desktop boot,
 * kv polling) while still catching runaway loops. Origin/main only
 * rate-limited drivers whose policy explicitly asked for it; caller can
 * still pass tighter values for sensitive methods.
 *
 * Returns true if allowed, false if rate-limited.
 */
export async function checkDriverRateLimit (req, ifaceName, method, limit = 600, windowMs = 60_000) {
    const uid = req.actor?.user?.uuid || fingerprint(req);
    const key = `driver:${ifaceName}:${method}:${uid}`;
    try {
        return await checkFn(key, limit, windowMs);
    } catch ( err ) {
        console.error('[rate-limit] driver check failed, failing open:', err);
        return true;
    }
}
