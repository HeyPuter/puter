// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const memwatch = require('@airbnb/node-memwatch');


/**
* The HeapMonService class monitors the application's memory usage,
* utilizing the memwatch library to detect heap memory leaks and 
* gather heap statistics at specified intervals. It interfaces with 
* logging and alarm services to report memory conditions and 
* trigger alerts as necessary.
*/
class HeapMonService {
    constructor ({ services, my_config }) {
        this.log = services.get('log-service').create('heap-monitor');
        this.alarm = services.get('alarm');

        let hd, hd_ts;

        if ( my_config.heapdiff ) {
            hd = new memwatch.HeapDiff();
            hd_ts = Date.now();
        }

        let heapdiff_interval = my_config.heapdiff_interval ?? 1;
        heapdiff_interval *= 1000;

        memwatch.on('stats', (stats) => {
            this.log.info('stats', stats);

            (() => {
                if ( ! my_config.heapdiff ) return

                const now = Date.now();

                if ( (now - hd_ts) < heapdiff_interval ) return;

                const diff = hd.end();
                this.log.info('heapdiff', diff);
                hd = new memwatch.HeapDiff();
                hd_ts = now;
            })();
        });

        memwatch.on('leak', (info) => {
            this.log.error('leak', info);
            this.alarm.create('heap-leak', 'memory leak detected', info);
        });
    }
}

module.exports = { HeapMonService };