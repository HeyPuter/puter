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
import { asyncSafeSetInterval, TeePromise } from '@heyputer/putility/src/libs/promise.js';
import { BaseService } from '../../../services/BaseService.js';
import { kv } from '../../../util/kvSingleton.js';
import { ServerHealthRedisCacheKeys } from './ServerHealthRedisCacheKeys.js';

const SECOND = 1000;

/**
* The ServerHealthService class provides comprehensive health monitoring for the server.
* It extends the BaseService class to include functionality for:
* - Periodic system checks (e.g., RAM usage, service checks)
* - Managing health check results and failures
* - Triggering alarms for critical conditions
* - Logging and managing statistics for health metrics
*
* This service is designed to work primarily on Linux systems, reading system metrics
* from `/proc/meminfo` and handling alarms via an external 'alarm' service.
*/
export class ServerHealthService extends BaseService {

    #checks = [];
    #failures = [];
    #stats = {};

    async _init () {
        this.#initServiceChecks();
    }

    /**
    * Initializes service health checks by setting up periodic checks.
    * This method configures an interval-based execution of health checks,
    * handles timeouts, and manages failure states.
    *
    * @param {none} - This method does not take any parameters.
    * @returns {void} - This method does not return any value.
    */
    #initServiceChecks () {
        const svc_alarm = this.services.get('alarm');
        asyncSafeSetInterval(async () => {
            const check_failures = [];
            for ( const { name, fn, chainable } of this.#checks ) {
                const p_timeout = new TeePromise();
                const timeout = setTimeout(() => {
                    p_timeout.reject(new Error('Health check timed out'));
                }, 5 * SECOND);

                try {
                    await Promise.race([
                        fn(),
                        p_timeout,
                    ]);
                } catch ( err ) {
                    // Trigger an alarm if this check isn't already in the failure list

                    if ( this.#failures.some(v => v.name === name) ) {
                        continue;
                    }

                    svc_alarm.create(
                        'health-check-failure',
                        `Health check ${name} failed`,
                        { error: err },
                    );
                    check_failures.push({ name });

                    console.error(`Error for healthcheck fail on ${name}: ${ err.stack}`);

                    // Run the on_fail handlers
                    for ( const fn of chainable.on_fail_ ) {
                        try {
                            await fn(err);
                        } catch ( e ) {
                            console.error(`Error in on_fail handler for ${name}`, e);
                        }
                    }
                } finally {
                    clearTimeout(timeout);
                }
            }

            this.#failures = check_failures;
        }, 10 * SECOND, null, {
            onBehindSchedule: (drift) => {
                svc_alarm.create(
                    'health-checks-behind-schedule',
                    'Health checks are behind schedule',
                    { drift },
                );
            },
        });
    }

    /**
    * Retrieves the current server health statistics.
    *
    * @returns {Object} An object containing the current health statistics.
    * This method returns a shallow copy of the internal `stats_` object to prevent
    * direct manipulation of the service's data.
    */
    async get_stats () {
        return { ...this.#stats };
    }

    add_check (name, fn) {
        const chainable = {
            on_fail_: [],
            on_fail: (fn) => {
                chainable.on_fail_.push(fn);
                return chainable;
            },
        };
        this.#checks.push({ name, fn, chainable });
        return chainable;
    }

    /**
    * Retrieves the current health status of the server.
    * Results are cached for 30 seconds to reduce computation overhead.
    *
    * @returns {Object} An object containing:
    * - `ok` {boolean}: Indicates if all health checks passed.
    * - `failed` {Array<string>}: An array of names of failed health checks, if any.
    */
    async get_status () {
        const cacheKey = ServerHealthRedisCacheKeys.status;

        // Check cache first
        const cached = await kv.get(cacheKey);
        if ( cached ) {
            try {
                return JSON.parse(cached);
            } catch (e) {
                // no op cache is in an invalid state
            }
        }

        // Compute status
        const failures = this.#failures.map(v => v.name);
        const status = {
            ok: failures.length === 0,
            ...(failures.length ? { failed: failures } : {}),
        };

        // Cache with 5 second TTL
        await kv.set(cacheKey, JSON.stringify(status), { EX: 5 });

        return status;
    }
}
