// METADATA // {"ai-commented":{"service":"xai"}}
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
const BaseService = require("../../services/BaseService");
const { time, promise } = require("@heyputer/putility").libs;


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
        linuxutil: 'core.util.linuxutil'
    };
    
    /**
    * Defines the modules used by ServerHealthService.
    * This static property is used to initialize and access system modules required for health checks.
    * @type {Object}
    * @property {fs} fs - The file system module for reading system information.
    */
    static MODULES = {
        fs: require('fs'),
    }

    /**
    * Initializes the internal checks and failure tracking for the service.
    * This method sets up empty arrays to store health checks and their failure statuses.
    * 
    * @private
    */
    _construct () {
        this.checks_ = [];
        this.failures_ = [];
    }

    async _init () {
        this.init_service_checks_();

        /*
            There's an interesting thread here:
            https://github.com/nodejs/node/issues/23892

            It's a discussion about whether to report "free" or "available" memory
            in `os.freemem()`. There was no clear consensus in the discussion,
            and then libuv was changed to report "available" memory instead.

            I've elected not to use `os.freemem()` here and instead read
            `/proc/meminfo` directly.
        */


        const min_available_KiB = 1024 * 1024 * 2; // 2 GiB

        const svc_alarm = this.services.get('alarm');

        this.stats_ = {};

        // Disable if we're not on Linux
        if ( process.platform !== 'linux' ) {
            return;
        }
        
        if ( this.config.no_system_checks ) return;


        /**
        * Adds a health check to the service.
        * 
        * @param {string} name - The name of the health check.
        * @param {Function} fn - The function to execute for the health check.
        * @returns {Object} A chainable object to add failure handlers.
        */
        this.add_check('ram-usage', async () => {
            const meminfo_text = await this.modules.fs.promises.readFile(
                '/proc/meminfo', 'utf8'
            );
            const meminfo = this.linuxutil.parse_meminfo(meminfo_text);
            const log_fields = {
                mem_free: meminfo.MemFree,
                mem_available: meminfo.MemAvailable,
                mem_total: meminfo.MemTotal,
            };
            
            this.log.debug('memory', log_fields);

            Object.assign(this.stats_, log_fields);

            if ( meminfo.MemAvailable < min_available_KiB ) {
                svc_alarm.create('low-available-memory', 'Low available memory', log_fields);
            }
        });
    }


    /**
    * Initializes service health checks by setting up periodic checks.
    * This method configures an interval-based execution of health checks,
    * handles timeouts, and manages failure states.
    * 
    * @param {none} - This method does not take any parameters.
    * @returns {void} - This method does not return any value.
    */
    init_service_checks_ () {
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
            this.log.tick('service checks');
            const check_failures = [];
            for ( const { name, fn, chainable } of this.checks_ ) {
                const p_timeout = new promise.TeePromise();
                /**
                * Creates a TeePromise to handle potential timeouts during health checks.
                * 
                * @returns {Promise} A promise that can be resolved or rejected from multiple places.
                */
                const timeout = setTimeout(() => {
                    p_timeout.reject(new Error('Health check timed out'));
                }, 5 * time.SECOND);
                try {
                    await Promise.race([
                        fn(),
                        p_timeout,
                    ]);
                    clearTimeout(timeout);
                } catch ( err ) {
                    // Trigger an alarm if this check isn't already in the failure list

                    if ( this.failures_.some(v => v.name === name) ) {
                        return;
                    }

                    svc_alarm.create(
                        'health-check-failure',
                        `Health check ${name} failed`,
                        { error: err }
                    );
                    check_failures.push({ name });
                    
                    this.log.error(`Error for healthcheck fail on ${name}: ` + err.stack);

                    // Run the on_fail handlers
                    for ( const fn of chainable.on_fail_ ) {
                        try {
                            await fn(err);
                        } catch ( e ) {
                            this.log.error(`Error in on_fail handler for ${name}`, e);
                        }
                    }
                }
            }

            this.failures_ = check_failures;
        }, 10 * time.SECOND, null, {
            onBehindSchedule: (drift) => {
                svc_alarm.create(
                    'health-checks-behind-schedule',
                    'Health checks are behind schedule',
                    { drift }
                );
            }
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
        };
        chainable.on_fail = (fn) => {
            chainable.on_fail_.push(fn);
            return chainable;
        };
        this.checks_.push({ name, fn, chainable });
        return chainable;
    }


    /**
    * Retrieves the current health status of the server.
    * 
    * @returns {Object} An object containing:
    * - `ok` {boolean}: Indicates if all health checks passed.
    * - `failed` {Array<string>}: An array of names of failed health checks, if any.
    */
    get_status () {
        const failures = this.failures_.map(v => v.name);
        return {
            ok: failures.length === 0,
            ...(failures.length ? { failed: failures } : {}),
        };
    }
}

module.exports = { ServerHealthService };
