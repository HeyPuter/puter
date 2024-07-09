/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { Context } = require("../../util/context");
const { asyncSafeSetInterval } = require("../../util/promise");
const { quot } = require("../../util/strutil");

const { MINUTE, HOUR } = require('../../util/time.js');
const BaseService = require("../BaseService");

/* INCREMENTAL CHANGES
    The first scopes are of the form 'name-of-endpoint', but later it was
    decided that they're of the form `/path/to/endpoint`. New scopes should
    follow the latter form.
*/

class EdgeRateLimitService extends BaseService {
    _construct () {
        this.scopes = {
            ['login']: {
                limit: 10,
                window: 15 * MINUTE,
            },
            ['signup']: {
                limit: 10,
                window: 15 * MINUTE,
            },
            ['contact-us']: {
                limit: 10,
                window: 15 * MINUTE,
            },
            ['send-confirm-email']: {
                limit: 10,
                window: HOUR,
            },
            ['confirm-email']: {
                limit: 10,
                window: HOUR,
            },
            ['send-pass-recovery-email']: {
                limit: 10,
                window: HOUR,
            },
            ['verify-pass-recovery-token']: {
                limit: 10,
                window: 15 * MINUTE,
            },
            ['set-pass-using-token']: {
                limit: 10,
                window: HOUR,
            },
            ['save-account']: {
                limit: 10,
                window: HOUR,
            },
            ['change-email-start']: {
                limit: 10,
                window: HOUR,
            },
            ['change-email-confirm']: {
                limit: 10,
                window: HOUR,
            },
            ['passwd']: {
                limit: 10,
                window: HOUR,
            },
            ['/user-protected/change-password']: {
                limit: 10,
                window: HOUR,
            },
            ['/user-protected/change-email']: {
                limit: 10,
                window: HOUR,
            },
            ['/user-protected/disable-2fa']: {
                limit: 10,
                window: HOUR,
            },
            ['login-otp']: {
                limit: 15,
                window: 30 * MINUTE,
            },
            ['login-recovery']: {
                limit: 10,
                window: HOUR,
            },
            ['enable-2fa']: {
                limit: 10,
                window: HOUR,
            }
            
        };
        this.requests = new Map();
    }

    async _init () {
        asyncSafeSetInterval(() => this.cleanup(), 5 * MINUTE);
    }

    check (scope) {
        if ( ! this.scopes.hasOwnProperty(scope) ) {
            throw new Error(`unrecognized rate-limit scope: ${quot(scope)}`)
        }
        const { window, limit } = this.scopes[scope];

        const requester = Context.get('requester');
        const rl_identifier = requester.rl_identifier;
        const key = `${scope}:${rl_identifier}`;
        const now = Date.now();
        const windowStart = now - window;

        if (!this.requests.has(key)) {
            this.requests.set(key, []);
        }

        // Access the timestamps of past requests for this scope and IP
        const timestamps = this.requests.get(key);

        // Remove timestamps that are outside the current window
        while (timestamps.length > 0 && timestamps[0] < windowStart) {
            timestamps.shift();
        }

        // Check if the current request exceeds the rate limit
        if (timestamps.length >= limit) {
            return false;
        } else {
            // Add current timestamp and allow the request
            timestamps.push(now);
            return true;
        }
    }

    cleanup() {
        this.log.tick('edge rate-limit cleanup task');
        for (const [key, timestamps] of this.requests.entries()) {
            if (timestamps.length === 0) {
                this.requests.delete(key);
            }
        }
    }
}

module.exports = { EdgeRateLimitService };
