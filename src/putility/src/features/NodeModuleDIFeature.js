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
/**
 * This trait allows dependency injection of node modules.
 * This is incredibly useful for passing mock implementations
 * of modules for unit testing.
 *
 * @example
 * class MyClass extends AdvancedBase {
 *   static MODULES = {
 *     axios,
 *   };
 * }
 *
 * const my_class = new MyClass({
 *   modules: {
 *     axios: MY_AXIOS_MOCK,
 *   }
 * });
 */
module.exports = {
    install_in_instance: (instance, { parameters }) => {
        const modules = instance._get_merged_static_object('MODULES');

        if ( parameters.modules ) {
            for ( const k in parameters.modules ) {
                modules[k] = parameters.modules[k];
            }
        }

        instance.modules = modules;
        
        // This "require" function can shadow the real one so
        // that editor tools are aware of the modules that
        // are being used.
        instance.require = (name) => {
            if ( modules[name] ) {
                return modules[name];
            }
            return require(name);
        }
    },
};
