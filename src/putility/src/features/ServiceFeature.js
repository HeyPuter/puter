/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

const { TTopics } = require('../traits/traits');

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
                                spec.do.bind(instance));
            });
        }
    },
};
