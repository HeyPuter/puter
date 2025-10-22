/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

module.exports = {
    readme: `
        Normalized Asynchronous Request Invocation (NARI) Methods Feature

        This feature allows a class to define "Nari methods", which are methods
        that support both async/await and callback-style invocation, have
        positional arguments, and an options argument.

        "the expected interface for methods in puter.js"

        The underlying method will receive parameters as an object, with the
        positional arguments as keys in the object. The options argument will
        be merged into the parameters object unless the method spec specifies
        \`separate_options: true\`.

        Example:

        \`\`\`
        class MyClass extends AdvancedBase {
            static NARI_METHODS = {
                myMethod: {
                    positional: ['param1', 'param2'],
                    fn: ({ param1, param2 }) => {
                        return param1 + param2;
                    }
                }
            }
        }

        const instance = new MyClass();
        const result = instance.myMethod(1, 2); // returns 3
        \`\`\`

        The method can also be called with options and callbacks:

        \`\`\`
        instance.myMethod(1, 2, { option1: 'value' }, (result) => {
            console.log('success', result);
        }, (error) => {
            console.error('error', error);
        });
        \`\`\`
    `,
    install_in_instance: (instance) => {
        const nariMethodSpecs = instance._get_merged_static_object('NARI_METHODS');

        instance._.nariMethods = {};

        for ( const method_name in nariMethodSpecs ) {
            const spec = nariMethodSpecs[method_name];
            const bound_fn = spec.fn.bind(instance);
            instance._.nariMethods[method_name] = bound_fn;

            instance[method_name] = async (...args) => {
                const endArgsIndex = (() => {
                    if ( spec.firstarg_options ) {
                        if ( typeof args[0] === 'object' ) {
                            return 0;
                        }
                    }
                    return spec.positional.length;
                })();
                const posArgs = args.slice(0, endArgsIndex);
                const endArgs = args.slice(endArgsIndex);

                const parameters = {};
                const options = {};
                const callbacks = {};
                for ( const [index, arg] of posArgs.entries() ) {
                    parameters[spec.positional[index]] = arg;
                }
                
                if ( typeof endArgs[0] === 'object' ) {
                    Object.assign(options, endArgs[0]);
                    endArgs.shift();
                }

                if ( typeof endArgs[0] === 'function' ) {
                    callbacks.success = endArgs[0];
                    endArgs.shift();
                } else if ( options.success ) {
                    callbacks.success = options.success;
                }

                if ( typeof endArgs[0] === 'function' ) {
                    callbacks.error = endArgs[0];
                    endArgs.shift();
                } else if ( options.error ) {
                    callbacks.error = options.error;
                }

                if ( spec.separate_options ) {
                    parameters.options = options;
                } else {
                    Object.assign(parameters, options);
                }

                let retval;
                try {
                    retval = await bound_fn(parameters);
                } catch (e) {
                    if ( callbacks.error ) {
                        callbacks.error(e);
                    } else {
                        throw e;
                    }
                }

                if ( callbacks.success ) {
                    callbacks.success(retval);
                }

                return retval;
            };
        }
    }
};
