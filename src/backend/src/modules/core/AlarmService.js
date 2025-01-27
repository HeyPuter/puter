// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const JSON5 = require('json5');
const seedrandom = require('seedrandom');

const util = require('util');
const _path = require('path');
const fs = require('fs');

const BaseService = require('../../services/BaseService.js');


/**
 * AlarmService class is responsible for managing alarms.
 * It provides methods for creating, clearing, and handling alarms.
 */
class AlarmService extends BaseService {
    static USE = {
        logutil: 'core.util.logutil',
        identutil: 'core.util.identutil',
        stdioutil: 'core.util.stdioutil',
        Context: 'core.context',
    }
    /**
    * This method initializes the AlarmService by setting up its internal data structures and initializing any required dependencies.
    *
    * It reads in the known errors from a JSON5 file and sets them as the known_errors property of the AlarmService instance.
    */
    async _construct () {
        this.alarms = {};
        this.alarm_aliases = {};

        this.known_errors = [];
    }
    /**
    * Method to initialize AlarmService. Sets the known errors and registers commands.
    * @returns {Promise<void>}
    */
    async _init () {
        const services = this.services;
        this.pager = services.get('pager');

        // TODO:[self-hosted] fix this properly
        this.known_errors = [];

        if ( this.global_config.env === 'dev' ) {
            /**
            * This method initializes the AlarmService instance by registering commands, setting up the pager, and initializing the known errors.
            * It also sets up the widget to display alarms in the dev environment.
            *
            * @param {BaseService} services - The BaseService instance that provides access to other services.
            * @returns {void}
            */
            this.alarm_widget = () => {
                const lines = [];
                for ( const alarm of Object.values(this.alarms) ) {
                    const line =
                        `\x1B[31;1m [alarm]\x1B[0m ` +
                        `${alarm.id_string}: ${alarm.message} (${alarm.count})`;
                    const line_lines = this.stdioutil.split_lines(line);
                    lines.push(...line_lines);
                }

                return lines;
            }
        }
    }
    
    /**
     * AlarmService registers its commands at the consolidation phase because
     * the '_init' method of CommandService may not have been called yet.
     */
    ['__on_boot.consolidation'] () {
        this._register_commands(this.services.get('commands'));
    }

    adapt_id_ (id) {
        let shorten = true;

        if ( shorten ) {
            const rng = seedrandom(id);
            id = this.identutil.generate_identifier('-', rng);
        }

        return id;
    }

    /**
     * Method to create an alarm with the given ID, message, and fields.
     * If the ID already exists, it will be updated with the new fields
     * and the occurrence count will be incremented.
     * 
     * @param {string} id - Unique identifier for the alarm.
     * @param {string} message - Message associated with the alarm.
     * @param {object} fields - Additional information about the alarm.
     */
    create (id, message, fields) {
        this.log.error(`upcoming alarm: ${id}: ${message}`);
        let existing = false;
        /**
        * Method to create an alarm with the given ID, message, and fields.
        * If the ID already exists, it will be updated with the new fields.
        * @param {string} id - Unique identifier for the alarm.
        * @param {string} message - Message associated with the alarm.
        * @param {object} fields - Additional information about the alarm.
        * @returns {void}
        */
        const alarm = (() => {
            const short_id = this.adapt_id_(id);

            if ( this.alarms[id] ) {
                existing = true;
                return this.alarms[id];
            }

            const alarm = this.alarms[id] = this.alarm_aliases[short_id] = {
                id,
                short_id,
                started: Date.now(),
                occurrences: [],
            };

            Object.defineProperty(alarm, 'count', {
                /**
                * Method to create a new alarm.
                *
                * This method takes an id, message, and optional fields as parameters.
                * It creates a new alarm object with the provided id and message,
                * and adds it to the alarms object. It also keeps track of the number of occurrences of the alarm.
                * If the alarm already exists, it increments the occurrence count and calls the handle\_alarm\_repeat\_ method.
                * If it's a new alarm, it calls the handle\_alarm\_on\_ method.
                *
                * @param {string} id - The unique identifier for the alarm.
                * @param {string} message - The message associated with the alarm.
                * @param {object} [fields] - Optional fields associated with the alarm.
                * @returns {void}
                */
                get () {
                    return alarm.timestamps?.length ?? 0;
                }
            });

            Object.defineProperty(alarm, 'id_string', {
                /**
                * Method to handle creating a new alarm with given parameters.
                * This method adds the alarm to the `alarms` object, updates the occurrences count,
                * and processes any known errors that may apply to the alarm.
                * @param {string} id - The unique identifier for the alarm.
                * @param {string} message - The message associated with the alarm.
                * @param {Object} fields - Additional fields to associate with the alarm.
                */
                get () {
                    if ( alarm.id.length < 20 ) {
                        return alarm.id;
                    }

                    const truncatedLongId = alarm.id.slice(0, 20) + '...';

                    return `${alarm.short_id} (${truncatedLongId})`;
                }
            });

            return alarm;
        })();

        const occurance = {
            message,
            fields,
            timestamp: Date.now(),
        };

        // Keep logs from the previous occurrence if:
        // - it's one of the first 3 occurrences
        // - the 10th, 100th, 1000th...etc occurrence
        if ( alarm.count > 3 && Math.log10(alarm.count) % 1 !== 0 ) {
            delete alarm.occurrences[alarm.occurrences.length - 1].logs;
        }
        occurance.logs = this.log.get_log_buffer();

        alarm.message = message;
        alarm.fields = { ...alarm.fields, ...fields };
        alarm.timestamps = (alarm.timestamps ?? []).concat(Date.now());
        alarm.occurrences.push(occurance);

        if ( fields?.error ) {
            alarm.error = fields.error;
        }

        if ( alarm.source ) {
            console.error(alarm.error);
        }

        if ( existing ) {
            this.handle_alarm_repeat_(alarm);
        } else {
            this.handle_alarm_on_(alarm);
        }
    }

    /**
     * Method to clear an alarm with the given ID.
     * @param {*} id - The ID of the alarm to clear.
     * @returns {void}
     */
    clear (id) {
        const alarm = this.alarms[id];
        if ( !alarm ) {
            return;
        }
        delete this.alarms[id];
        this.handle_alarm_off_(alarm);
    }

    apply_known_errors_ (alarm) {
        const rule_matches = rule => {
            const match = rule.match;
            if ( match.id !== alarm.id ) return false;
            if ( match.message && match.message !== alarm.message ) return false;
            if ( match.fields ) {
                for ( const [key, value] of Object.entries(match.fields) ) {
                    if ( alarm.fields[key] !== value ) return false;
                }
            }
            return true;
        }

        const rule_actions = {
            'no-alert': () => alarm.no_alert = true,
            'severity': action => alarm.severity = action.value,
        };

        const apply_action = action => {
            rule_actions[action.type](action);
        };

        for ( const rule of this.known_errors ) {
            if ( rule_matches(rule) ) apply_action(rule.action);
        }
    }


    handle_alarm_repeat_ (alarm) {
        this.log.warn(
            `REPEAT ${alarm.id_string} :: ${alarm.message} (${alarm.count})`,
            alarm.fields,
        );

        this.apply_known_errors_(alarm);

        if ( alarm.no_alert ) return;

        const severity = alarm.severity ?? 'critical';

        const fields_clean = {};
        for ( const [key, value] of Object.entries(alarm.fields) ) {
            fields_clean[key] = util.inspect(value);
        }

        this.pager.alert({
            id: (alarm.id ?? 'something-bad') + '-r_${alarm.count}',
            message: alarm.message ?? alarm.id ?? 'something bad happened',
            source: 'alarm-service',
            severity,
            custom: {
                fields: fields_clean,
                trace: alarm.error?.stack,
            }
        });
    }

    handle_alarm_on_ (alarm) {
        this.log.error(
            `ACTIVE ${alarm.id_string} :: ${alarm.message} (${alarm.count})`,
            alarm.fields,
        );

        this.apply_known_errors_(alarm);

        // dev console
        if ( this.global_config.env === 'dev' && ! this.attached_dev ) {
            this.attached_dev = true;
            const svc_devConsole = this.services.get('dev-console');
            svc_devConsole.turn_on_the_warning_lights();
            svc_devConsole.add_widget(this.alarm_widget);
        }

        const args = this.Context.get('args') ?? {};
        if ( args['quit-on-alarm'] ) {
            const svc_shutdown = this.services.get('shutdown');
            svc_shutdown.shutdown({
                reason: '--quit-on-alarm is set',
                code: 1,
            });
        }

        if ( alarm.no_alert ) return;

        const severity = alarm.severity ?? 'critical';

        const fields_clean = {};
        for ( const [key, value] of Object.entries(alarm.fields) ) {
            fields_clean[key] = util.inspect(value);
        }

        this.pager.alert({
            id: alarm.id ?? 'something-bad',
            message: alarm.message ?? alarm.id ?? 'something bad happened',
            source: 'alarm-service',
            severity,
            custom: {
                fields: fields_clean,
                trace: alarm.error?.stack,
            }
        });

        // Write a .log file for the alert that happened
        try {
            const lines = [];
            lines.push(`ALERT ${alarm.id_string} :: ${alarm.message} (${alarm.count})`);
            lines.push(`started: ${new Date(alarm.started).toISOString()}`);
            lines.push(`short id: ${alarm.short_id}`);
            lines.push(`original id: ${alarm.id}`);
            lines.push(`severity: ${severity}`);
            lines.push(`message: ${alarm.message}`);
            lines.push(`fields: ${JSON.stringify(fields_clean)}`);

            const alert_info = lines.join('\n');

            (async () => {
                try {
                    fs.appendFileSync(`alert_${alarm.id}.log`, alert_info + '\n');
                } catch (e) {
                    this.log.error(`failed to write alert log: ${e.message}`);
                }
            })();
        } catch (e) {
            this.log.error(`failed to write alert log: ${e.message}`);
        }
    }

    handle_alarm_off_ (alarm) {
        this.log.info(
            `CLEAR ${alarm.id} :: ${alarm.message} (${alarm.count})`,
            alarm.fields,
        );
    }

    /**
     * Method to get an alarm by its ID.
     * 
     * @param {*} id - The ID of the alarm to get.
     * @returns 
     */
    get_alarm (id) {
        return this.alarms[id] ?? this.alarm_aliases[id];
    }

    _register_commands (commands) {
        // Function to handle a specific alarm event.
        // This comment can be added above line 320.
        // This function is responsible for processing specific events related to alarms.
        // It can be used for tasks such as updating alarm status, sending notifications, or triggering actions.
        // This function is called internally by the AlarmService class.
        
        // /*
        //  * handleAlarmEvent - Handles a specific alarm event.
        //  *
        //  * @param {Object} alarm - The alarm object containing relevant information.
        //  * @param {Function} callback - Optional callback function to be called when the event is handled.
        //  */
        // function handleAlarmEvent(alarm, callback) {
        //     // Implementation goes here.
        // }
        const completeAlarmID = (args) => {
            // The alarm ID is the first argument, so return no results if we're on the second or later.
            if (args.length > 1)
                return;
            const lastArg = args[args.length - 1];

            const results = [];
            for ( const alarm of Object.values(this.alarms) ) {
                if ( alarm.id.startsWith(lastArg) ) {
                    results.push(alarm.id);
                }
                if ( alarm.short_id?.startsWith(lastArg) ) {
                    results.push(alarm.short_id);
                }
            }
            return results;
        };

        commands.registerCommands('alarm', [
            {
                id: 'list',
                description: 'list alarms',
                handler: async (args, log) => {
                    for ( const alarm of Object.values(this.alarms) ) {
                        log.log(`${alarm.id_string}: ${alarm.message} (${alarm.count})`);
                    }
                }
            },
            {
                id: 'info',
                description: 'show info about an alarm',
                handler: async (args, log) => {
                    const [id] = args;
                    const alarm = this.get_alarm(id);
                    if ( !alarm ) {
                        log.log(`no alarm with id ${id}`);
                        return;
                    }
                    log.log(`\x1B[33;1m${alarm.id_string}\x1B[0m :: ${alarm.message} (${alarm.count})`);
                    log.log(`started: ${new Date(alarm.started).toISOString()}`);
                    log.log(`short id: ${alarm.short_id}`);
                    log.log(`original id: ${alarm.id}`);

                    // print stack trace of alarm error
                    if ( alarm.error ) {
                        log.log(alarm.error.stack);
                    }
                    // print other fields
                    for ( const [key, value] of Object.entries(alarm.fields) ) {
                        log.log(`- ${key}: ${util.inspect(value)}`);
                    }
                },
                completer: completeAlarmID,
            },
            {
                id: 'clear',
                description: 'clear an alarm',
                handler: async (args, log) => {
                    const [id] = args;
                    const alarm = this.get_alarm(id);
                    if ( ! alarm ) {
                        log.log(
                            `no alarm with id ${id}; ` +
                            `but calling clear(${JSON.stringify(id)}) anyway.`
                        );
                    }
                    this.clear(id);
                },
                completer: completeAlarmID,
            },
            {
                id: 'clear-all',
                description: 'clear all alarms',
                handler: async (args, log) => {
                    const alarms = Object.values(this.alarms);
                    this.alarms = {};
                    for ( const alarm of alarms ) {
                        this.handle_alarm_off_(alarm);
                    }
                }
            },
            {
                id: 'sound',
                description: 'sound an alarm',
                handler: async (args, log) => {
                    const [id, message] = args;
                    this.create(id ?? 'test', message, {});
                }
            },
            {
                id: 'inspect',
                description: 'show logs that happened an alarm',
                handler: async (args, log) => {
                    const [id, occurance_idx] = args;
                    const alarm = this.get_alarm(id);
                    if ( !alarm ) {
                        log.log(`no alarm with id ${id}`);
                        return;
                    }
                    const occurance = alarm.occurrences[occurance_idx];
                    if ( !occurance ) {
                        log.log(`no occurance with index ${occurance_idx}`);
                        return;
                    }
                    log.log(`┏━━ Logs before: ${alarm.id_string} ━━━━`);
                    for ( const lg of occurance.logs ) {
                        log.log("┃ " + this.logutil.stringify_log_entry(lg));
                    }
                    log.log(`┗━━ Logs before: ${alarm.id_string} ━━━━`);
                },
                completer: completeAlarmID,
            },
        ]);
    }
}

module.exports = {
    AlarmService,
};
