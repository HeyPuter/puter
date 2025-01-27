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
const { Context } = require("../util/context");

class OtelFeature {
    constructor (method_include_list) {
        this.method_include_list = method_include_list;
    }
    install_in_instance (instance) {
        for ( const method_name of this.method_include_list ) {
            const original_method = instance[method_name];
            instance[method_name] = async (...args) => {
                const context = Context.get();
                // This happens when internal services call, such as PuterVersionService
                if ( ! context ) return;

                const class_name = instance.constructor.name;

                const tracer = context.get('services').get('traceService').tracer;
                let result;
                await tracer.startActiveSpan(`${class_name}:${method_name}`, async span => {
                    result = await original_method.call(instance, ...args);
                    span.end();
                });
                return result;
            }
        }
    }
}

class SyncOtelFeature {
    constructor (method_include_list) {
        this.method_include_list = method_include_list;
    }
    install_in_instance (instance) {
        for ( const method_name of this.method_include_list ) {
            const original_method = instance[method_name];
            instance[method_name] = (...args) => {
                const context = Context.get();
                if ( ! context ) {
                    throw new Error('missing context');
                }

                const class_name = instance.constructor.name;

                const tracer = context.get('services').get('traceService').tracer;
                let result;
                tracer.startActiveSpan(`${class_name}:${method_name}`, async span => {
                    result = original_method.call(instance, ...args);
                    span.end();
                });
                return result;
            }
        }
    }
}

module.exports = {
    OtelFeature
};
