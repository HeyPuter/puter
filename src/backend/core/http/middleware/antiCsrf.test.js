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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '../HttpError.js';
import {
    antiCsrf,
    requireAntiCsrf,
    setAntiCsrfRedis,
} from './antiCsrf.js';

// ── Shared Redis mock ───────────────────────────────────────────────
//
// The module keeps a single module-level `redisClient` binding (the
// production wiring happens once at server boot in server.ts). We use
// ioredis-mock so del/set are real Redis semantics — no method mocks.

let redis;

beforeAll(() => {
    redis = new RedisMock();
    setAntiCsrfRedis(redis);
});

afterAll(async () => {
    await redis?.quit?.();
});

beforeEach(async () => {
    // Each test should start with a clean key-space so token lookups
    // don't leak across tests.
    await redis.flushall();
});

// ── Token API: createToken / consumeToken ───────────────────────────

describe('antiCsrf token API', () => {
    it('createToken returns a hex string that consumeToken accepts exactly once', async () => {
        const sessionId = 'sess-1';
        const token = await antiCsrf.createToken(sessionId);
        // 32 random bytes → 64 hex chars
        expect(token).toMatch(/^[0-9a-f]{64}$/);

        // First consume succeeds, second fails — single-use is the whole point.
        expect(await antiCsrf.consumeToken(sessionId, token)).toBe(true);
        expect(await antiCsrf.consumeToken(sessionId, token)).toBe(false);
    });

    it('tokens are scoped to the session that created them', async () => {
        // A token issued for session A must not be redeemable as session B.
        // Otherwise a leaked CSRF token could be used against any active user.
        const token = await antiCsrf.createToken('sess-A');
        expect(await antiCsrf.consumeToken('sess-B', token)).toBe(false);
        // Still consumable by the correct session.
        expect(await antiCsrf.consumeToken('sess-A', token)).toBe(true);
    });

    it('returns false (no throw) for missing/empty inputs', async () => {
        expect(await antiCsrf.consumeToken('', 'tok')).toBe(false);
        expect(await antiCsrf.consumeToken('sess', '')).toBe(false);
        expect(await antiCsrf.consumeToken('sess', null)).toBe(false);
        expect(await antiCsrf.consumeToken(null, null)).toBe(false);
    });

    it('issues distinct tokens on every call (high entropy — never repeats)', async () => {
        const seen = new Set();
        for (let i = 0; i < 10; i++) {
            const t = await antiCsrf.createToken('sess-1');
            expect(seen.has(t)).toBe(false);
            seen.add(t);
        }
    });

    it('throws when redis was never configured', async () => {
        setAntiCsrfRedis(null);
        await expect(antiCsrf.createToken('sess-1')).rejects.toThrow(
            /redis client not configured/,
        );
        // Restore for the rest of the suite.
        setAntiCsrfRedis(redis);
    });
});

// ── Middleware: requireAntiCsrf ─────────────────────────────────────

describe('requireAntiCsrf middleware', () => {
    const runMiddleware = async (req) => {
        const next = vi.fn();
        await requireAntiCsrf()(req, {}, next);
        expect(next).toHaveBeenCalledTimes(1);
        return next.mock.calls[0][0];
    };

    it('passes through when the body carries a valid token for the actor', async () => {
        const sessionId = 'user-uuid-1';
        const token = await antiCsrf.createToken(sessionId);
        const arg = await runMiddleware({
            actor: { user: { uuid: sessionId } },
            body: { anti_csrf: token },
        });
        expect(arg).toBeUndefined();
    });

    it('returns 401 unauthorized when no actor is attached', async () => {
        const arg = await runMiddleware({ body: { anti_csrf: 'whatever' } });
        expect(isHttpError(arg)).toBe(true);
        expect(arg.statusCode).toBe(401);
        expect(arg.legacyCode).toBe('unauthorized');
    });

    it('returns 400 bad_request when the body has no anti_csrf field', async () => {
        const arg = await runMiddleware({
            actor: { user: { uuid: 'user-uuid-1' } },
            body: {},
        });
        expect(isHttpError(arg)).toBe(true);
        expect(arg.statusCode).toBe(400);
        expect(arg.legacyCode).toBe('bad_request');
    });

    it('returns 400 when the token belongs to a different session', async () => {
        const someoneElsesToken = await antiCsrf.createToken('other-user');
        const arg = await runMiddleware({
            actor: { user: { uuid: 'user-uuid-1' } },
            body: { anti_csrf: someoneElsesToken },
        });
        expect(isHttpError(arg)).toBe(true);
        expect(arg.statusCode).toBe(400);
    });

    it("rejects when the same token is replayed (consume is single-use)", async () => {
        const sessionId = 'user-uuid-1';
        const token = await antiCsrf.createToken(sessionId);
        // First request succeeds.
        expect(
            await runMiddleware({
                actor: { user: { uuid: sessionId } },
                body: { anti_csrf: token },
            }),
        ).toBeUndefined();
        // Replay must fail — otherwise CSRF protection is meaningless.
        const replay = await runMiddleware({
            actor: { user: { uuid: sessionId } },
            body: { anti_csrf: token },
        });
        expect(isHttpError(replay)).toBe(true);
        expect(replay.statusCode).toBe(400);
    });

    it('forwards unexpected backend errors to next() (does not swallow)', async () => {
        // Swap in a redis client that throws — simulate cluster outage.
        setAntiCsrfRedis({
            del: () => {
                throw new Error('redis down');
            },
        });
        const arg = await runMiddleware({
            actor: { user: { uuid: 'u' } },
            body: { anti_csrf: 'x' },
        });
        expect(arg).toBeInstanceOf(Error);
        expect(arg.message).toBe('redis down');
        // Restore for any later tests.
        setAntiCsrfRedis(redis);
    });
});
