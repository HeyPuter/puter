/*
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
const eggspress = require('../../api/eggspress');
const config = require('../../config');
const { subdomain } = require('../../helpers');
const BaseService = require('../BaseService');
const { redisClient } = require('../../clients/redis/redisSingleton');

const REDIS_KEY_PREFIX = 'anticsrf:';
const MAX_TOKENS_PER_SESSION = 10;
const TOKEN_TTL_SECONDS = 60 * 60;
// Sub-millisecond tie-breaker so rapid-fire create_token calls get strictly
// increasing ZSET scores instead of falling back to lexical token ordering.
const SCORE_TIEBREAKER_MOD = 1000;

/**
* Class AntiCSRFService extends BaseService to manage and protect against Cross-Site Request Forgery (CSRF) attacks.
* Tokens are stored in Redis as a per-session sorted set (score = creation timestamp)
* so state is shared across backend instances. Only the most recent
* MAX_TOKENS_PER_SESSION tokens are retained; keys expire after TOKEN_TTL_SECONDS.
*/
class AntiCSRFService extends BaseService {
    _construct () {
        this.score_tiebreaker_ = 0;
    }

    /**
     * Sets up the route handler for getting anti-CSRF tokens.
     * Registers the '/get-anticsrf-token' endpoint that returns a new token for authenticated users.
     *
     * @returns {void}
     */
    '__on_install.routes' () {
        const { app } = this.services.get('web-server');

        app.use(eggspress('/get-anticsrf-token', {
            auth2: true,
            allowedMethods: ['GET'],
        }, async (req, res) => {
            // We disallow `api.` because it has a more relaxed CORS policy
            const subdomain_check = config.experimental_no_subdomain ||
                (subdomain(req) !== 'api');
            if ( ! subdomain_check ) {
                return res.status(404).send('Hey, stop that!');
            }

            if ( ! req.user ) {
                res.status(403).send({});
                return;
            }

            // TODO: session uuid instead of user
            const token = await this.create_token(req.user.uuid);
            res.send({ token });
        }));
    }

    /**
     * Creates a new anti-CSRF token for the specified session and stores it in Redis.
     * Only the most recent MAX_TOKENS_PER_SESSION tokens are retained per session.
     *
     * @param {string} session - The session identifier
     * @returns {Promise<string>} The newly created token
     */
    async create_token (session) {
        const token = this.generate_token_();
        const key = this.redis_key_(session);
        this.score_tiebreaker_ = (this.score_tiebreaker_ + 1) % SCORE_TIEBREAKER_MOD;
        const score = Date.now() * SCORE_TIEBREAKER_MOD + this.score_tiebreaker_;
        const pipeline = redisClient.pipeline();
        pipeline.zadd(key, score, token);
        pipeline.zremrangebyrank(key, 0, -(MAX_TOKENS_PER_SESSION + 1));
        pipeline.expire(key, TOKEN_TTL_SECONDS);
        await pipeline.exec();
        return token;
    }

    /**
     * Attempts to consume (validate and remove) a token for the specified session.
     * Uses an atomic ZREM so concurrent consumers can't double-spend a token.
     *
     * @param {string} session - The session identifier
     * @param {string} token - The token to consume
     * @returns {Promise<boolean>} True if the token was valid and consumed, false otherwise
     */
    async consume_token (session, token) {
        if ( ! token ) return false;
        const removed = await redisClient.zrem(this.redis_key_(session), token);
        return removed > 0;
    }

    redis_key_ (session) {
        return `${REDIS_KEY_PREFIX}${session}`;
    }

    /**
     * Generates a secure random token as a hexadecimal string.
     * The token is created using cryptographic random bytes to ensure uniqueness
     * and security for Anti-CSRF purposes.
     *
     * @returns {string} The generated token.
     */
    generate_token_ () {
        return require('crypto').randomBytes(32).toString('hex');
    }

}

module.exports = {
    AntiCSRFService,
};
