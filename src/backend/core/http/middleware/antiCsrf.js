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
 * Anti-CSRF token manager (Redis-backed).
 *
 * One key per token: `csrf:<sessionId>:<token>` with TTL. Consume is
 * DEL — returns 1 if it existed (and we just consumed it), 0 otherwise.
 * Atomic across a cluster, no MULTI needed since each op touches a
 * single key.
 *
 * Tokens expire after `TOKEN_TTL_MS` whether consumed or not.
 */

const TOKEN_TTL_MS = 10 * 60_000; // 10 minutes

let redisClient = null;

/** Call once during server boot with `clients.redis`. */
export function setAntiCsrfRedis(redis) {
    redisClient = redis;
}

const keyFor = (sessionId, token) => `csrf:${sessionId}:${token}`;

export const antiCsrf = {
    async createToken(sessionId) {
        if (!redisClient)
            throw new Error('anti-csrf: redis client not configured');
        const token = crypto.randomBytes(32).toString('hex');
        await redisClient.set(
            keyFor(sessionId, token),
            '1',
            'PX',
            TOKEN_TTL_MS,
        );
        return token;
    },
    async consumeToken(sessionId, token) {
        if (!token || !sessionId) return false;
        if (!redisClient)
            throw new Error('anti-csrf: redis client not configured');
        const removed = await redisClient.del(keyFor(sessionId, token));
        return Number(removed) === 1;
    },
};

// ── Route middleware ────────────────────────────────────────────────

/**
 * Middleware that requires a valid anti-CSRF token in `req.body.anti_csrf`.
 * The session key is `req.actor.user.uuid`.
 */
export function requireAntiCsrf() {
    return async (req, _res, next) => {
        try {
            const sessionId = req.actor?.user?.uuid;
            if (!sessionId) {
                return next(
                    new HttpError(
                        401,
                        'Authentication required for CSRF protection.',
                    ),
                );
            }
            if (
                !(await antiCsrf.consumeToken(sessionId, req.body?.anti_csrf))
            ) {
                return next(new HttpError(400, 'Incorrect anti-CSRF token.'));
            }
            next();
        } catch (err) {
            next(err);
        }
    };
}
