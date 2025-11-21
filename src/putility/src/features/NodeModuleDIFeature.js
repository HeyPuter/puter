/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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
            if ( instance.modules[name] ) {
                return instance.modules[name];
            }
            return require(name);
        };
    },
};
