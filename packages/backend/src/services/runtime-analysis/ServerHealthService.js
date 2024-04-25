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
const BaseService = require("../BaseService");
const { SECOND } = require("../../util/time");
const { parse_meminfo } = require("../../util/linux");
const { asyncSafeSetInterval, TeePromise } = require("../../util/promise");

class ServerHealthService extends BaseService {
    static MODULES = {
        fs: require('fs'),
    }
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


        const min_free_KiB = 1024 * 1024; // 1 GiB
        const min_available_KiB = 1024 * 1024 * 2; // 2 GiB

        const svc_alarm = this.services.get('alarm');

        this.stats_ = {};

        // Disable if we're not on Linux
        if ( process.platform !== 'linux' ) {
            return;
        }

        this.add_check('ram-usage', async () => {
            const meminfo_text = await this.modules.fs.promises.readFile(
                '/proc/meminfo', 'utf8'
            );
            const meminfo = parse_meminfo(meminfo_text);
            const alarm_fields = {
                mem_free: meminfo.MemFree,
                mem_available: meminfo.MemAvailable,
                mem_total: meminfo.MemTotal,
            };

            Object.assign(this.stats_, alarm_fields);

            if ( meminfo.MemAvailable < min_available_KiB ) {
                svc_alarm.create('low-available-memory', 'Low available memory', alarm_fields);
            }
        });
    }

    init_service_checks_ () {
        const svc_alarm = this.services.get('alarm');
        asyncSafeSetInterval(async () => {
            this.log.tick('service checks');
            const check_failures = [];
            for ( const { name, fn, chainable } of this.checks_ ) {
                const p_timeout = new TeePromise();
                const timeout = setTimeout(() => {
                    p_timeout.reject(new Error('Health check timed out'));
                }, 5 * SECOND);
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
        }, 10 * SECOND, null, {
            onBehindSchedule: (drift) => {
                svc_alarm.create(
                    'health-checks-behind-schedule',
                    'Health checks are behind schedule',
                    { drift }
                );
            }
        });
    }

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

    get_status () {
        const failures = this.failures_.map(v => v.name);
        return {
            ok: failures.length === 0,
            ...(failures.length ? { failed: failures } : {}),
        };
    }
}

module.exports = { ServerHealthService };
