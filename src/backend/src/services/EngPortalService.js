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
const { AdvancedBase } = require("@heyputer/puter-js-common");

class EngPortalService extends AdvancedBase {
    static MODULES = {
        socketio: require('../socketio.js'),
        uuidv4: require('uuid').v4,
    };

    constructor ({ services }) {
        super();
        this.services = services;
        this.commands = services.get('commands');
        this._registerCommands(this.commands);
    }

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

    async list_alarms () {
        const svc_alarm = this.services.get('alarm');
        const ls = [];
        for ( const id in svc_alarm.alarms ) {
            const alarm = svc_alarm.alarms[id];
            ls.push(this._serialize_alarm(alarm));
        }

        return ls;
    }

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
