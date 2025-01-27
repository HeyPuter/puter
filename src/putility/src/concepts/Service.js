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

const { AdvancedBase } = require("../AdvancedBase");
const ServiceFeature = require("../features/ServiceFeature");

const NOOP = async () => {};

/** Service trait */
const TService = Symbol('TService');

/**
 * Service will be incrementally updated to consolidate
 * BaseService in Puter's backend with Service in Puter's frontend,
 * becoming the common base for both and a useful utility in general.
 */
class Service extends AdvancedBase {
    static FEATURES = [
        ServiceFeature,
    ];

    async __on (id, args) {
        const handler = this.__get_event_handler(id);

        return await handler(id, ...args);
    }

    __get_event_handler (id) {
        return this[`__on_${id}`]?.bind?.(this)
            || this.constructor[`__on_${id}`]?.bind?.(this.constructor)
            || NOOP;
    }

    static create ({ parameters, context }) {
        const ins = new this();
        ins._.context = context;
        ins.as(TService).construct(parameters);
        return ins;
    }

    static IMPLEMENTS = {
        [TService]: {
            init (...a) {
                if ( this._.init_hooks ) {
                    for ( const hook of this._.init_hooks ) {
                        hook.call(this);
                    }
                }
                if ( ! this._init ) return;
                return this._init(...a);
            },
            construct (o) {
                this.$parameters = {};
                for ( const k in o ) this.$parameters[k] = o[k];
                if ( ! this._construct ) return;
                return this._construct(o);
            },
            get_depends () {
                return [
                    ...(this.constructor.DEPENDS ?? []),
                    ...(this.get_depends?.() ?? []),
                ];
            }
        }
    }
}

module.exports = {
    TService,
    Service,
};
