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

const NOOP = async () => {};

class BaseService extends AdvancedBase {
    constructor (service_resources, ...a) {
        const { services, config, my_config, name, args } = service_resources;
        super(service_resources, ...a);

        this.args = args;
        this.service_name = name || this.constructor.name;
        this.services = services;
        this.config = my_config;
        this.global_config = config;

        if ( this.global_config.server_id === '' ) {
            this.global_config.server_id = 'local';
        }
    }

    async construct () {
        await (this._construct || NOOP).call(this, this.args);
    }

    async init () {
        const services = this.services;
        this.log = services.get('log-service').create(this.service_name);
        this.errors = services.get('error-service').create(this.log);

        await (this._init || NOOP).call(this, this.args);
    }

    async __on (id, args) {
        const handler = this.__get_event_handler(id);

        return await handler(id, ...args);
    }

    __get_event_handler (id) {
        return this[`__on_${id}`]?.bind?.(this)
            || this.constructor[`__on_${id}`]?.bind?.(this.constructor)
            || NOOP;
    }
}

module.exports = BaseService;
