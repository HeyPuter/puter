// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { Context } = require("../../util/context");
const APIError = require("../../api/APIError");
const { DriverError } = require("./DriverError");
const { TypedValue } = require("./meta/Runtime");
const BaseService = require("../BaseService");
const { PermissionUtil } = require("../auth/PermissionService");
const { Invoker } = require("../../../../putility/src/libs/invoker");
const { get_user } = require("../../helpers");
const { whatis } = require('../../util/langutil');

const strutil = require('@heyputer/putility').libs.string;

/**
 * DriverService provides the functionality of Puter drivers.
 * This class is responsible for managing and interacting with Puter drivers.
 * It provides methods for registering drivers, calling driver methods, and handling driver errors.
 */
class DriverService extends BaseService {
    static CONCERN = 'drivers';

    static MODULES = {
        types: require('./types'),
    }

    // 'IMPLEMENTS' here makes DriverService itself a driver
    static IMPLEMENTS = {
        driver: {
            async usage () {
                const actor = Context.get('actor');

                const usages = {
                    user: {}, // map[str(iface:method)]{date,count,max}
                    apps: {}, // []{app,map[str(iface:method)]{date,count,max}}
                    app_objects: {},
                    usages: [],
                };
                
                const event = {
                    actor,
                    usages: [],
                };
                const svc_event = this.services.get('event');
                await svc_event.emit('usages.query', event);
                usages.usages = event.usages;


                for ( const k in usages.apps ) {
                    usages.apps[k] = Object.values(usages.apps[k]);
                }

                return {
                    // Usage endpoint reports these, but the driver doesn't need to
                    // user: Object.values(usages.user),
                    // apps: usages.apps,
                    // app_objects: usages.app_objects,
                    
                    // This is the main "usages" object
                    usages: usages.usages,
                };
            }
        }
    }

    _construct () {
        this.drivers = {};
        this.interface_to_implementation = {};
        this.interface_to_test_service = {};
        this.service_aliases = {};
    }

    _init () {
        const svc_registry = this.services.get('registry');
        svc_registry.register_collection('');
        
        const { quot } = strutil;
        const svc_apiError = this.services.get('api-error');
        
        /**
         * There are registered into the new APIErrorService which allows for
         * better sepration of concerns between APIError and the services which.
         * depend on it.
         */
        svc_apiError.register({
            'missing_required_argument': {
                status: 400,
                message: ({ interface_name, method_name, arg_name }) =>
                    `Missing required argument ${quot(arg_name)} for method ${quot(method_name)} on interface ${quot(interface_name)}`,
            },
            'argument_consolidation_failed': {
                status: 400,
                message: ({ interface_name, method_name, arg_name, message }) =>
                    `Failed to parse or process argument ${quot(arg_name)} for method ${quot(method_name)} on interface ${quot(interface_name)}: ${message}`,
            },
            'interface_not_found': {
                status: 404,
                message: ({ interface_name }) => `Interface not found: ${quot(interface_name)}`,
            },
            'method_not_found': {
                status: 404,
                message: ({ interface_name, method_name }) => `Method not found: ${quot(method_name)} on interface ${quot(interface_name)}`,
            },
            'no_implementation_available': {
                status: 502,
                message: ({
                    iface,
                    interface_name,
                    driver
                }) => `No implementation available for ` +
                    (iface ?? interface_name) ? 'interface' : 'driver' +
                    ' ' + quot(iface ?? interface_name ?? driver) + '.',
            },
        });
    }
    
    /**
    * This method is responsible for registering collections in the service registry.
    * It registers 'interfaces', 'drivers', and 'types' collections.
    */
    async ['__on_registry.collections'] () {
        const svc_registry = this.services.get('registry');
        svc_registry.register_collection('interfaces');
        svc_registry.register_collection('drivers');
        svc_registry.register_collection('types');
    }
    /**
    * This method is responsible for initializing the collections in the driver service registry.
    * It registers 'interfaces', 'drivers', and 'types' collections.
    * It also populates the 'interfaces' collection with default interfaces and registers the collections with the driver service registry.
    */
    async ['__on_registry.entries'] () {
        const services = this.services;
        const svc_registry = services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        const col_drivers = svc_registry.get('drivers');
        const col_types = svc_registry.get('types');
        {
            const types = this.modules.types;
            for ( const k in types ) {
                col_types.set(k, types[k]);
            }
        }
        await services.emit('driver.register.interfaces',
            { col_interfaces });
        await services.emit('driver.register.drivers',
            { col_drivers });
    }
    
    // This is a bit meta: we register the "driver" driver interface.
    // This allows DriverService to be a driver called "driver".
    // The driver drivers allows checking metered usage for drivers,
    // and in the future may provide other driver-related functions.
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('driver', {
            description: 'provides functions for managing Puter drivers',
            methods: {
                usage: {
                    description: 'get usage information for drivers',
                    parameters: {},
                    result: { type: 'json' },
                }
            }
        });
    }
    
    register_driver (interface_name, implementation) {
        this.interface_to_implementation[interface_name] = implementation;
    }

    register_test_service (interface_name, service_name) {
        this.interface_to_test_service[interface_name] = service_name;
    }

    register_service_alias (service_name, alias) {
        this.service_aliases[alias] = service_name;
    }
    
    get_interface (interface_name) {
        const o = {};
        const col_interfaces = svc_registry.get('interfaces');
        const keys = col_interfaces.keys();
        for ( const k of keys ) o[k] = col_interfaces.get(k);
        return col_interfaces.get(interface_name);
    }
    
    get_default_implementation (interface_name) {
        // If there's a hardcoded implementation, use that
        // (^ temporary, until all are migrated)
        if (this.interface_to_implementation.hasOwnProperty(interface_name)) {
            return this.interface_to_implementation[interface_name];
        }
        
        return;
        this.log.noticeme('HERE IT IS');
        const options = this.services.get_implementors(interface_name);
        this.log.info('test', { options });
        if ( options.length < 1 ) return;
        return options[0];
    }


    /**
    * This method is responsible for calling the specified driver method with the given arguments.
    * It first processes the arguments to ensure they are in the correct format, then it checks if the driver and method exist,
    * and if the user has the necessary permissions to call them. If all checks pass, it calls the method and returns the result.
    * If any check fails, it throws an error or returns an error response.
    *
    * @param {Object} o - An object containing the driver name, interface name, method name, and arguments.
    * @returns {Promise<Object>} A promise that resolves to an object containing the result of the method call,
    *                           or rejects with an error if any check fails.
    */
    async call (o) {
        try {
            return await this._call(o);
        } catch ( e ) {
            this.log.error('Driver error response: ' + e.toString());
            if ( ! (e instanceof APIError) ) {
                this.errors.report('driver', {
                    source: e,
                    trace: true,
                });
            }
            return this._driver_response_from_error(e);
        }
    }


    /**
    * This method is responsible for making a call to a driver using its implementation and interface.
    * It handles various aspects such as argument processing, permission checks, and invoking the driver's method.
    * It returns a promise that resolves to an object containing the result, metadata, and an error if one occurred.
    */
    async _call ({ driver, iface, method, args }) {
        const processed_args = await this._process_args(iface, method, args);
        const test_mode = Context.get('test_mode');
        if ( test_mode ) {
            processed_args.test_mode = true;
        }

        const actor = Context.get('actor');
        if ( ! actor ) {
            throw Error('actor not found in context');
        }

        // There used to be only an 'interface' parameter but no 'driver'
        // parameter. To support outdated clients we use this hard-coded
        // table to map interfaces to default drivers.
        const iface_to_driver = {
            ['puter-ocr']: 'aws-textract',
            ['puter-tts']: 'aws-polly',
            ['puter-chat-completion']: 'openai-completion',
            ['puter-image-generation']: 'openai-image-generation',
            'puter-exec': 'judge0',
            'convert-files': 'convert-api',
            'puter-send-mail': 'user-send-mail',
            'puter-apps': 'es:app',
            'puter-subdomains': 'es:subdomain',
            'puter-notifications': 'es:notification',
        }
        
        driver = driver ?? iface_to_driver[iface] ?? iface;
        
        // For these ones, the interface specified actually specifies the
        // specificc driver to use.
        const iface_to_iface = {
            'puter-apps': 'crud-q',
            'puter-subdomains': 'crud-q',
            'puter-notifications': 'crud-q',
        }
        iface = iface_to_iface[iface] ?? iface;

        let skip_usage = false;
        if ( test_mode && this.interface_to_test_service[iface] ) {
            driver = this.interface_to_test_service[iface];
        }

        const client_driver_call = {
            intended_service: driver,
            response_metadata: {},
            test_mode,
        };
        driver = this.service_aliases[driver] ?? driver;


        /**
        * This method retrieves the driver service for the provided interface name.
        * It first checks if the driver service already exists in the registry,
        * and if not, it throws an error.
        *
        * @param {string} interfaceName - The name of the interface for which to retrieve the driver service.
        * @returns {DriverService} The driver service instance for the provided interface.
        */
        const driver_service_exists = (() => {
            return this.services.has(driver) &&
                this.services.get(driver).list_traits()
                    .includes(iface);
        })();

        if ( ! driver_service_exists ) {
            const svc_apiError = this.services.get('api-error');
            throw svc_apiError.create('no_implementation_available', { iface });
        }

        const service = this.services.get(driver);

        const caps = service.as('driver-capabilities');
        if ( test_mode && caps && caps.supports_test_mode(iface, method) ) {
            skip_usage = true;
        }
        
        const svc_event = this.services.get('event');
        const event = {};
        event.call_details = {
            service: driver,
            iface, method, args,
            skip_usage,
        };
        event.context = Context.sub({
            client_driver_call,
            call_details: event.call_details,
        });
        
        svc_event.emit('driver.create-call-context', event);
        
        const svc_trace = this.services.get('traceService');
        
        return await svc_trace.spanify(`driver:${driver}:${iface}:${method}`, async () => {
            return event.context.arun(async () => {
                const result = await this.call_new_({
                    actor,
                    service,
                    service_name: driver,
                    iface, method, args: processed_args,
                    skip_usage,
                });
                result.metadata = client_driver_call.response_metadata;
                return result;
            });
        });
    }
    

    /**
     * Reserved for future implementation of "best policy" selection.
     * For now, it just returns the first root option's path.
     */
    async get_policies_for_option_ (option) {
        // NOT FINAL: before implementing cascading monthly usage,
        // this return will be removed and the code below it will
        // be uncommented
        return option.path;
        /*
        const svc_systemData = this.services.get('system-data');
        const svc_su = this.services.get('su');
        
        const policies = await Promise.all(option.path.map(async path_node => {
            const policy = await svc_su.sudo(async () => {
                return await svc_systemData.interpret(option.data);
            });
            return {
                ...path_node,
                policy,
            };
        }));
        return policies;
        */
    }
    

    /**
     * Reserved for future implementation of "best policy" selection.
     * For now, this just returns the first option of a list of options.
     * 
     * @param {*} options 
     * @returns 
     */
    async select_best_option_ (options) {
        return options[0];
    }
    
    /**
    * This method is used to call a driver method with provided arguments.
    * It first processes the arguments to ensure they are of the correct type and format.
    * Then it checks if the method exists in the interface and if the driver service for that interface is available.
    * If the method exists and the driver service is available, it calls the method using the driver service.
    * If the method does not exist or the driver service is not available, it throws an error.
    * @param {object} o - Object containing driver, interface, method and arguments
    * @returns {Promise<object>} - Promise that resolves to an object containing the result of the driver method call
    */
    async call_new_ ({
        actor,
        service,
        service_name,
        iface, method, args,
        skip_usage,
    }) {
        if ( ! service ) {
            service = this.services.get(service_name);
        }

        const svc_permission = this.services.get('permission');
        const reading = await svc_permission.scan(
            actor,
            PermissionUtil.join('service', service_name, 'ii', iface),
        );
        const options = PermissionUtil.reading_to_options(reading);
        if ( options.length <= 0 ) {
            throw APIError.create('forbidden');
        }
        const option = await this.select_best_option_(options);
        const policies = await this.get_policies_for_option_(option);
        
        // NOT FINAL: For now we apply monthly usage logic
        // to the first holder of the permission. Later this
        // will be changed so monthly usage can cascade across
        // multiple actors. I decided not to implement this
        // immediately because it's a hefty time sink and it's
        // going to be some time before we can offer this feature
        // to the end-user either way.
        
        let effective_policy = null;
        for ( const policy of policies ) {
            if ( policy.holder ) {
                effective_policy = policy;
                break;
            }
        }
        
        if ( ! effective_policy ) {
            throw new Error(
                'policies with no effective user are not yet ' +
                'supported'
            );
        }

        const policy_holder = await get_user(
            { username: effective_policy.holder });

        // NOT FINAL: this will be handled by 'get_policies_for_option_'
        // when cascading monthly usage is implemented.
        const svc_systemData = this.services.get('system-data');
        const svc_su = this.services.get('su');
        effective_policy = await svc_su.sudo(async () => {
            return await svc_systemData.interpret(effective_policy.data);
        });
        
        effective_policy = effective_policy.policy;
        
        this.log.info('Invoking Driver Call', {
            service_name,
            iface,
            method,
            policy: effective_policy
        });
            
        const method_key = `V1:${service_name}:${iface}:${method}`;
            
        const invoker = Invoker.create({
            decorators: [
                {
                    name: 'enforce logical rate-limit',
                    on_call: async args => {
                        if ( ! effective_policy?.['rate-limit'] ) return args;
                        const svc_su = this.services.get('su');
                        const svc_rateLimit = this.services.get('rate-limit');

                        await svc_su.sudo(policy_holder, async () => {
                            await svc_rateLimit.check_and_increment(
                                `V1:${service_name}:${iface}:${method}`,
                                effective_policy['rate-limit'].max,
                                effective_policy['rate-limit'].period,
                            );
                        });
                        return args;
                    },
                },
                {
                    name: 'add metadata',
                    on_return: async result => {
                        const service_meta = {};
                        if ( service.list_traits().includes('version') ) {
                            service_meta.version = service.as('version').get_version();
                        }
                        return {
                            success: true,
                            service: {
                                ...service_meta,
                                name: service_name,
                            },
                            result,
                        };
                    },
                },
                {
                    name: 'result coercion',
                    on_return: async (result) => {
                        if ( result instanceof TypedValue ) {
                            const svc_registry = this.services.get('registry');
                            const c_interfaces = svc_registry.get('interfaces');

                            const interface_ = c_interfaces.get(iface);
                            const method_spec = interface_.methods[method];
                            let desired_type =
                                method_spec.result_choices
                                    ? method_spec.result_choices[0].type
                                    : method_spec.result.type
                                    ;
                            const svc_coercion = services.get('coercion');
                            result = await svc_coercion.coerce(desired_type, result);
                        }
                        return result;
                    },
                },
            ],
            delegate: async (args) => {
                return await service.as(iface)[method](args);
            },
        });
        return await invoker.run(args);
    }
    

    /**
     * This method converts an error into an appropriate driver response.
     */
    async _driver_response_from_error (e, meta) {
        let serializable = (e instanceof APIError) || (e instanceof DriverError);
        return {
            success: false,
            ...meta,
            error: serializable ? e.serialize() : e.message,
        };
    }

    /**
     * Processes arguments according to the argument types specified
     * on the interface (in interfaces.js). The behavior of types is
     * defined in types.js
     * @param {*} interface_name - the name of the interface
     * @param {*} method_name - the name of the method
     * @param {*} args - raw argument values from request body
     * @returns 
     */
    async _process_args (interface_name, method_name, args) {
        const svc_registry = this.services.get('registry');
        const c_interfaces = svc_registry.get('interfaces');
        const c_types = svc_registry.get('types');
        
        const svc_apiError = this.services.get('api-error');

        // Note: 'interface' is a strict mode reserved word.
        const interface_ = c_interfaces.get(interface_name);
        if ( ! interface_ ) {
            throw svc_apiError.create('interface_not_found', { interface_name });
        }

        const processed_args = {};
        const method = interface_.methods[method_name];
        if ( ! method ) {
            throw svc_apiError.create('method_not_found', { interface_name, method_name });
        }

        if ( method.hasOwnProperty('default_parameter') && whatis(args) !== 'object' ) {
            args = { [method.default_parameter]: args };
        }

        
        for ( const [arg_name, arg_descriptor] of Object.entries(method.parameters) ) {
            const arg_value = arg_name === '*' ? args : args[arg_name];
            const arg_behaviour = c_types.get(arg_descriptor.type);

            // TODO: eventually put this in arg behaviour base class.
            // There's a particular way I want to do this that involves
            // a trait for extensible behaviour.
            if ( arg_value === undefined && arg_descriptor.required ) {
                throw svc_apiError.create('missing_required_argument', {
                    interface_name,
                    method_name,
                    arg_name,
                });
            }

            const ctx = Context.get();

            try {
                processed_args[arg_name] = await arg_behaviour.consolidate(
                    ctx, arg_value, { arg_descriptor, arg_name });
            } catch ( e ) {
                throw svc_apiError.create('argument_consolidation_failed', {
                    interface_name,
                    method_name,
                    arg_name,
                    message: e.message,
                });
            }
        }
        
        if ( typeof processed_args['*'] ==='object' ) {
            for ( const k in processed_args['*'] ) {
                processed_args[k] = processed_args['*'][k];
            }
            delete processed_args['*'];
        }

        return processed_args;
    }
}

module.exports = {
    DriverService,
};
