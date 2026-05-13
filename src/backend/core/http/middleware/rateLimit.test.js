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
import { EventEmitter } from 'node:events';
import { isHttpError } from '../HttpError.js';
import {
    acquireDriverConcurrent,
    checkDriverRateLimit,
    concurrencyGate,
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

// ── rateLimit: bySubscription overrides ─────────────────────────────

describe('rateLimitGate — bySubscription overrides', () => {
    // Same metering stub pattern as the concurrency tests below.
    const makeMetering = (policiesByUuid) => ({
        getActorSubscription: async (actor) => {
            const id = policiesByUuid[actor.user.uuid];
            if (!id) throw new Error('no policy');
            return { id };
        },
    });

    afterEach(() => configureRateLimit()); // reset metering wiring

    const runGate = async (opts, req) => {
        const next = vi.fn();
        await rateLimitGate(opts)(req, {}, next);
        return next.mock.calls[0][0];
    };

    it("applies the per-subscription limit when the actor's plan matches", async () => {
        configureRateLimit({
            metering: makeMetering({ free: 'user_free', paid: 'unlimited' }),
        });
        const opts = {
            limit: 5,
            window: 60_000,
            bySubscription: { user_free: 1, unlimited: 100 },
            key: 'user',
            scope: 'rl-sub',
        };
        const freeReq = () => ({
            actor: { user: { id: 1, uuid: 'free' } },
            headers: {},
        });
        expect(await runGate(opts, freeReq())).toBeUndefined();
        // Free tier limit of 1 is exhausted.
        expect(isHttpError(await runGate(opts, freeReq()))).toBe(true);

        // Paid actor on the SAME route hits its own bucket and admits.
        const paidReq = {
            actor: { user: { id: 2, uuid: 'paid' } },
            headers: {},
        };
        expect(await runGate(opts, paidReq)).toBeUndefined();
    });

    it('falls back to the base `limit` when metering throws', async () => {
        configureRateLimit({
            metering: {
                getActorSubscription: async () => {
                    throw new Error('boom');
                },
            },
        });
        // bySubscription would 0 everyone out if it applied — base wins.
        const opts = {
            limit: 2,
            window: 60_000,
            bySubscription: { user_free: 0 },
            key: 'user',
            scope: 'rl-sub-fail',
        };
        const req = { actor: { user: { id: 1, uuid: 'free' } }, headers: {} };
        expect(await runGate(opts, req)).toBeUndefined();
        expect(await runGate(opts, req)).toBeUndefined();
    });

    it('does not consult metering when there is no actor (skips the lookup)', async () => {
        const meteringSpy = vi.fn();
        configureRateLimit({
            metering: { getActorSubscription: meteringSpy },
        });
        const opts = {
            limit: 1,
            window: 60_000,
            bySubscription: { user_free: 99 },
            key: 'ip',
            scope: 'rl-sub-anon',
        };
        const anonReq = { ip: '4.4.4.4', headers: {}, socket: {} };
        expect(await runGate(opts, anonReq)).toBeUndefined();
        expect(meteringSpy).not.toHaveBeenCalled();
    });
});

// ── Redis backend (ioredis-mock) ────────────────────────────────────

describe('rateLimitGate — redis backend', () => {
    let redis;
    beforeAll(() => {
        redis = new RedisMock();
        configureRateLimit({ default: 'redis', redis });
    });
    afterAll(async () => {
        await redis?.quit?.();
        configureRateLimit();
    });
    beforeEach(async () => {
        await redis.flushall();
    });

    it('admits up to `limit` and rejects further hits with 429', async () => {
        // Explicit backend selection — same instance must work regardless
        // of which one is wired as the default.
        const opts = {
            limit: 2,
            window: 60_000,
            key: 'ip',
            scope: 'redis-1',
            backend: 'redis',
        };
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
            default: 'redis',
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
        configureRateLimit({ default: 'redis', redis });
    });
});

// ── Per-route backend selection ─────────────────────────────────────

describe('rateLimitGate — per-route backend selection', () => {
    let redis;
    beforeAll(() => {
        redis = new RedisMock();
        // Both backends co-resident: routes pick whichever they want.
        configureRateLimit({ default: 'memory', redis });
    });
    afterAll(async () => {
        await redis?.quit?.();
        configureRateLimit();
    });

    it('routes pinned to different backends do not share state', async () => {
        // Same key, different backends → independent counters.
        const reqInit = {
            ip: '10.0.0.1',
            headers: {},
            socket: { remoteAddress: '10.0.0.1' },
        };
        const memOpts = {
            limit: 1,
            window: 60_000,
            key: 'ip',
            scope: 'cross-backend',
            backend: 'memory',
        };
        const redisOpts = { ...memOpts, backend: 'redis' };

        // Exhaust the memory bucket.
        let n = vi.fn();
        await rateLimitGate(memOpts)(reqInit, {}, n);
        expect(n.mock.calls[0][0]).toBeUndefined();
        n = vi.fn();
        await rateLimitGate(memOpts)(reqInit, {}, n);
        expect(isHttpError(n.mock.calls[0][0])).toBe(true);

        // Redis counter is untouched — first hit on that backend admits.
        n = vi.fn();
        await rateLimitGate(redisOpts)(reqInit, {}, n);
        expect(n.mock.calls[0][0]).toBeUndefined();
    });

    it('unknown backend names log a warning and fall through to the default', async () => {
        const warnSpy = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        const opts = {
            limit: 1,
            window: 60_000,
            key: 'ip',
            scope: 'unknown-bk',
            backend: 'nonsense',
        };
        const req = {
            ip: '10.0.0.2',
            headers: {},
            socket: { remoteAddress: '10.0.0.2' },
        };
        const next = vi.fn();
        await rateLimitGate(opts)(req, {}, next);
        // Behaviour-wise the default (memory here) admitted the request.
        expect(next.mock.calls[0][0]).toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

// ── Backend configuration ───────────────────────────────────────────

describe('configureRateLimit — backend selection', () => {
    it('throws when default=redis is set without a redis client', () => {
        expect(() => configureRateLimit({ default: 'redis' })).toThrow(
            /default backend 'redis' requires its dependency/,
        );
    });

    it('throws when default=kv is set without a kv store', () => {
        expect(() => configureRateLimit({ default: 'kv' })).toThrow(
            /default backend 'kv' requires its dependency/,
        );
    });

    it('throws on an unknown default backend name', () => {
        // The default selection is the only thing that has to be a
        // registered backend; unknown names at the per-call layer log and
        // fall through, but a misconfigured default must surface loudly.
        expect(() => configureRateLimit({ default: 'nonsense' })).toThrow(
            /default backend 'nonsense' requires its dependency/,
        );
    });

    it('registers memory unconditionally and uses it as the default when nothing else is wired', () => {
        // Mirrors boot-with-no-clients: memory is always available so
        // tests / dev never hit a missing-default state.
        expect(() => configureRateLimit()).not.toThrow();
    });
});

// ── checkDriverRateLimit ────────────────────────────────────────────

describe('checkDriverRateLimit', () => {
    beforeEach(() => {
        configureRateLimit();
    });

    const spec = (limit, window = 60_000, backend) => ({
        limit,
        window,
        ...(backend ? { backend } : {}),
    });

    it('returns true while under the limit and false once exceeded', async () => {
        const req = { actor: { user: { uuid: 'user-1' } } };
        for (let i = 0; i < 3; i++) {
            expect(
                await checkDriverRateLimit(req, 'kv', 'get', spec(3)),
            ).toBe(true);
        }
        expect(await checkDriverRateLimit(req, 'kv', 'get', spec(3))).toBe(
            false,
        );
    });

    it("scopes by user — one user's traffic doesn't rate-limit another", async () => {
        // Drives the limit for user-A to its max, then verifies user-B is
        // still admitted.
        const reqA = { actor: { user: { uuid: 'user-A' } } };
        const reqB = { actor: { user: { uuid: 'user-B' } } };
        for (let i = 0; i < 2; i++) {
            await checkDriverRateLimit(reqA, 'kv', 'get', spec(2));
        }
        expect(await checkDriverRateLimit(reqA, 'kv', 'get', spec(2))).toBe(
            false,
        );
        // User-B still has full quota.
        expect(await checkDriverRateLimit(reqB, 'kv', 'get', spec(2))).toBe(
            true,
        );
    });

    it('scopes by interface and method — independent buckets per (iface, method) pair', async () => {
        const req = { actor: { user: { uuid: 'user-scope' } } };
        await checkDriverRateLimit(req, 'kv', 'get', spec(1));
        // Same user + same iface + different method → fresh bucket.
        expect(await checkDriverRateLimit(req, 'kv', 'set', spec(1))).toBe(
            true,
        );
        // Same user + different iface + same method → fresh bucket too.
        expect(await checkDriverRateLimit(req, 'apps', 'get', spec(1))).toBe(
            true,
        );
    });

    it('falls back to a fingerprint key for unauthenticated callers', async () => {
        const req = {
            ip: '7.7.7.7',
            headers: { 'user-agent': 'curl/8' },
            socket: { remoteAddress: '7.7.7.7' },
        };
        // First call admits, second exceeds the limit of 1.
        expect(await checkDriverRateLimit(req, 'kv', 'get', spec(1))).toBe(
            true,
        );
        expect(await checkDriverRateLimit(req, 'kv', 'get', spec(1))).toBe(
            false,
        );
    });

    it('honours the backend field — counters on different backends are independent', async () => {
        // Two backends, same key. Exhausting one must not affect the
        // other — this is the whole point of per-call backend selection.
        const redis = new RedisMock();
        try {
            configureRateLimit({ default: 'memory', redis });
            const req = { actor: { user: { uuid: 'cross-bk' } } };
            const inMem = spec(1, 60_000, 'memory');
            const inRedis = spec(1, 60_000, 'redis');

            expect(await checkDriverRateLimit(req, 'kv', 'get', inMem)).toBe(
                true,
            );
            // Memory bucket full.
            expect(await checkDriverRateLimit(req, 'kv', 'get', inMem)).toBe(
                false,
            );
            // Redis bucket untouched.
            expect(await checkDriverRateLimit(req, 'kv', 'get', inRedis)).toBe(
                true,
            );
        } finally {
            await redis.quit?.();
        }
    });

    it('uses the loose 600/min default when the caller passes no spec', async () => {
        // Drivers without a declared rateLimit still get *some* protection.
        const req = { actor: { user: { uuid: 'fallback-user' } } };
        // Just confirm one call admits — exhausting 600 here is wasteful.
        expect(await checkDriverRateLimit(req, 'kv', 'get')).toBe(true);
    });

    it('applies bySubscription overrides via the wired metering service', async () => {
        configureRateLimit({
            metering: {
                getActorSubscription: async (actor) => ({
                    id: actor.user.uuid === 'free' ? 'user_free' : 'unlimited',
                }),
            },
        });
        const opts = {
            limit: 5,
            window: 60_000,
            bySubscription: { user_free: 1, unlimited: 50 },
        };
        const reqFree = { actor: { user: { uuid: 'free' } } };
        // Free is capped at 1 by the override.
        expect(await checkDriverRateLimit(reqFree, 'iface', 'm', opts)).toBe(
            true,
        );
        expect(await checkDriverRateLimit(reqFree, 'iface', 'm', opts)).toBe(
            false,
        );
        // Unlimited tier on the same bucket-key (same iface/method) but
        // different user gets its own counter — admits.
        const reqPaid = { actor: { user: { uuid: 'paid' } } };
        expect(await checkDriverRateLimit(reqPaid, 'iface', 'm', opts)).toBe(
            true,
        );
    });
});

// ── concurrencyGate ─────────────────────────────────────────────────

// Minimal res stand-in for the middleware: it only needs once('finish')
// / once('close') so the gate can register a release callback. We drive
// these events manually to simulate request completion.
const makeRes = () => {
    const ee = new EventEmitter();
    return {
        once: (ev, fn) => ee.once(ev, fn),
        // Fire from tests to release the slot.
        emit: (ev) => ee.emit(ev),
    };
};

describe('concurrencyGate — memory backend', () => {
    beforeEach(() => {
        configureRateLimit(); // memory default
    });

    const runGate = async (opts, req, res = makeRes()) => {
        const next = vi.fn();
        await concurrencyGate(opts)(req, res, next);
        return { next, res, err: next.mock.calls[0]?.[0] };
    };

    const baseReq = (init = {}) => ({
        ip: init.ip ?? '1.2.3.4',
        headers: init.headers ?? {},
        socket: init.socket ?? { remoteAddress: '1.2.3.4' },
        actor: init.actor,
        route: init.route,
    });

    it('admits up to `limit` in-flight requests and 429s the next one', async () => {
        const opts = { limit: 2, key: 'ip', scope: 'cg-basic' };
        // Two outstanding admits.
        const a = await runGate(opts, baseReq());
        const b = await runGate(opts, baseReq());
        expect(a.err).toBeUndefined();
        expect(b.err).toBeUndefined();
        // Third is rejected — slots still held.
        const c = await runGate(opts, baseReq());
        expect(isHttpError(c.err)).toBe(true);
        expect(c.err.statusCode).toBe(429);
    });

    it("releases a slot on res 'finish' so the next caller is admitted", async () => {
        const opts = { limit: 1, key: 'ip', scope: 'cg-release' };
        const first = await runGate(opts, baseReq());
        expect(first.err).toBeUndefined();
        // No slot free yet.
        const blocked = await runGate(opts, baseReq());
        expect(isHttpError(blocked.err)).toBe(true);
        // Complete the first request → slot freed.
        first.res.emit('finish');
        // release runs on the microtask queue (Promise.resolve().then(...)).
        await new Promise((r) => setImmediate(r));
        const reopened = await runGate(opts, baseReq());
        expect(reopened.err).toBeUndefined();
    });

    it("'close' fires when an aborted request never finishes — slot still released", async () => {
        // Hardening against the common bug where only 'finish' is hooked
        // and a client abort pins the slot forever.
        const opts = { limit: 1, key: 'ip', scope: 'cg-abort' };
        const first = await runGate(opts, baseReq());
        expect(first.err).toBeUndefined();
        first.res.emit('close');
        await new Promise((r) => setImmediate(r));
        const after = await runGate(opts, baseReq());
        expect(after.err).toBeUndefined();
    });

    it('release is idempotent — finish+close together still equal one release', async () => {
        const opts = { limit: 1, key: 'ip', scope: 'cg-idem' };
        const first = await runGate(opts, baseReq());
        first.res.emit('finish');
        first.res.emit('close');
        await new Promise((r) => setImmediate(r));

        // Acquire-release-acquire path: the second slot is free.
        const second = await runGate(opts, baseReq());
        expect(second.err).toBeUndefined();
        // …but if finish was being applied twice, this third caller
        // would be admitted too. Confirm it isn't.
        const third = await runGate(opts, baseReq());
        expect(isHttpError(third.err)).toBe(true);
    });

    it('different keys do not share slots', async () => {
        const opts = { limit: 1, key: 'ip', scope: 'cg-keyed' };
        const a = await runGate(opts, baseReq({ ip: '1.1.1.1' }));
        const b = await runGate(opts, baseReq({ ip: '2.2.2.2' }));
        expect(a.err).toBeUndefined();
        expect(b.err).toBeUndefined();
    });

    it('fails open if the backend throws on acquire — logs but admits', async () => {
        // Simulate by swapping in a fake redis that explodes, then
        // pointing the gate at it. Memory backend itself doesn't throw,
        // so use redis to exercise the failure path.
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        configureRateLimit({
            default: 'redis',
            redis: {
                multi: () => {
                    throw new Error('redis down');
                },
            },
        });
        const next = vi.fn();
        await concurrencyGate({ limit: 1, key: 'ip', backend: 'redis' })(
            baseReq(),
            makeRes(),
            next,
        );
        expect(next).toHaveBeenCalledWith();
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});

describe('concurrencyGate — redis backend', () => {
    let redis;
    beforeAll(() => {
        redis = new RedisMock();
        configureRateLimit({ default: 'redis', redis });
    });
    afterAll(async () => {
        await redis?.quit?.();
        configureRateLimit();
    });
    beforeEach(async () => {
        await redis.flushall();
    });

    it('uses INCR/EXPIRE to coordinate slots and releases on finish', async () => {
        const opts = {
            limit: 1,
            key: 'ip',
            scope: 'redis-cg',
            backend: 'redis',
        };
        const req = {
            ip: '4.5.6.7',
            headers: {},
            socket: { remoteAddress: '4.5.6.7' },
        };
        const next1 = vi.fn();
        const res1 = makeRes();
        await concurrencyGate(opts)(req, res1, next1);
        expect(next1.mock.calls[0][0]).toBeUndefined();

        // Slot still held — second caller is rejected.
        const next2 = vi.fn();
        await concurrencyGate(opts)(req, makeRes(), next2);
        expect(isHttpError(next2.mock.calls[0][0])).toBe(true);

        // Release the first slot and try again.
        res1.emit('finish');
        await new Promise((r) => setImmediate(r));
        const next3 = vi.fn();
        await concurrencyGate(opts)(req, makeRes(), next3);
        expect(next3.mock.calls[0][0]).toBeUndefined();
    });
});

// ── concurrency: subscription-based limits ──────────────────────────

describe('concurrencyGate — bySubscription overrides', () => {
    // Fake metering with deterministic policy resolution per actor.
    const makeMetering = (policiesByUuid) => ({
        getActorSubscription: async (actor) => {
            const id = policiesByUuid[actor.user.uuid];
            if (!id) throw new Error('no policy');
            return { id };
        },
    });

    beforeEach(() => {
        configureRateLimit({
            metering: makeMetering({
                'free-user': 'user_free',
                'paid-user': 'unlimited',
            }),
        });
    });

    it('uses the override matching the actor subscription', async () => {
        const opts = {
            limit: 5, // default
            bySubscription: { user_free: 1, unlimited: 10 },
            key: 'user',
            scope: 'cg-sub',
        };
        // Free user: limit 1.
        const a = await concurrencyGate(opts)(
            { actor: { user: { id: 1, uuid: 'free-user' } } },
            makeRes(),
            vi.fn(),
        );
        const blockedNext = vi.fn();
        await concurrencyGate(opts)(
            { actor: { user: { id: 1, uuid: 'free-user' } } },
            makeRes(),
            blockedNext,
        );
        expect(isHttpError(blockedNext.mock.calls[0][0])).toBe(true);
        void a;

        // Paid user (same scope, different bucket via 'user' key): admits.
        const paidNext = vi.fn();
        await concurrencyGate(opts)(
            { actor: { user: { id: 2, uuid: 'paid-user' } } },
            makeRes(),
            paidNext,
        );
        expect(paidNext.mock.calls[0][0]).toBeUndefined();
    });

    it('falls back to the base limit when metering throws', async () => {
        configureRateLimit({
            metering: {
                getActorSubscription: async () => {
                    throw new Error('boom');
                },
            },
        });
        const opts = {
            limit: 2,
            bySubscription: { user_free: 0 }, // would reject everyone if applied
            key: 'user',
            scope: 'cg-sub-fail',
        };
        const next = vi.fn();
        await concurrencyGate(opts)(
            { actor: { user: { id: 1, uuid: 'free-user' } } },
            makeRes(),
            next,
        );
        // Base of 2 admits; the per-sub 0 must NOT have applied.
        expect(next.mock.calls[0][0]).toBeUndefined();
    });

    it('skips the lookup entirely when no actor is present', async () => {
        // Anonymous routes get the base limit — no metering call attempted.
        const meteringSpy = vi.fn();
        configureRateLimit({
            metering: { getActorSubscription: meteringSpy },
        });
        const opts = {
            limit: 2,
            bySubscription: { user_free: 0 },
            key: 'ip',
            scope: 'cg-anon',
        };
        const next = vi.fn();
        await concurrencyGate(opts)(
            { ip: '9.9.9.9', headers: {}, socket: {} },
            makeRes(),
            next,
        );
        expect(next.mock.calls[0][0]).toBeUndefined();
        expect(meteringSpy).not.toHaveBeenCalled();
    });
});

// ── acquireDriverConcurrent ─────────────────────────────────────────

describe('acquireDriverConcurrent', () => {
    beforeEach(() => {
        configureRateLimit();
    });

    it('returns an always-ok handle with a noop release when no spec is declared', async () => {
        // Drivers that declare nothing stay unbounded — same as before
        // this feature was introduced.
        const req = { actor: { user: { uuid: 'u' } } };
        const handle = await acquireDriverConcurrent(req, 'iface', 'm', undefined);
        expect(handle.ok).toBe(true);
        // Must be callable without throwing.
        await handle.release();
    });

    it('enforces the limit and returns ok:false past it', async () => {
        const req = { actor: { user: { uuid: 'u' } } };
        const opts = { limit: 1 };
        const h1 = await acquireDriverConcurrent(req, 'iface', 'm', opts);
        expect(h1.ok).toBe(true);
        const h2 = await acquireDriverConcurrent(req, 'iface', 'm', opts);
        expect(h2.ok).toBe(false);
        await h1.release();
        const h3 = await acquireDriverConcurrent(req, 'iface', 'm', opts);
        expect(h3.ok).toBe(true);
    });

    it('scopes by user — exhausting one user does not block another', async () => {
        const opts = { limit: 1 };
        const reqA = { actor: { user: { uuid: 'A' } } };
        const reqB = { actor: { user: { uuid: 'B' } } };
        const hA = await acquireDriverConcurrent(reqA, 'iface', 'm', opts);
        const hB = await acquireDriverConcurrent(reqB, 'iface', 'm', opts);
        expect(hA.ok).toBe(true);
        expect(hB.ok).toBe(true);
    });

    it('applies bySubscription overrides via the wired metering service', async () => {
        configureRateLimit({
            metering: {
                getActorSubscription: async (actor) => ({
                    id: actor.user.uuid === 'free' ? 'user_free' : 'unlimited',
                }),
            },
        });
        const opts = {
            limit: 5,
            bySubscription: { user_free: 1, unlimited: 10 },
        };
        const reqFree = { actor: { user: { uuid: 'free' } } };
        const h1 = await acquireDriverConcurrent(reqFree, 'iface', 'm', opts);
        const h2 = await acquireDriverConcurrent(reqFree, 'iface', 'm', opts);
        expect(h1.ok).toBe(true);
        expect(h2.ok).toBe(false); // free is capped at 1
    });
});
