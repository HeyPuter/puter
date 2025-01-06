// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const { AdvancedBase } = require("@heyputer/putility");


/**
* @class EngPortalService
* @extends {AdvancedBase}
*
* EngPortalService is a class that provides services for managing and accessing various operations, alarms, and statistics
* within a system. It inherits from the AdvancedBase class and utilizes multiple dependencies such as socket.io for communication
* and uuidv4 for generating unique identifiers. The class includes methods for listing operations, serializing frames, listing alarms,
* fetching server statistics, and registering command handlers. This class is integral to maintaining and monitoring system health
* and operations efficiently.
*/
class EngPortalService extends AdvancedBase {
    static MODULES = {
        uuidv4: require('uuid').v4,
    };

    constructor ({ services }) {
        super();
        this.services = services;
        this.commands = services.get('commands');
        this._registerCommands(this.commands);
    }


    /**
    * Lists all ongoing operations.
    * This method retrieves all ongoing operations from the 'operationTrace' service,
    * serializes them, and returns the serialized list.
    *
    * @async
    * @returns {Promise<Array>} A list of serialized operation frames.
    */
    async list_operations () {
        const svc_operationTrace = this.services.get('operationTrace');
        const ls = [];
        for ( const id in svc_operationTrace.ongoing ) {
            const op = svc_operationTrace.ongoing[id];
            ls.push(this._serialize_frame(op));
        }

        return ls;
    }

    _serialize_frame (frame) {
        const out = {
            id: frame.id,
            label: frame.label,
            status: frame.status,
            async: frame.async,
            checkpoint: frame.checkpoint,
            // tags: frame.tags,
            // attributes: frame.attributes,
            // messages: frame.messages,
            // error: frame.error_ ? frame.error_.message || true : null,
            children: [],
            attributes: {},
        };

        for ( const k in frame.attributes ) {
            out.attributes[k] = frame.attributes[k];
        }

        for ( const child of frame.children ) {
            out.children.push(this._serialize_frame(child));
        }

        return out;
    }


    /**
    * Retrieves a list of alarms.
    *
    * This method fetches all active alarms from the 'alarm' service and returns a serialized array of alarm objects.
    *
    * @returns {Promise<Array>} A promise that resolves to an array of serialized alarm objects.
    */
    async list_alarms () {
        const svc_alarm = this.services.get('alarm');
        const ls = [];
        for ( const id in svc_alarm.alarms ) {
            const alarm = svc_alarm.alarms[id];
            ls.push(this._serialize_alarm(alarm));
        }

        return ls;
    }


    /**
    * Gets the system statistics.
    *
    * This method retrieves the system statistics from the server-health service and returns them.
    *
    * @async
    * @returns {Promise<Object>} A promise that resolves to the system statistics.
    */
    async get_stats () {
        const svc_health = this.services.get('server-health');
        return await svc_health.get_stats();
    }

    _serialize_alarm (alarm) {
        const out = {
            id: alarm.id,
            short_id: alarm.short_id,
            started: alarm.started,
            occurrances: alarm.occurrences.map(this._serialize_occurance.bind(this)),
            ...(alarm.error ? {
                error: {
                    message: alarm.error.message,
                    stack: alarm.error.stack,
                }
            } : {}),
        };

        return out;
    }

    _serialize_occurance (occurance) {
        const out = {
            message: occurance.message,
            timestamp: occurance.timestamp,
            fields: occurance.fields,
        };

        return out;
    }

    _registerCommands (commands) {
        this.commands.registerCommands('eng', [
            {
                id: 'test',
                description: 'testing',
                handler: async (args, log) => {
                    const ops = await this.list_operations();
                    log.log(JSON.stringify(ops, null, 2));
                }
            },
            {
                id: 'set',
                description: 'set a parameter',
                handler: async (args, log) => {
                    const [name, value] = args;
                    const parameter = this._get_param(name);
                    parameter.set(value);
                    log.log(value);
                }
            },
            {
                id: 'list',
                description: 'list parameters',
                handler: async (args, log) => {
                    const [prefix] = args;
                    let parameters = this.parameters_;
                    if ( prefix ) {
                        parameters = parameters
                            .filter(p => p.spec_.id.startsWith(prefix));
                    }
                    log.log(`available parameters${
                        prefix ? ` (starting with: ${prefix})` : ''
                    }:`);
                    for (const parameter of parameters) {
                        // log.log(`- ${parameter.spec_.id}: ${parameter.spec_.description}`);
                        // Log parameter description and value
                        const value = await parameter.get();
                        log.log(`- ${parameter.spec_.id} = ${value}`);
                        log.log(`  ${parameter.spec_.description}`);
                    }
                }
            }
        ]);
    }
}

module.exports = {
    EngPortalService,
};
