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

const { TTopics } = require("../traits/traits");

module.exports = {
    install_in_instance: (instance, { parameters }) => {
        // Convenient definition of listeners between services,
        // which also makes these connections able to be understood as data
        // without processing any code.
        const hooks = instance._get_merged_static_array('HOOKS');
        instance._.init_hooks = instance._.init_hooks ?? [];

        for ( const spec of hooks ) {

            // We need to wait for the service to be initialized, because
            // that's when the dependency services have already been
            // initialized and are ready to accept listeners.
            instance._.init_hooks.push(() => {
                const service_entry =
                    instance._.context.services.info(spec.service);
                const service_instance = service_entry.instance;

                service_instance.as(TTopics).sub(
                    spec.event,
                    spec.do.bind(instance),
                );
            });
        }
    }
};
