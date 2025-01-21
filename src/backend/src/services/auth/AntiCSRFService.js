// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const eggspress = require("../../api/eggspress");
const config = require("../../config");
const { subdomain } = require("../../helpers");
const BaseService = require("../BaseService");


/**
 * A utility class used by AntiCSRFService to manage a circular queue of
 * CSRF tokens (or, as we like to call them, "anti-CSRF" tokens).
 *
 * A token expires when it is evicted from the queue.
 */
class CircularQueue {
    constructor (size) {
        this.size = size;
        this.queue = [];
        this.index = 0;
        this.map = new Map();
    }

    push (item) {
        if ( this.queue[this.index] ) {
            this.map.delete(this.queue[this.index]);
        }
        this.queue[this.index] = item;
        this.map.set(item, this.index);
        this.index = (this.index + 1) % this.size;
    }

    get (index) {
        return this.queue[(this.index + index) % this.size];
    }

    has (item) {
        return this.map.has(item);
    }

    maybe_consume (item) {
        if ( this.has(item) ) {
            const index = this.map.get(item);
            this.map.delete(item);
            this.queue[index] = null;
            return true;
        }
        return false;
    }
}


/**
* Class AntiCSRFService extends BaseService to manage and protect against Cross-Site Request Forgery (CSRF) attacks.
* It provides methods for generating, consuming, and verifying anti-CSRF tokens based on user sessions.
*/
class AntiCSRFService extends BaseService {
    /**
     * Initializes the AntiCSRFService instance and sets up the mapping
     * between session IDs and their associated tokens.
     * 
     * @returns {void}
     */
    _construct () {
        this.map_session_to_tokens = {};
    }

    ['__on_install.routes'] () {
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

            // TODO: session uuid instead of user
            const token = this.create_token(req.user.uuid);
            res.send({ token });
        }));
    }

    create_token (session) {
        let tokens = this.map_session_to_tokens[session];
        if ( ! tokens ) {
            tokens = new CircularQueue(10);
            this.map_session_to_tokens[session] = tokens;
        }
        const token = this.generate_token_();
        tokens.push(token);
        return token;
    }

    consume_token (session, token) {
        const tokens = this.map_session_to_tokens[session];
        if ( ! tokens ) return false;
        return tokens.maybe_consume(token);
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

    _test ({ assert }) {
        // Do this several times, like a user would
        for ( let i=0 ; i < 30 ; i++ ) {
            // Generate 30 tokens
            const tokens = [];
            for ( let j=0 ; j < 30 ; j++ ) {
                tokens.push(this.create_token('session'));
            }
            // Only the last 10 should be valid
            const results_for_stale_tokens = [];
            for ( let j=0 ; j < 20 ; j++ ) {
                const result = this.consume_token('session', tokens[j]);
                results_for_stale_tokens.push(result);
            }
            assert(() => results_for_stale_tokens.every(v => v === false));
            // The last 10 should be valid
            const results_for_valid_tokens = [];
            for ( let j=20 ; j < 30 ; j++ ) {
                const result = this.consume_token('session', tokens[j]);
                results_for_valid_tokens.push(result);
            }
            assert(() => results_for_valid_tokens.every(v => v === true));
            // A completely arbitrary token should not be valid
            assert(() => this.consume_token('session', 'arbitrary') === false);
        }
    }
}

module.exports = {
    AntiCSRFService,
};
