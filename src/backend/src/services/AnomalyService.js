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

const DENY_SERVICE_INSTRUCTION = Symbol('DENY_SERVICE_INSTRUCTION');

class AnomalyService extends BaseService {
    _construct () {
        this.types = {};
    }
    register (type, config) {
        const type_instance = {
            config,
        }
        if ( config.handler ) {
            type_instance.handler = config.handler;
        } else if ( config.high ) {
            type_instance.handler = data => {
                if ( data.value > config.high ) {
                    return new Set([DENY_SERVICE_INSTRUCTION]);
                }
            }
        }
        this.types[type] = type_instance;
    }
    async note (id, data) {
        const type = this.types[id];
        if ( ! type ) return;
        
        return type.handler(data);
    }
}

module.exports = {
    AnomalyService,
    DENY_SERVICE_INSTRUCTION,
};
