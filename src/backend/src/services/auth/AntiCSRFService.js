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
const { CircularQueue } = require('../../util/CircularQueue');

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

    /**
     * Sets up the route handler for getting anti-CSRF tokens.
     * Registers the '/get-anticsrf-token' endpoint that returns a new token for authenticated users.
     *
     * @returns {void}
     */
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

            if ( ! req.user ) {
                res.status(403).send({});
                return;
            }

            // TODO: session uuid instead of user
            const token = this.create_token(req.user.uuid);
            res.send({ token });
        }));
    }

    /**
     * Creates a new anti-CSRF token for the specified session.
     * If no token queue exists for the session, a new one is created.
     *
     * @param {string} session - The session identifier
     * @returns {string} The newly created token
     */
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

    /**
     * Attempts to consume (validate and remove) a token for the specified session.
     *
     * @param {string} session - The session identifier
     * @param {string} token - The token to consume
     * @returns {boolean} True if the token was valid and consumed, false otherwise
     */
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

}

module.exports = {
    AntiCSRFService,
};
