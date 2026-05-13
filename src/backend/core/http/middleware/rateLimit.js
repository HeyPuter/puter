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
 * Sliding-window rate limiter with swappable, **co-resident** backends.
 *
 * Three backend implementations are registered at boot via
 * `configureRateLimit(...)`; they all stay live simultaneously so that
 * different routes / driver methods can pick whichever storage best fits
 * their access pattern:
 *
 *   - `redis`:  Redis sorted sets — atomic per key across a cluster.
 *               Production default; ioredis-mock in dev.
 *   - `kv`:     one row per hit in the system KV (DynamoDB), with TTL.
 *               `kv.list()` already drops expired rows, so "entries under
 *               the prefix" == "entries still in the window".
 *   - `memory`: per-process counters. Capped + actively swept; does not
 *               coordinate across nodes, so use only for hot, ephemeral
 *               counters or when redis is absent.
 *
 * Each backend exports a `check(key, limit, windowMs)` that returns
 * `true` (and records the hit) or `false` (rate-limited). Callers select
 * one via the `backend` option; omitting it uses the configured default.
 */

// ── Backend names ────────────────────────────────────────────────────

export const RATE_LIMIT_BACKENDS = ['memory', 'redis', 'kv'];

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

// ── Concurrent in-flight backends ───────────────────────────────────
//
// Concurrent limiting is the *other* shape: rather than "no more than X
// hits in Y window", it's "no more than X requests in flight at once".
// Each backend's `acquire(key, limit)` returns either `{ ok: false }`
// (slot full → reject) or `{ ok: true, release }` (caller MUST call
// release exactly once when the request finishes, success or not).
//
// Lifecycle is the wedge between rate and concurrent limits: rate just
// records a tick, concurrent has to track "still in flight" → "done"
// across a request boundary. The route middleware hooks `res.finish` /
// `res.close`; the driver helper wraps the invocation in `try/finally`.

// Orphan TTL safety nets — used when the process dies between acquire
// and release. Memory backend doesn't need one (the process is also
// gone); redis/kv do, otherwise a stale slot pins the bucket forever.
const ORPHAN_SAFETY_TTL_SEC = 60 * 60; // 1 hour
const ORPHAN_SAFETY_TTL_MS = ORPHAN_SAFETY_TTL_SEC * 1000;

const memoryConcurrentCounts = new Map();

async function acquireMemoryConcurrent(key, limit) {
    const current = memoryConcurrentCounts.get(key) ?? 0;
    if (current >= limit) return { ok: false };
    memoryConcurrentCounts.set(key, current + 1);
    return {
        ok: true,
        release: () => {
            const c = memoryConcurrentCounts.get(key) ?? 0;
            if (c <= 1) memoryConcurrentCounts.delete(key);
            else memoryConcurrentCounts.set(key, c - 1);
        },
    };
}

async function acquireRedisConcurrent(redis, key, limit) {
    const redisKey = `concurrent:${key}`;
    // Atomic INCR + EXPIRE. If the new count exceeds the limit we DECR
    // ourselves back out; the brief over-count is invisible to other
    // callers because INCR is atomic per-key. EXPIRE is a safety net for
    // process death between acquire and release — slots eventually clear
    // on their own so a crashed worker can't pin the bucket.
    const results = await redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, ORPHAN_SAFETY_TTL_SEC)
        .exec();
    const count = Number(
        Array.isArray(results[0]) ? results[0][1] : results[0],
    );
    if (count > limit) {
        await redis.decr(redisKey);
        return { ok: false };
    }
    return {
        ok: true,
        release: async () => {
            // DECR can race below zero if the TTL fired between acquire
            // and release (slot cleared, counter resets, we DECR to -1).
            // Clamp on the next observation; it costs an extra read only
            // on the rare TTL race.
            const after = await redis.decr(redisKey);
            if (after < 0) await redis.set(redisKey, 0);
        },
    };
}

async function acquireKvConcurrent(kv, key, limit) {
    // KV has no atomic increment. Use the row-per-slot pattern: each
    // in-flight request owns a unique row under a shared prefix; count
    // by listing the prefix. Same race profile as `checkKv` — best
    // effort, conservative bias.
    const prefix = `concurrent:${key}:`;
    const { res } = await kv.list({
        as: 'keys',
        pattern: prefix,
        limit: limit + 1,
    });
    const keys = Array.isArray(res) ? res : (res?.items ?? []);
    if (keys.length >= limit) return { ok: false };

    const slotKey = `${prefix}${Date.now()}:${crypto.randomUUID()}`;
    await kv.set({
        key: slotKey,
        value: 1,
        // TTL safety net so an orphaned slot eventually clears.
        expireAt: Math.ceil((Date.now() + ORPHAN_SAFETY_TTL_MS) / 1000),
    });
    return {
        ok: true,
        release: async () => {
            await kv.del({ key: slotKey });
        },
    };
}

// ── Backend registry ────────────────────────────────────────────────
//
// All registered backends stay live simultaneously; selection happens
// per call via the `backend` option. The `default` slot is what callers
// get when they don't specify. Each backend entry holds both shapes —
// the single-shot `rate` check and the `acquire` for concurrent
// limiting — so route / driver code never has to reason about which
// backend is wired for which mode.

const backends = {
    memory: { rate: checkMemory, acquire: acquireMemoryConcurrent },
};
let defaultBackendName = 'memory';

// Metering service is wired here so the concurrency gate can resolve
// per-subscription limits without threading services through every
// middleware factory. Set by `configureRateLimit({ metering })`; stays
// `null` until then, in which case `bySubscription` overrides are
// silently skipped (the top-level `limit` applies to everyone).
let meteringService = null;

/**
 * Wire backend implementations. Call once during server boot, after
 * clients/stores are built. All backends with their dependency available
 * are registered concurrently — a route or driver method picks one
 * per-call via the `backend` option. The `default` slot selects the
 * fallback for callers that omit `backend`.
 *
 *   configureRateLimit({ default: 'redis', redis, kv, metering })
 *   configureRateLimit({ default: 'memory', redis })   // kv routes
 *                                                       // would fall back
 *   configureRateLimit()                                 // memory only
 *
 * `metering` is optional; pass the MeteringService instance to enable
 * `concurrent.bySubscription` overrides. Without it, the top-level
 * `limit` applies uniformly regardless of subscription tier.
 *
 * Throws if `default` names a backend whose dependency is missing — a
 * typo in config should surface loudly, not silently downgrade.
 */
export function configureRateLimit({
    default: defaultName,
    redis,
    kv,
    metering,
} = {}) {
    // Reset (test reconfigure clears stale wiring).
    for (const name of Object.keys(backends)) delete backends[name];
    backends.memory = { rate: checkMemory, acquire: acquireMemoryConcurrent };
    if (redis) {
        backends.redis = {
            rate: (key, limit, windowMs) =>
                checkRedis(redis, key, limit, windowMs),
            acquire: (key, limit) => acquireRedisConcurrent(redis, key, limit),
        };
    }
    if (kv) {
        backends.kv = {
            rate: (key, limit, windowMs) => checkKv(kv, key, limit, windowMs),
            acquire: (key, limit) => acquireKvConcurrent(kv, key, limit),
        };
    }

    meteringService = metering ?? null;

    if (defaultName) {
        if (!backends[defaultName]) {
            throw new Error(
                `rate-limit: default backend '${defaultName}' requires its dependency`,
            );
        }
        defaultBackendName = defaultName;
    } else {
        defaultBackendName = 'memory';
    }
}

/** Used by tests / boot to inspect what's wired. */
export function listConfiguredRateLimitBackends() {
    return { available: Object.keys(backends), default: defaultBackendName };
}

/**
 * Resolve the `{ rate, acquire }` backend pair for a named backend.
 * Unknown / unconfigured names log once and fall through to the default
 * so a typo in a route or driver decorator doesn't 500 every request —
 * rate limiting is best-effort security.
 */
function resolveBackend(name) {
    if (!name) return backends[defaultBackendName];
    const bk = backends[name];
    if (bk) return bk;
    console.warn(
        `[rate-limit] backend '${name}' not configured; using default '${defaultBackendName}'`,
    );
    return backends[defaultBackendName];
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
 *   { rateLimit: { limit: 100, window: 60_000, backend: 'memory' } }
 *
 * Rejects with 429. Fails open on backend error — a broken Redis/KV
 * shouldn't 500 every request.
 */
export function rateLimitGate(opts) {
    const {
        window: windowMs,
        key: strategy = 'fingerprint',
        scope,
        backend,
    } = opts;

    const backendPair = resolveBackend(backend);

    return async (req, _res, next) => {
        const key = resolveKey(
            req,
            scope ?? req.route?.path ?? 'route',
            strategy,
        );
        try {
            // `limit` may be overridden per-actor via `bySubscription`;
            // the resolver returns `opts.limit` unchanged when the
            // override doesn't apply (no actor, no metering, etc.).
            const limit = await resolveSubscriptionLimit(req, opts);
            if (!(await backendPair.rate(key, limit, windowMs)))
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
 * `opts` is the resolved per-method spec from the driver's decorator (or
 * imperative `rateLimit` field) — see `resolveDriverRateLimit` in
 * `drivers/meta.ts`. When `opts` is omitted (driver declares nothing)
 * we apply a loose 600/min default that's chatty enough for UI patterns
 * (app listings, repeated `puter-apps:es:app:read` during desktop boot,
 * kv polling) while still catching runaway loops.
 *
 * Returns true if allowed, false if rate-limited.
 */
export async function checkDriverRateLimit(req, ifaceName, method, opts = {}) {
    const { window: windowMs = 60_000, backend } = opts;
    const uid = req.actor?.user?.uuid || fingerprint(req);
    const key = `driver:${ifaceName}:${method}:${uid}`;
    const backendPair = resolveBackend(backend);
    try {
        // Drivers can pin a per-subscription limit via `bySubscription`
        // on their decorator config; `resolveSubscriptionLimit` reads
        // that through `opts.limit` and falls back to the 600/min
        // default when neither the spec nor the override apply.
        const limit = await resolveSubscriptionLimit(req, {
            limit: opts.limit ?? 600,
            bySubscription: opts.bySubscription,
        });
        return await backendPair.rate(key, limit, windowMs);
    } catch (err) {
        console.error('[rate-limit] driver check failed, failing open:', err);
        return true;
    }
}

// ── Subscription-aware limit resolution ─────────────────────────────

/**
 * Per-request limit resolution shared by `rateLimitGate` and
 * `concurrencyGate`. The base value is `opts.limit`; if `bySubscription`
 * is set and we have an authenticated actor plus a metering service, we
 * look up the actor's subscription policy and prefer the matching
 * entry. Failure to resolve (no actor, no metering, metering throws)
 * falls through to the base — rate / concurrency limiting should never
 * *amplify* a request failure path.
 */
async function resolveSubscriptionLimit(req, opts) {
    const base = opts.limit;
    if (!opts.bySubscription || !meteringService) return base;
    const actor = req.actor;
    if (!actor?.user?.uuid) return base;
    try {
        const sub = await meteringService.getActorSubscription(actor);
        const override = opts.bySubscription[sub.id];
        return typeof override === 'number' ? override : base;
    } catch {
        return base;
    }
}

// ── Concurrency gate + driver helper ────────────────────────────────

/**
 * Express middleware factory for concurrent in-flight limiting:
 *
 *   { concurrent: { limit: 5, key: 'user' } }
 *   { concurrent: { limit: 5, bySubscription: { user_free: 2, unlimited: 50 } } }
 *   { concurrent: { limit: 10, backend: 'redis', scope: 'expensive-op' } }
 *
 * On accept, schedules release on `res.finish` / `res.close` so even
 * aborted requests give their slot back. On reject, 429 with the same
 * `too_many_requests` legacyCode as the rate gate (clients already
 * handle that branch). Fails open on backend error.
 */
export function concurrencyGate(opts) {
    const { key: strategy = 'fingerprint', scope, backend } = opts;
    const backendPair = resolveBackend(backend);

    return async (req, res, next) => {
        const key = resolveKey(
            req,
            scope ?? req.route?.path ?? 'route',
            strategy,
        );
        let result;
        try {
            const limit = await resolveSubscriptionLimit(req, opts);
            result = await backendPair.acquire(key, limit);
        } catch (err) {
            console.error(
                '[concurrent] backend acquire failed, failing open:',
                err,
            );
            return next();
        }

        if (!result.ok) {
            return next(
                new HttpError(429, 'Too many concurrent requests.', {
                    legacyCode: 'too_many_requests',
                }),
            );
        }

        // `finish` (response sent) and `close` (connection closed,
        // possibly aborted before finish) can both fire; the once
        // guard makes release exactly-once.
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            Promise.resolve()
                .then(() => result.release())
                .catch((err) =>
                    console.error('[concurrent] release failed:', err),
                );
        };
        res.once('finish', release);
        res.once('close', release);
        next();
    };
}

/**
 * Acquire a concurrent slot for a driver call. Mirrors
 * `checkDriverRateLimit` but returns an acquisition handle: caller MUST
 * invoke `release()` on the returned object exactly once, even on
 * thrown errors — typically in a `finally`. `ok: false` means the slot
 * was full; callers should reject with 429 in that case.
 *
 * `opts` is the resolved per-method spec from the driver's decorator
 * (or imperative `concurrent` field). Omitting `opts` (driver declares
 * nothing) yields `{ ok: true, release: noop }` — drivers without a
 * declared concurrency limit are unbounded, which matches today's
 * behaviour. Apply a limit explicitly to opt in.
 */
export async function acquireDriverConcurrent(req, ifaceName, method, opts) {
    if (!opts || typeof opts.limit !== 'number') {
        return { ok: true, release: () => {} };
    }
    const { backend } = opts;
    const uid = req.actor?.user?.uuid || fingerprint(req);
    const key = `driver:${ifaceName}:${method}:${uid}`;
    const backendPair = resolveBackend(backend);
    try {
        const limit = await resolveSubscriptionLimit(req, opts);
        const result = await backendPair.acquire(key, limit);
        if (!result.ok) return { ok: false, release: () => {} };
        // Wrap release to swallow errors — a failed release shouldn't
        // bubble out of the handler's `finally`.
        return {
            ok: true,
            release: () =>
                Promise.resolve()
                    .then(() => result.release())
                    .catch((err) =>
                        console.error(
                            '[concurrent] driver release failed:',
                            err,
                        ),
                    ),
        };
    } catch (err) {
        console.error('[concurrent] driver acquire failed, failing open:', err);
        return { ok: true, release: () => {} };
    }
}
