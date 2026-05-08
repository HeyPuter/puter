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

import crypto from 'node:crypto';
import { HttpError } from '../HttpError.js';

/**
 * Sliding-window rate limiter with a swappable backend.
 *
 * Three backends, selected once at boot via `configureRateLimit(...)`:
 *   - `redis`:  Redis sorted sets — atomic per key across a cluster.
 *               Boot default (server.ts); ioredis-mock in dev.
 *   - `kv`:     one row per hit in the system KV (DynamoDB), with TTL.
 *               `kv.list()` already drops expired rows, so "entries under
 *               the prefix" == "entries still in the window".
 *   - `memory`: per-process counters. Capped + actively swept; does not
 *               coordinate across nodes, so use only when redis is absent.
 *
 * Each backend exports a `check(key, limit, windowMs)` that returns
 * `true` (and records the hit) or `false` (rate-limited). That's the
 * whole surface.
 */

// ── Memory backend ──────────────────────────────────────────────────

// Hard cap and retention bound memory in the worst case. Without them,
// one-shot keys (visited once, never again) leak forever: their single
// timestamp prevents the empty-array sweep from collecting them, even
// after the window has long passed.
const MEMORY_MAX_KEYS = 10_000;
const MEMORY_MAX_RETAIN_MS = 60 * 60_000;

const memoryWindows = new Map();
{
    const sweep = setInterval(() => {
        const cutoff = Date.now() - MEMORY_MAX_RETAIN_MS;
        for (const [k, ts] of memoryWindows) {
            if (ts.length === 0 || ts[ts.length - 1] < cutoff)
                memoryWindows.delete(k);
        }
    }, 60_000);
    sweep.unref?.();
}

async function checkMemory(key, limit, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    let timestamps = memoryWindows.get(key);
    if (!timestamps) {
        // Map preserves insertion order; FIFO-evict before adding so a
        // unique-key flood between sweep ticks can't blow up memory.
        if (memoryWindows.size >= MEMORY_MAX_KEYS) {
            const oldest = memoryWindows.keys().next().value;
            memoryWindows.delete(oldest);
        }
        timestamps = [];
        memoryWindows.set(key, timestamps);
    }
    while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
    if (timestamps.length >= limit) return false;
    timestamps.push(now);
    return true;
}

// ── Redis backend ───────────────────────────────────────────────────

async function checkRedis(
    /** @type {import('ioredis').Cluster} */
    redis,
    /** @type {string} */
    key,
    /** @type {number} */
    limit,
    /** @type {number} */
    windowMs,
) {
    const redisKey = `rate:${key}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const member = `${now}:${crypto.randomUUID()}`;

    // Valkey/Redis MULTI/EXEC keeps this standard-command path compatible with
    // managed clusters where Lua scripting may be restricted. Add before
    // counting so concurrent requests cannot all observe count < limit and
    // over-admit; if the post-add count is too high, remove this request's
    // member and reject. Races can be conservative, but not permissive.
    const results = await redis
        .multi()
        .zremrangebyscore(redisKey, 0, cutoff)
        .zadd(redisKey, now, member)
        .zcard(redisKey)
        .pexpire(redisKey, windowMs)
        .exec();

    const count = Number(
        Array.isArray(results[2]) ? results[2][1] : results[2],
    );
    if (count > limit) {
        await redis.zrem(redisKey, member);
        return false;
    }
    return true;
}

// ── KV backend ──────────────────────────────────────────────────────

async function checkKv(kv, key, limit, windowMs) {
    const prefix = `rate:${key}:`;
    // `list` filters by TTL already, so a non-expired row ⇒ in-window.
    // Cap the fetch at `limit + 1` — once we know it's over, the exact
    // count doesn't matter.
    const { res } = await kv.list({
        as: 'keys',
        pattern: prefix,
        limit: limit + 1,
    });
    const keys = Array.isArray(res) ? res : (res?.items ?? []);
    if (keys.length >= limit) return false;

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
export function configureRateLimit({ backend, redis, kv } = {}) {
    if (backend === 'redis') {
        if (!redis)
            throw new Error(
                'rate-limit: redis backend requires a redis client',
            );
        checkFn = (key, limit, windowMs) =>
            checkRedis(redis, key, limit, windowMs);
        return;
    }
    if (backend === 'kv') {
        if (!kv) throw new Error('rate-limit: kv backend requires a kv store');
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
function resolveKey(req, scope, strategy) {
    const prefix = scope ? `${scope}:` : '';

    if (typeof strategy === 'function') {
        return prefix + strategy(req);
    }

    switch (strategy) {
        case 'user': {
            const id = req.actor?.user?.id;
            if (!id) {
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

function ip(req) {
    // `req.ip` honors the app-level `trust proxy` setting — it returns the
    // leftmost untrusted XFF address when behind the configured proxy chain
    // and the direct socket peer otherwise. Reading XFF directly would let a
    // client forge their rate-limit key by spoofing the header.
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function fingerprint(req) {
    const parts = [
        ip(req),
        req.headers?.['user-agent'] || '',
        req.headers?.['accept-language'] || '',
        req.headers?.['accept-encoding'] || '',
    ];
    return crypto
        .createHash('sha256')
        .update(parts.join('|'))
        .digest('base64url')
        .slice(0, 16);
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
export function rateLimitGate(opts) {
    const {
        limit,
        window: windowMs,
        key: strategy = 'fingerprint',
        scope,
    } = opts;

    return async (req, _res, next) => {
        const key = resolveKey(
            req,
            scope ?? req.route?.path ?? 'route',
            strategy,
        );
        try {
            if (!(await checkFn(key, limit, windowMs)))
                return next(
                    new HttpError(429, 'Too many requests.', {
                        legacyCode: 'too_many_requests',
                    }),
                );
            next();
        } catch (err) {
            console.error(
                '[rate-limit] backend check failed, failing open:',
                err,
            );
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
export async function checkDriverRateLimit(
    req,
    ifaceName,
    method,
    limit = 600,
    windowMs = 60_000,
) {
    const uid = req.actor?.user?.uuid || fingerprint(req);
    const key = `driver:${ifaceName}:${method}:${uid}`;
    try {
        return await checkFn(key, limit, windowMs);
    } catch (err) {
        console.error('[rate-limit] driver check failed, failing open:', err);
        return true;
    }
}
