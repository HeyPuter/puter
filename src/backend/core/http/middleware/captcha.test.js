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
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { isHttpError } from '../HttpError.js';
import {
    captchaGate,
    generateCaptcha,
    setCaptchaRedis,
    verifyCaptcha,
} from './captcha.js';

let redis;

beforeAll(() => {
    redis = new RedisMock();
    setCaptchaRedis(redis);
});

afterAll(async () => {
    await redis?.quit?.();
});

beforeEach(async () => {
    await redis.flushall();
});

// ── Helper: peek at the stored answer to verify deterministically ───
//
// The SVG-captcha library outputs a random string; we can't predict it,
// but we CAN read what it stored in Redis under the same token. That
// makes the verify tests deterministic without mocking svg-captcha.

const peekAnswer = async (token) => redis.get(`captcha:${token}`);

// ── generateCaptcha ─────────────────────────────────────────────────

describe('generateCaptcha', () => {
    it('returns a {token, image} pair and persists the lowercased answer in Redis', async () => {
        const { token, image } = await generateCaptcha();
        expect(token).toMatch(/^[0-9a-f]{64}$/);
        // image is an SVG payload — the library returns the raw markup.
        expect(typeof image).toBe('string');
        expect(image).toContain('<svg');

        const stored = await peekAnswer(token);
        expect(stored).not.toBeNull();
        // Stored value must be already-lowercased — verifyCaptcha lower-cases
        // the answer before comparing, so the stored side has to match.
        expect(stored).toBe(stored.toLowerCase());
    });

    it('accepts difficulty levels and falls back to medium for unknowns', async () => {
        // The implementation tolerates an unknown difficulty by defaulting
        // to `medium`. Worth pinning so a misspelling in config doesn't 500.
        for (const diff of ['easy', 'medium', 'hard', 'nonsense']) {
            const { token } = await generateCaptcha(diff);
            expect(token).toMatch(/^[0-9a-f]{64}$/);
        }
    });

    it('issues a fresh token on every call', async () => {
        const a = (await generateCaptcha()).token;
        const b = (await generateCaptcha()).token;
        expect(a).not.toBe(b);
    });

    it('throws when redis was never configured', async () => {
        setCaptchaRedis(null);
        await expect(generateCaptcha()).rejects.toThrow(
            /redis client not configured/,
        );
        setCaptchaRedis(redis);
    });
});

// ── verifyCaptcha ───────────────────────────────────────────────────

describe('verifyCaptcha', () => {
    it('accepts the correct answer once and rejects the replay', async () => {
        const { token } = await generateCaptcha();
        const answer = await peekAnswer(token);

        expect(await verifyCaptcha(token, answer)).toBe(true);
        // After verify the token is consumed — replays must fail.
        expect(await verifyCaptcha(token, answer)).toBe(false);
    });

    it('answer match is case-insensitive and ignores surrounding whitespace', async () => {
        const { token } = await generateCaptcha();
        const stored = await peekAnswer(token);
        // The implementation lower-cases + trims the submitted answer.
        const upperCased = `  ${stored.toUpperCase()}  `;
        expect(await verifyCaptcha(token, upperCased)).toBe(true);
    });

    it('rejects a wrong answer (and consumes the token)', async () => {
        // Important: the implementation consumes the token whether or not
        // the answer matched (multi/exec runs get + del). A wrong guess
        // burns the token, forcing a re-issue.
        const { token } = await generateCaptcha();
        expect(await verifyCaptcha(token, 'definitely-not-it')).toBe(false);
        // Subsequent verify against the correct answer would still fail
        // because the row was deleted.
        const stored = await peekAnswer(token);
        expect(stored).toBeNull();
    });

    it('rejects unknown tokens', async () => {
        expect(await verifyCaptcha('never-issued', 'something')).toBe(false);
    });

    it('rejects non-string arguments without throwing', async () => {
        expect(await verifyCaptcha(null, 'x')).toBe(false);
        expect(await verifyCaptcha('x', null)).toBe(false);
        expect(await verifyCaptcha(123, 456)).toBe(false);
    });
});

// ── captchaGate middleware ──────────────────────────────────────────

describe('captchaGate middleware', () => {
    const runGate = async (enabled, body) => {
        const next = vi.fn();
        await captchaGate(enabled)({ body }, {}, next);
        expect(next).toHaveBeenCalledTimes(1);
        return next.mock.calls[0][0];
    };

    it('is a no-op when captcha is disabled in config', async () => {
        // Critical for self-hosted deployments that have captcha off —
        // they shouldn't have to send the fields at all.
        const arg = await runGate(false, {});
        expect(arg).toBeUndefined();
    });

    it('rejects with 400 when fields are missing', async () => {
        const arg = await runGate(true, {});
        expect(isHttpError(arg)).toBe(true);
        expect(arg.statusCode).toBe(400);
        expect(arg.legacyCode).toBe('bad_request');
    });

    it('rejects with 400 when the answer is wrong', async () => {
        const { token } = await generateCaptcha();
        const arg = await runGate(true, {
            captchaToken: token,
            captchaAnswer: 'definitely-not-it',
        });
        expect(isHttpError(arg)).toBe(true);
        expect(arg.statusCode).toBe(400);
    });

    it('passes through on a correct answer (one-shot — replay fails)', async () => {
        const { token } = await generateCaptcha();
        const answer = await peekAnswer(token);
        expect(
            await runGate(true, {
                captchaToken: token,
                captchaAnswer: answer,
            }),
        ).toBeUndefined();
        // Replay rejected — verifyCaptcha already consumed the token.
        const replay = await runGate(true, {
            captchaToken: token,
            captchaAnswer: answer,
        });
        expect(isHttpError(replay)).toBe(true);
    });

    it('tolerates a missing body (treats as missing fields)', async () => {
        // Some controllers may run before body parsing, or accept no body.
        // The gate must reject gracefully, not throw on req.body destructuring.
        const next = vi.fn();
        await captchaGate(true)({}, {}, next);
        expect(next).toHaveBeenCalledTimes(1);
        const arg = next.mock.calls[0][0];
        expect(isHttpError(arg)).toBe(true);
        expect(arg.statusCode).toBe(400);
    });
});
