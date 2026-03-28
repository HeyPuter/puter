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
const { ServerHealthRedisCacheKeys } = require('./ServerHealthRedisCacheKeys.js');
const BaseService = require('../../../services/BaseService');
const { kv } = require('../../../util/kvSingleton');
const { promise } = require('@heyputer/putility').libs;

const SECOND = 1000;
const CHECK_INTERVAL_MS = 5 * SECOND;
const CHECK_TIMEOUT_MS = 4 * SECOND;
const HEALTH_LOOP_STALE_MULTIPLIER = 3;
const DEFAULT_DB_LIVENESS_LATENCY_FAIL_MS = 1500;

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
class ServerHealthService extends BaseService {
    static USE = {
        linuxutil: 'core.util.linuxutil',
    };

    static MODULES = {
        fs: require('fs'),
    };

    _construct () {
        this.checks_ = [];
        this.failures_ = [];
        this.health_started_at_ = Date.now();
        this.last_check_cycle_started_at_ = 0;
        this.last_check_cycle_completed_at_ = 0;
        this.web_checks_registered_ = false;
        this.isDraining_ = false;
    }

    async _init () {
        this.stats_ = {};

        this.#initDefaultChecks();
        this.#initServiceCheck();
    }

    async '__on_ready.webserver' () {
        this.#registerWebChecks();
    }

    beginDrain (reason = 'shutdown') {
        if ( this.isDraining_ ) return;
        this.isDraining_ = true;
        this.failures_ = [];
        this.last_check_cycle_completed_at_ = Date.now();
        this.stats_ = this.stats_ ?? {};
        this.stats_.last_check_cycle_completed_at = this.last_check_cycle_completed_at_;
        this.stats_.check_durations_ms = {};
        this.stats_.failed_checks = [];
        this.log.info(`server health entering drain mode: ${reason}`);
    }

    #initDefaultChecks () {
        const dbService = this.#getServiceIfAvailable('database');
        if ( dbService && typeof dbService.read === 'function' ) {
            const dbLivenessLatencyFailMs = Number(
                this.global_config?.server_health?.db_liveness_latency_fail_ms,
            ) || DEFAULT_DB_LIVENESS_LATENCY_FAIL_MS;

            this.add_check('database-liveness', async () => {
                const startedAt = Date.now();
                const rows = await dbService.read('SELECT 1 AS ok');
                const durationMs = Date.now() - startedAt;

                this.stats_.database_liveness_latency_ms = durationMs;

                if ( !Array.isArray(rows) || rows.length === 0 ) {
                    throw new Error('database liveness check returned no rows');
                }

                if ( durationMs > dbLivenessLatencyFailMs ) {
                    throw new Error(
                        `database liveness query latency too high: ${durationMs}ms ` +
                        `(threshold ${dbLivenessLatencyFailMs}ms)`,
                    );
                }
            });
        }
    }

    #registerWebChecks () {
        if ( this.web_checks_registered_ ) return;

        const webServerService = this.#getServiceIfAvailable('web-server');
        if ( ! webServerService ) return;

        this.add_check('web-server-listening', async () => {
            const server = webServerService.get_server?.();
            if ( ! server ) {
                throw new Error('web server is not initialized');
            }

            if ( server.listening !== true ) {
                throw new Error('web server is not listening');
            }
        });

        const socketioService = this.#getServiceIfAvailable('socketio');
        if ( socketioService ) {
            this.add_check('socketio-initialized', async () => {
                if ( ! socketioService.io ) {
                    throw new Error('socket.io is not initialized');
                }
            });
        }

        this.web_checks_registered_ = true;
    }

    /**
    * Initializes service health checks by setting up periodic checks.
    * This method configures an interval-based execution of health checks,
    * handles timeouts, and manages failure states.
    *
    * @param {none} - This method does not take any parameters.
    * @returns {void} - This method does not return any value.
    */
    #initServiceCheck () {
        const svc_alarm = this.services.get('alarm');
        /**
        * Initializes periodic health checks for the server.
        *
        * This method sets up an interval to run all registered health checks
        * at a specified frequency. It manages the execution of checks, handles
        * timeouts, and logs errors or triggers alarms when checks fail.
        *
        * @private
        * @method init_service_checks_
        * @memberof ServerHealthService
        * @param {none} - No parameters are passed to this method.
        * @returns {void}
        */
        promise.asyncSafeSetInterval(async () => {
            if ( this.isDraining_ ) {
                this.last_check_cycle_completed_at_ = Date.now();
                this.stats_.last_check_cycle_completed_at = this.last_check_cycle_completed_at_;
                this.stats_.check_durations_ms = {};
                this.stats_.failed_checks = [];
                return;
            }

            const check_failures = [];
            const check_durations_ms = {};
            for ( const { name, fn, chainable } of this.checks_ ) {
                const p_timeout = new promise.TeePromise();
                /**
                * Creates a TeePromise to handle potential timeouts during health checks.
                *
                * @returns {Promise} A promise that can be resolved or rejected from multiple places.
                */
                const timeout = setTimeout(() => {
                    p_timeout.reject(new Error('Health check timed out'));
                }, CHECK_TIMEOUT_MS);
                const check_started_at = Date.now();
                try {
                    await Promise.race([
                        fn(),
                        p_timeout,
                    ]);
                } catch ( err ) {
                    check_failures.push({ name });
                    const alreadyFailing = this.failures_.some(v => v.name === name);

                    if ( ! alreadyFailing ) {
                        svc_alarm.create(
                            'health-check-failure',
                            `Health check ${name} failed`,
                            { error: err },
                        );

                        // Run the on_fail handlers only on new failures
                        for ( const fn of chainable.on_fail_ ) {
                            try {
                                await fn(err);
                            } catch ( e ) {
                                this.log.error(`Error in on_fail handler for ${name}`, e);
                            }
                        }
                    }

                    this.log.error(`Error for healthcheck fail on ${name}: ${ err.stack}`);
                } finally {
                    clearTimeout(timeout);
                    check_durations_ms[name] = Date.now() - check_started_at;
                }
            }

            this.failures_ = check_failures;
            this.last_check_cycle_completed_at_ = Date.now();
            this.stats_.last_check_cycle_completed_at = this.last_check_cycle_completed_at_;
            this.stats_.check_durations_ms = check_durations_ms;
            this.stats_.failed_checks = this.failures_.map(v => v.name);
        }, CHECK_INTERVAL_MS, null, {
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
        return { ...this.stats_ };
    }

    add_check (name, fn) {
        const chainable = {
            on_fail_: [],
            on_fail: (fn) => {
                chainable.on_fail_.push(fn);
                return chainable;
            },
        };
        this.checks_.push({ name, fn, chainable });
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
        if ( this.isDraining_ ) {
            return {
                ok: false,
                failed: ['draining'],
            };
        }

        const cacheKey = ServerHealthRedisCacheKeys.status;

        // Check cache first
        try {
            const cached = await kv.get(cacheKey);
            if ( cached ) {
                try {
                    return JSON.parse(cached);
                } catch (e) {
                    // no op cache is in an invalid state
                }
            }
        } catch (e) {
            this.log.warn(`Unable to read health status cache: ${e.message}`);
        }

        // Compute status
        const failures = this.#getStatusFailures();
        const status = {
            ok: failures.length === 0,
            ...(failures.length ? { failed: failures } : {}),
        };

        // Cache with 5 second TTL
        try {
            await kv.set(cacheKey, JSON.stringify(status), {
                EX: 5,
            });
        } catch (e) {
            this.log.warn(`Unable to write health status cache: ${e.message}`);
        }

        return status;
    }

    #getStatusFailures () {
        const failures = this.failures_.map(v => v.name);
        const staleHealthRunnerFailure = this.#getStaleHealthRunnerFailure();
        if ( staleHealthRunnerFailure ) {
            failures.push(staleHealthRunnerFailure);
        }
        return failures;
    }

    #getStaleHealthRunnerFailure () {
        const staleAfterMs = Number(
            this.global_config?.server_health?.stale_health_loop_fail_ms,
        ) || (CHECK_INTERVAL_MS * HEALTH_LOOP_STALE_MULTIPLIER);
        const now = Date.now();

        if ( this.last_check_cycle_completed_at_ === 0 ) {
            return (now - this.health_started_at_) > staleAfterMs
                ? 'health-check-loop-not-running'
                : null;
        }

        return (now - this.last_check_cycle_completed_at_) > staleAfterMs
            ? 'health-check-loop-stale'
            : null;
    }

    #getServiceIfAvailable (serviceName) {
        try {
            return this.services.get(serviceName);
        } catch {
            return null;
        }
    }
}

module.exports = { ServerHealthService };
