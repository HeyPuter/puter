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

const BaseService = require("./BaseService");

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
class ParameterService extends BaseService {
    _construct () {
        this.parameters_ = [];
    }
    
    _init () {
        this._registerCommands(this.services.get('commands'));
    }

    createParameters(serviceName, parameters, opt_instance) {
        for (const parameter of parameters) {
            this.log.info(`registering parameter ${serviceName}:${parameter.id}`);
            this.parameters_.push(new Parameter({
                ...parameter,
                id: `${serviceName}:${parameter.id}`,
            }));
            if ( opt_instance ) {
                this.bindToInstance(
                    `${serviceName}:${parameter.id}`,
                    opt_instance,
                    parameter.id,
                );
            }
        }
    }

    async get(id) {
        const parameter = this._get_param(id);
        return await parameter.get();
    }

    bindToInstance (id, instance, name) {
        const parameter = this._get_param(id);
        return parameter.bindToInstance(instance, name);
    }

    subscribe (id, listener) {
        const parameter = this._get_param(id);
        return parameter.subscribe(listener);
    }

    _get_param(id) {
        const parameter = this.parameters_.find(p => p.spec_.id === id);
        if ( ! parameter ) {
            throw new Error(`unknown parameter: ${id}`);
        }
        return parameter;
    }

    _registerCommands (commands) {
        const completeParameterName = (args) => {
            // The parameter name is the first argument, so return no results if we're on the second or later.
            if (args.length > 1)
                return;
            const lastArg = args[args.length - 1];

            return this.parameters_
                .map(parameter => parameter.spec_.id)
                .filter(parameterName => parameterName.startsWith(lastArg));
        };

        commands.registerCommands('params', [
            {
                id: 'get',
                description: 'get a parameter',
                handler: async (args, log) => {
                    const [name] = args;
                    const value = await this.get(name);
                    log.log(value);
                },
                completer: completeParameterName,
            },
            {
                id: 'set',
                description: 'set a parameter',
                handler: async (args, log) => {
                    const [name, value] = args;
                    const parameter = this._get_param(name);
                    parameter.set(value);
                    log.log(value);
                },
                completer: completeParameterName,
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

class Parameter {
    constructor(spec) {
        this.spec_ = spec;
        this.valueListeners_ = [];

        if ( spec.default ) {
            this.value_ = spec.default;
        }
    }

    async set (value) {
        for ( const constraint of (this.spec_.constraints ?? []) ) {
            if ( ! await constraint.check(value) ) {
                throw new Error(`value ${value} does not satisfy constraint ${constraint.id}`);
            }
        }

        const old = this.value_;
        this.value_ = value;
        for ( const listener of this.valueListeners_ ) {
            listener(value, { old });
        }
    }

    async get () {
        return this.value_;
    }

    bindToInstance (instance, name) {
        const value = this.value_;
        instance[name] = value;
        this.valueListeners_.push((value) => {
            instance[name] = value;
        });
    }

    subscribe (listener) {
        this.valueListeners_.push(listener);
    }
}

module.exports = {
    ParameterService,
};
