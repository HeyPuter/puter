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
const { instance_ } = require("../../monitor/PerformanceMonitor");
const { WeakConstructorFeature } = require("../../traits/WeakConstructorFeature");
const { Property } = require("./Property");
const { Entity } = require("../entitystorage/Entity");
const FSNodeContext = require("../../filesystem/FSNodeContext");

/**
 * An instance of Mapping wraps every definition in ../mappings before
 * it is registered in the 'om' collection in RegistryService.
 * Both wrapping and registering are done by RegistrantService.
 */
class Mapping extends AdvancedBase {
    static FEATURES = [
        // Whenever you can override something, it's reasonable to want
        // to pull the desired implementation from somewhere else to
        // avoid repeating yourself. Class constructors are one of a few
        // examples where this is typically not possible.
        // However, javascript is magic, and we do what we want.
        new WeakConstructorFeature(),
    ]

    static create (context, data) {
        const properties = {};

        // NEXT
        for ( const k in data.properties ) {
            properties[k] = Property.create(context, k, data.properties[k]);
        }

        return new Mapping({
            ...data,
            properties,
            sql: data.sql,
        });
    }

    async get_client_safe (data) {
        const client_safe = {};

        for ( const k in this.properties ) {
            const prop = this.properties[k];
            let value = data[k];

            if ( prop.descriptor.protected ) {
                continue;
            }

            if ( value === undefined ) {
                continue;
            }

            let sanitized = false;

            if ( value instanceof Entity ) {
                value = await value.get_client_safe();
                sanitized = true;
            }

            if ( value instanceof FSNodeContext ) {
                if ( ! await value.exists() ) {
                    value = undefined;
                    continue;
                }
                value = await value.getSafeEntry();
                sanitized = true;
            }

            // This is for reference properties to remove sensitive
            // information in case a decorator added the real object.
            if (
                ( ! sanitized ) &&
                typeof value === 'object' && value !== null &&
                prop.descriptor.permissible_subproperties
            ) {
                const old_value = value;
                value = {};
                for ( const subprop_name of prop.descriptor.permissible_subproperties ) {
                    if ( ! old_value.hasOwnProperty(subprop_name) ) {
                        continue;
                    }
                    value[subprop_name] = old_value[subprop_name];
                }
            }

            // client_safe[k] = await prop.typ.get_client_safe(value);
            client_safe[k] = value;
        }

        return client_safe;
    }
}

module.exports = {
    Mapping
};
