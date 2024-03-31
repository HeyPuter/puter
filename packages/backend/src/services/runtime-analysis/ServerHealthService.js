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
const { asyncSafeSetInterval } = require("../../util/promise");

class ServerHealthService extends BaseService {
    static MODULES = {
        fs: require('fs'),
    }
    async _init () {
        const ram_poll_interval = 10 * SECOND;

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

        asyncSafeSetInterval(async () => {
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
        }, ram_poll_interval, null,{
            onBehindSchedule: (drift) => {
                svc_alarm.create(
                    'ram-usage-poll-behind-schedule',
                    'RAM usage poll is behind schedule',
                    { drift }
                );
            }
        });
    }

    async get_stats () {
        return { ...this.stats_ };
    }
}

module.exports = { ServerHealthService };
