// METADATA // {"def":"core.util.logutil","ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { display_time, module_epoch } = require('@heyputer/putility/src/libs/time.js');
const config = require('../../../config.js');

// Example:
// log("booting");            // → "14:07:12 booting"
// (next day) log("tick");    // → "16 00:00:01 tick"
// (next month) log("tick");  // → "11-01 00:00:01 tick"
// (next year) log("tick");   // → "2026-01-01 00:00:01 tick"


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
    };
    
    m = '';

    if ( ! config.show_relative_time ) {
        m += `${display_time(fields.timestamp)} `;
    }

    m += prefix ? `${prefix} ` : '';
    let levelLabelShown = false;
    if ( log_lvl.label !== 'INFO' || ! config.log_hide_info_label ) {
        levelLabelShown = true;
        m += `\x1B[${log_lvl.esc}m[${log_lvl.label}\x1B[0m`;
    } else {
        m += `\x1B[${log_lvl.esc}m[\x1B[0m`;
    }
    for ( let crumb of crumbs ) {
        if ( crumb.startsWith('extension/') ) {
            crumb = `\x1B[34;1m${crumb}\x1B[0m`;
        }
        if ( levelLabelShown ) {
            m += '::';
        } else levelLabelShown = true;
        m += crumb;
    }
    m += `\x1B[${log_lvl.esc}m]\x1B[0m`;
    if ( fields.timestamp ) {
        if ( config.show_relative_time ) {
            // display seconds since logger epoch
            const n = (fields.timestamp - module_epoch) / 1000;
            m += ` (${n.toFixed(3)}s)`;
        }
    }
    m += ` ${message} `;
    lf();
    for ( const k in fields ) {
        // Extensions always have the system actor in context which makes logs
        // too verbose. To combat this, we disable logging the 'actor' field
        // when the actor's username is 'system' and the `crumbs` include a
        // string that starts with 'extension'.
        if ( k === 'actor' && crumbs.some(crumb => crumb.startsWith('extension/')) ) {
            if ( typeof fields[k] === 'object' && fields[k]?.username === 'system' ) {
                continue;
            }
        }

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
};
