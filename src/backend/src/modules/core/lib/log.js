// METADATA // {"def":"core.util.logutil","ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const log_epoch = Date.now();

/**
* Stringifies a log entry into a formatted string for console output.
* @param {Object} logEntry - The log entry object containing:
*   @param {string} [prefix] - Optional prefix for the log message.
*   @param {Object} log_lvl - Log level object with properties for label, escape code, etc.
*   @param {string[]} crumbs - Array of context crumbs.
*   @param {string} message - The log message.
*   @param {Object} fields - Additional fields to be included in the log.
*   @param {Object} objects - Objects to be logged.
* @returns {string} A formatted string representation of the log entry.
*/
const stringify_log_entry = ({ prefix, log_lvl, crumbs, message, fields, objects }) => {
    const { colorize } = require('json-colorizer');

    let lines = [], m;

    const lf = () => {
        if ( ! m ) return;
        lines.push(m);
        m = '';
    }

    m = prefix ? `${prefix} ` : '';
    m += `\x1B[${log_lvl.esc}m[${log_lvl.label}\x1B[0m`;
    for ( const crumb of crumbs ) {
        m += `::${crumb}`;
    }
    m += `\x1B[${log_lvl.esc}m]\x1B[0m`;
    if ( fields.timestamp ) {
        // display seconds since logger epoch
        const n = (fields.timestamp - log_epoch) / 1000;
        m += ` (${n.toFixed(3)}s)`;
    }
    m += ` ${message} `;
    lf();
    for ( const k in fields ) {
        if ( k === 'timestamp' ) continue;
        let v; try {
            v = colorize(JSON.stringify(fields[k]));
        } catch (e) {
            v = '' + fields[k];
        }
        m += ` \x1B[1m${k}:\x1B[0m ${v}`;
        lf();
    }
    return lines.join('\n');
};

module.exports = {
    stringify_log_entry,
    log_epoch,
};
