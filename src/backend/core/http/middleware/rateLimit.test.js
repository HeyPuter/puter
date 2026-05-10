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

import RedisMock from 'ioredis-mock';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { isHttpError } from '../HttpError.js';
import {
    checkDriverRateLimit,
    configureRateLimit,
    rateLimitGate,
} from './rateLimit.js';

// The rate-limit module is configured once at boot in production. In tests
// we reconfigure between backend suites; each suite calls
// `configureRateLimit(...)` in beforeAll. After each suite finishes we
// reset to the default (`memory`).

afterEach(() => {
    configureRateLimit(); // back to memory; isolates tests
});

// ── Memory backend ──────────────────────────────────────────────────

describe('rateLimitGate — memory backend (default)', () => {
    beforeEach(() => {
        configureRateLimit();
    });

    const runGate = async (opts, req) => {
        const next = vi.fn();
        await rateLimitGate(opts)(req, {}, next);
        expect(next).toHaveBeenCalledTimes(1);
        return next.mock.calls[0][0];
    };

    const makeReq = (init = {}) => ({
        ip: init.ip ?? '1.2.3.4',
        headers: init.headers ?? {},
        actor: init.actor,
        route: init.route,
        socket: init.socket ?? { remoteAddress: '1.2.3.4' },
    });

    it('admits up to `limit` hits and rejects the next one with 429', async () => {
        // Pin the route key so this test doesn't share state with others.
        const opts = { limit: 3, window: 60_000, scope: 'mem-basic' };
        for (let i = 0; i < 3; i++) {
            const arg = await runGate(opts, makeReq());
            expect(arg).toBeUndefined();
        }
        const rejected = await runGate(opts, makeReq());
        expect(isHttpError(rejected)).toBe(true);
        expect(rejected.statusCode).toBe(429);
        expect(rejected.legacyCode).toBe('too_many_requests');
    });

    it("'user' strategy buckets by actor.user.id (different users don't crowd)", async () => {
        const opts = {
            limit: 1,
            window: 60_000,
            key: 'user',
            scope: 'mem-user',
        };
        // user-A: first request OK, second rate-limited.
        expect(
            await runGate(opts, makeReq({ actor: { user: { id: 100 } } })),
        ).toBeUndefined();
        const reA = await runGate(
            opts,
            makeReq({ actor: { user: { id: 100 } } }),
        );
        expect(isHttpError(reA)).toBe(true);
        // user-B: independent bucket — first request still OK.
        expect(
            await runGate(opts, makeReq({ actor: { user: { id: 200 } } })),
        ).toBeUndefined();
    });

    it("'ip' strategy buckets by req.ip — separate IPs are independent", async () => {
        const opts = { limit: 1, window: 60_000, key: 'ip', scope: 'mem-ip' };
        expect(
            await runGate(opts, makeReq({ ip: '1.1.1.1' })),
        ).toBeUndefined();
        const reA = await runGate(opts, makeReq({ ip: '1.1.1.1' }));
        expect(isHttpError(reA)).toBe(true);
        expect(
            await runGate(opts, makeReq({ ip: '2.2.2.2' })),
        ).toBeUndefined();
    });

    it("'fingerprint' (default) varies by IP + UA + accept-language + accept-encoding", async () => {
        // Same IP, different UAs → different buckets. This is why
        // fingerprint is the default for unauthenticated routes serving
        // shared-IP environments (offices, VPNs).
        const opts = { limit: 1, window: 60_000, scope: 'mem-fp' };
        const ip = '5.6.7.8';
        const a = await runGate(
            opts,
            makeReq({ ip, headers: { 'user-agent': 'browser-A' } }),
        );
        const b = await runGate(
            opts,
            makeReq({ ip, headers: { 'user-agent': 'browser-B' } }),
        );
        expect(a).toBeUndefined();
        expect(b).toBeUndefined();
        // Repeat with browser-A → should now be rate-limited.
        const re = await runGate(
            opts,
            makeReq({ ip, headers: { 'user-agent': 'browser-A' } }),
        );
        expect(isHttpError(re)).toBe(true);
    });

    it("falls back to fingerprint when 'user' strategy is selected but no actor present", async () => {
        // The fallback prevents anonymous traffic from sharing a single
        // bucket (which would invite trivial DoS via global rate-limit).
        const opts = {
            limit: 1,
            window: 60_000,
            key: 'user',
            scope: 'mem-user-fallback',
        };
        expect(
            await runGate(opts, makeReq({ ip: '9.9.9.9' })),
        ).toBeUndefined();
        // Same fingerprint → rate-limited.
        const re = await runGate(opts, makeReq({ ip: '9.9.9.9' }));
        expect(isHttpError(re)).toBe(true);
        // Different fingerprint → fresh.
        expect(
            await runGate(opts, makeReq({ ip: '8.8.8.8' })),
        ).toBeUndefined();
    });

    it('accepts a custom function as the key strategy', async () => {
        const opts = {
            limit: 1,
            window: 60_000,
            key: (req) => `custom-${req.headers['x-tenant']}`,
            scope: 'mem-custom',
        };
        expect(
            await runGate(
                opts,
                makeReq({ headers: { 'x-tenant': 'acme' } }),
            ),
        ).toBeUndefined();
        const re = await runGate(
            opts,
            makeReq({ headers: { 'x-tenant': 'acme' } }),
        );
        expect(isHttpError(re)).toBe(true);
        expect(
            await runGate(
                opts,
                makeReq({ headers: { 'x-tenant': 'other' } }),
            ),
        ).toBeUndefined();
    });

    it('sliding window: a hit that fell out of the window frees a slot', async () => {
        // Use a tiny window so we can wait it out without slow tests.
        const opts = { limit: 1, window: 30, scope: 'mem-sliding' };
        const req = makeReq();
        expect(await runGate(opts, req)).toBeUndefined();
        expect(isHttpError(await runGate(opts, req))).toBe(true);
        // Wait until the first hit ages out of the 30ms window.
        await new Promise((r) => setTimeout(r, 50));
        // Slot reopens.
        expect(await runGate(opts, req)).toBeUndefined();
    });

    it("uses req.route.path as scope when no explicit scope is given", async () => {
        // Same key strategy + same route path = same bucket;
        // different route paths = independent buckets.
        const optsA = {
            limit: 1,
            window: 60_000,
            key: 'ip',
        };
        const reqA = makeReq({ route: { path: '/route-a' } });
        const reqB = makeReq({ route: { path: '/route-b' } });
        expect(await runGate(optsA, reqA)).toBeUndefined();
        expect(isHttpError(await runGate(optsA, reqA))).toBe(true);
        // Different route → independent bucket.
        expect(await runGate(optsA, reqB)).toBeUndefined();
    });
});

// ── Redis backend (ioredis-mock) ────────────────────────────────────

describe('rateLimitGate — redis backend', () => {
    let redis;
    beforeAll(() => {
        redis = new RedisMock();
        configureRateLimit({ backend: 'redis', redis });
    });
    afterAll(async () => {
        await redis?.quit?.();
        configureRateLimit();
    });
    beforeEach(async () => {
        await redis.flushall();
    });

    it('admits up to `limit` and rejects further hits with 429', async () => {
        const opts = { limit: 2, window: 60_000, key: 'ip', scope: 'redis-1' };
        const req = {
            ip: '4.5.6.7',
            headers: {},
            socket: { remoteAddress: '4.5.6.7' },
        };
        for (let i = 0; i < 2; i++) {
            const next = vi.fn();
            await rateLimitGate(opts)(req, {}, next);
            expect(next.mock.calls[0][0]).toBeUndefined();
        }
        const next = vi.fn();
        await rateLimitGate(opts)(req, {}, next);
        const arg = next.mock.calls[0][0];
        expect(isHttpError(arg)).toBe(true);
        expect(arg.statusCode).toBe(429);
    });

    it("fails open (admits) when the backend throws — logs but doesn't 500", async () => {
        // A broken Redis shouldn't reject every request. Swap in a
        // throwing client just for this test, then restore.
        configureRateLimit({
            backend: 'redis',
            redis: {
                multi: () => {
                    throw new Error('redis down');
                },
            },
        });
        // Suppress the error log line.
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const next = vi.fn();
        await rateLimitGate({ limit: 1, window: 60_000, key: 'ip' })(
            { ip: '1.1.1.1', headers: {}, socket: {} },
            {},
            next,
        );
        // Critical: even though the backend exploded, we called next()
        // with no error. Failing open is the explicit policy.
        expect(next).toHaveBeenCalledWith();
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
        // Restore the working client for any later assertions in this suite.
        configureRateLimit({ backend: 'redis', redis });
    });
});

// ── Backend configuration ───────────────────────────────────────────

describe('configureRateLimit — backend selection', () => {
    it('throws when redis backend is selected without a client', () => {
        expect(() => configureRateLimit({ backend: 'redis' })).toThrow(
            /redis backend requires a redis client/,
        );
    });

    it('throws when kv backend is selected without a kv store', () => {
        expect(() => configureRateLimit({ backend: 'kv' })).toThrow(
            /kv backend requires a kv store/,
        );
    });

    it('unknown backend silently falls back to memory', () => {
        // Documented behavior: anything that isn't 'redis' or 'kv' is
        // memory. Worth pinning so a typo in config quietly works rather
        // than breaking boot — the rate limiter is best-effort security.
        expect(() => configureRateLimit({ backend: 'nonsense' })).not.toThrow();
    });
});

// ── checkDriverRateLimit ────────────────────────────────────────────

describe('checkDriverRateLimit', () => {
    beforeEach(() => {
        configureRateLimit();
    });

    it('returns true while under the limit and false once exceeded', async () => {
        const req = { actor: { user: { uuid: 'user-1' } } };
        for (let i = 0; i < 3; i++) {
            expect(
                await checkDriverRateLimit(req, 'kv', 'get', 3, 60_000),
            ).toBe(true);
        }
        expect(await checkDriverRateLimit(req, 'kv', 'get', 3, 60_000)).toBe(
            false,
        );
    });

    it("scopes by user — one user's traffic doesn't rate-limit another", async () => {
        // Drives the limit for user-A to its max, then verifies user-B is
        // still admitted.
        const reqA = { actor: { user: { uuid: 'user-A' } } };
        const reqB = { actor: { user: { uuid: 'user-B' } } };
        for (let i = 0; i < 2; i++) {
            await checkDriverRateLimit(reqA, 'kv', 'get', 2, 60_000);
        }
        expect(await checkDriverRateLimit(reqA, 'kv', 'get', 2, 60_000)).toBe(
            false,
        );
        // User-B still has full quota.
        expect(await checkDriverRateLimit(reqB, 'kv', 'get', 2, 60_000)).toBe(
            true,
        );
    });

    it('scopes by interface and method — independent buckets per (iface, method) pair', async () => {
        const req = { actor: { user: { uuid: 'user-scope' } } };
        await checkDriverRateLimit(req, 'kv', 'get', 1, 60_000);
        // Same user + same iface + different method → fresh bucket.
        expect(await checkDriverRateLimit(req, 'kv', 'set', 1, 60_000)).toBe(
            true,
        );
        // Same user + different iface + same method → fresh bucket too.
        expect(
            await checkDriverRateLimit(req, 'apps', 'get', 1, 60_000),
        ).toBe(true);
    });

    it('falls back to a fingerprint key for unauthenticated callers', async () => {
        const req = {
            ip: '7.7.7.7',
            headers: { 'user-agent': 'curl/8' },
            socket: { remoteAddress: '7.7.7.7' },
        };
        // First call admits, second exceeds the limit of 1.
        expect(await checkDriverRateLimit(req, 'kv', 'get', 1, 60_000)).toBe(
            true,
        );
        expect(await checkDriverRateLimit(req, 'kv', 'get', 1, 60_000)).toBe(
            false,
        );
    });
});
