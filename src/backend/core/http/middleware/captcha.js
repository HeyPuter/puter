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
import svgCaptcha from 'svg-captcha';
/**
 * Simple SVG captcha service — generates image challenges and verifies
 * one-time tokens. Tokens are stored in Redis so generation and verification
 * can happen on different server nodes.
 *
 * Exposed as a route option: `{ captcha: true }` on any route.
 * The middleware rejects if captcha is enabled and the request
 * doesn't carry valid captchaToken + captchaAnswer fields.
 *
 * When captcha is disabled in config, the middleware is a no-op.
 */

const EXPIRATION_MS = 10 * 60_000; // 10 minutes
const DIFFICULTY = {
    easy: { size: 4, width: 150, height: 50, noise: 1 },
    medium: { size: 6, width: 180, height: 50, noise: 2 },
    hard: { size: 7, width: 200, height: 60, noise: 3 },
};

let redisClient = null;

/** Call once during server boot with `clients.redis`. */
export function setCaptchaRedis(redis) {
    redisClient = redis;
}

const keyFor = (token) => `captcha:${token}`;

function requireRedis() {
    if (!redisClient) throw new Error('captcha: redis client not configured');
    return redisClient;
}

function readTransactionValue(result) {
    if (!Array.isArray(result)) return result;
    if (result[0]) throw result[0];
    return result[1];
}

// ── Public API ──────────────────────────────────────────────────────

/** Generate a captcha image + token pair. */
export async function generateCaptcha(difficulty = 'medium') {
    if (!svgCaptcha) throw new Error('svg-captcha not available');
    const redis = requireRedis();
    const opts = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    const captcha = svgCaptcha.create({
        ...opts,
        ignoreChars: '0o1ilI',
        color: true,
        background: '#f0f0f0',
    });
    const token = crypto.randomBytes(32).toString('hex');
    await redis.set(
        keyFor(token),
        captcha.text.toLowerCase(),
        'PX',
        EXPIRATION_MS,
    );
    return { token, image: captcha.data };
}

/** Verify a captcha answer. One-time use — token is consumed. */
export async function verifyCaptcha(token, answer) {
    if (typeof token !== 'string' || typeof answer !== 'string') return false;
    const redis = requireRedis();
    const results = await redis
        .multi()
        .get(keyFor(token))
        .del(keyFor(token))
        .exec();
    const text = readTransactionValue(results?.[0]);
    if (!text) return false;
    return text === answer.toLowerCase().trim();
}

// ── Route middleware ────────────────────────────────────────────────

/**
 * Captcha gate middleware factory.
 *
 * Reads `captchaToken` and `captchaAnswer` from `req.body`.
 * Rejects with 400 if missing or invalid.
 *
 * Pass `enabled` from config — when false, the gate is a no-op.
 */
export function captchaGate(enabled) {
    return async (req, _res, next) => {
        if (!enabled) return next();

        try {
            const { captchaToken, captchaAnswer } = req.body ?? {};
            if (!captchaToken || !captchaAnswer) {
                return next(
                    new HttpError(400, 'Captcha verification required.', {
                        legacyCode: 'bad_request',
                    }),
                );
            }
            if (!(await verifyCaptcha(captchaToken, captchaAnswer))) {
                return next(
                    new HttpError(400, 'Invalid captcha response.', {
                        legacyCode: 'bad_request',
                    }),
                );
            }
            next();
        } catch (err) {
            next(err);
        }
    };
}
