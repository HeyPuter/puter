// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { Context } = require("../../util/context");
const APIError = require("../../api/APIError");
const { DriverError } = require("./DriverError");
const { TypedValue } = require("./meta/Runtime");
const BaseService = require("../BaseService");
const { Driver } = require("../../definitions/Driver");
const { PermissionUtil } = require("../auth/PermissionService");
const { Invoker } = require("../../../../putility/src/libs/invoker");
const { get_user } = require("../../helpers");

/**
 * DriverService provides the functionality of Puter drivers.
 * This class is responsible for managing and interacting with Puter drivers.
 * It provides methods for registering drivers, calling driver methods, and handling driver errors.
 */
class DriverService extends BaseService {
    static MODULES = {
        types: require('./types'),
    }


    /**
    * @description This method is responsible for registering collections in the registry service.
    * It registers 'interfaces', 'drivers', and 'types' collections.
    * It also populates the 'interfaces' and 'types' collections with default interfaces and types.
    * @returns {void}
    */
    // Add this comment above line 37, before the method definition.
    _construct () {
        this.drivers = {};
        this.interface_to_implementation = {};
        this.interface_to_test_service = {};
        this.service_aliases = {};
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
            const default_interfaces = require('./interfaces');
            for ( const k in default_interfaces ) {
                col_interfaces.set(k, default_interfaces[k]);
            }
        }
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
    

    /**
    * This method is responsible for calling a driver's method with provided arguments.
    * It checks for permissions, selects the best option, and applies rate and monthly usage limits before invoking the driver.
    *
    * @param {Object} o - An object containing driver, interface, method, and arguments.
    * @returns {Promise<{success: boolean, service: DriverService.Driver, result: any, metadata: any}>}
    */
    _init () {
        const svc_registry = this.services.get('registry');
        svc_registry.register_collection('');
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
        console.log('??', driver, iface, method, args);
        const processed_args = await this._process_args(iface, method, args);
        const test_mode = Context.get('test_mode');
        if ( test_mode ) {
            processed_args.test_mode = true;
        }

        const actor = Context.get('actor');
        if ( ! actor ) {
            throw Error('actor not found in context');
        }

        const services = Context.get('services');
        const svc_permission = services.get('permission');


        const svc_registry = this.services.get('registry');
        const c_interfaces = svc_registry.get('interfaces');

        // There used to be only an 'interface' parameter but no 'driver'
        // parameter. To support outdated clients we use this hard-coded
        // table to map interfaces to default drivers.
        const iface_to_driver = {
            ['puter-ocr']: 'aws-textract',
            ['puter-tts']: 'aws-polly',
            ['puter-chat-completion']: 'openai-completion',
            ['puter-image-generation']: 'openai-image-generation',
        }
        
        driver = driver ?? iface_to_driver[iface] ?? iface;

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
        * and if not, it creates a new instance of the driver service and registers it.
        *
        * @param {string} interfaceName - The name of the interface for which to retrieve the driver service.
        * @returns {DriverService} The driver service instance for the provided interface.
        */
        const driver_service_exists = (() => {
            console.log('CHECKING FOR THIS', driver, iface);
            return this.services.has(driver) &&
                this.services.get(driver).list_traits()
                    .includes(iface);
        })();
        if ( driver_service_exists ) {
            const service = this.services.get(driver);

            const caps = service.as('driver-capabilities');
            if ( test_mode && caps && caps.supports_test_mode(iface, method) ) {
                skip_usage = true;
            }
            
            return await Context.sub({
                client_driver_call,
            }).arun(async () => {
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
        }

        const reading = await svc_permission.scan(actor, `driver:${iface}:${method}`);
        const options = PermissionUtil.reading_to_options(reading);
        if ( ! (options.length > 0) ) {
            throw APIError.create('permission_denied');
        }

        const instance = this.get_default_implementation(iface);
        if ( ! instance ) {
            throw APIError.create('no_implementation_available', null, { iface })
        }
        /**
        * This method is responsible for calling a driver method. It performs various checks and preparations before making the actual call.
        * It first checks if the driver service exists for the given driver and interface. If it does, it checks if the driver supports the test mode. If it does, it skips the usage of the driver.
        * If the driver service does not exist, it looks for a default implementation for the given interface and uses it if found.
        * The method then calls the driver method with the processed arguments and returns the result. If an error occurs during the call, it is caught and handled accordingly.
        *
        * @param {Object} o - An object containing the driver name, interface name, method name, and arguments.
        * @returns {Promise<Object>} - A promise that resolves to an object containing the result of the driver method call, or an error object if an error occurred.
        */
        const meta = await (async () => {
            if ( instance instanceof Driver ) {
                return await instance.get_response_meta();
            }
            if ( ! instance.instance.as('driver-metadata') ) return;
            const t = instance.instance.as('driver-metadata');
            return t.get_response_meta();
        })();
        try {
            let result;
            if ( instance instanceof Driver ) {
                result = await instance.call(
                    method, processed_args);
            } else {
                // TODO: SLA and monthly limits do not apply do drivers
                //       from service traits (yet)
                result = await instance.impl[method](processed_args);
            }
            if ( result instanceof TypedValue ) {
                const interface_ = c_interfaces.get(iface);
                let desired_type = interface_.methods[method]
                    .result_choices[0].type;
                const svc_coercion = services.get('coercion');
                result = await svc_coercion.coerce(desired_type, result);
                // meta.type = result.type.toString(),
            }
            return { success: true, ...meta, result };
        } catch ( e ) {
            let for_user = (e instanceof APIError) || (e instanceof DriverError);
            if ( ! for_user ) this.errors.report(`driver:${iface}:${method}`, {
                source: e,
                trace: true,
                // TODO: alarm will not be suitable for all errors.
                alarm: true,
                extra: {
                    args,
                }
            });
            this.log.error('Driver error response: ' + e.toString());
            return this._driver_response_from_error(e, meta);
        }
    }
    

    /**
    * This method is used to call a specific method on a driver implementation.
    * It takes in an object containing the driver name, interface name, method name, and arguments, and returns the result of the call.
    * It also handles error cases, such as missing required arguments, and returns appropriate error messages.
    * @param {object} o - An object containing the driver name, interface name, method name, and arguments.
    * @return {Promise<object>} - A promise that resolves to an object containing the result of the call, or an error object if an error occurred.
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
    * Description: This method is responsible for handling driver calls. It takes an object containing the driver name, interface name, method name, and arguments, and calls the corresponding method in the driver implementation.
    * Behavior: The method first checks if the driver service exists for the given driver name and interface name. If it does, it calls the method in the driver implementation with the provided arguments. If the method is not found, it throws an error. If the driver service does not exist, it throws an error.
    * Parameters: The method takes an object containing the driver name, interface name, method name, and arguments.
    * Return Value: The method returns a promise that resolves with an object containing the result of the method call, the metadata of the driver call, and a boolean indicating whether the call was successful.
    */
    // Add this comment above line 276 in DriverService.js
    async select_best_option_ (options) {
        return options[0];
    }
    
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
        console.log({
            perm: PermissionUtil.join('service', service_name, 'ii', iface),
            reading,
        });
        const options = PermissionUtil.reading_to_options(reading);
        if ( options.length <= 0 ) {
            throw APIError.create('forbidden');
        }
        const option = await this.select_best_option_(options);
        const policies = await this.get_policies_for_option_(option);
        console.log('SLA', JSON.stringify(policies, undefined, '  '));
        
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
        /**
        * This method is used to call a driver method with provided arguments.
        * It first processes the arguments to ensure they are of the correct type and format.
        * Then it checks if the method exists in the interface and if the driver service for that interface is available.
        * If the method exists and the driver service is available, it calls the method using the driver service.
        * If the method does not exist or the driver service is not available, it throws an error.
        * @param {object} o - Object containing driver, interface, method and arguments
        * @returns {Promise<object>} - Promise that resolves to an object containing the result of the driver method call
        */
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
                        /**
                        * This method is used to initialize a driver instance with the provided options.
                        * It sets up the necessary dependencies and configurations for the driver to function correctly.
                        *
                        * @param {DriverService} driverService - The instance of the driver service.
                        * @param {Object} options - An object containing the options for the driver instance, such as the driver's implementation, test service, and service aliases.
                        */
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
                    name: 'enforce monthly usage limit',
                    on_call: async args => {
                        if ( skip_usage ) return args;

                        // Typo-Tolerance
                        if ( effective_policy?.['monthy-limit'] ) {
                            effective_policy['monthly-limit'] = effective_policy['monthy-limit'];
                        }

                        if ( ! effective_policy?.['monthly-limit'] ) return args;
                        const svc_monthlyUsage = services.get('monthly-usage');
                        const count = await svc_monthlyUsage.check_2(
                            actor, method_key, 0
                        );
                        if ( count >= effective_policy['monthly-limit'] ) {
                            throw APIError.create('monthly_limit_exceeded', null, {
                                method_key,
                                limit: effective_policy['monthly-limit'],
                            });
                        }
                        return args;
                    },
                    on_return: async result => {
                        if ( skip_usage ) return result;

                        console.log('monthly usage is returning');
                        const svc_monthlyUsage = services.get('monthly-usage');
                        const extra = {
                            'driver.interface': iface,
                            'driver.implementation': service_name,
                            'driver.method': method,
                        };
                        console.log('calling the increment method')
                        await svc_monthlyUsage.increment(actor, method_key, extra);
                        return result;
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

                            console.log('????--1', iface);
                            const interface_ = c_interfaces.get(iface);
                            console.log('????--2', interface_);
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
    * This method is responsible for handling driver calls and returns the result or an error message.
    * It takes a call object with the driver name, interface name, method name, and arguments as input.
    * The method first checks if the driver and interface exist, then it checks if the user has the required permissions.
    * If the user has the required permissions, it calls the method on the driver and returns the result.
    * If the user does not have the required permissions, it throws an APIError with the 'forbidden' message.
    * If there's an error while calling the method, it throws the error.
    * If the method returns a TypedValue, it coerces the result to the desired type.
    * If the method returns an error, it serializes the error and returns it with the original metadata.
    * @param {Object} call - The call object with driver name, interface name, method name, and arguments.
    * @returns {Object} The result of the method call or an error object.
    */
    // Add this comment above line 456.
    async _driver_response_from_error (e, meta) {
        let serializable = (e instanceof APIError) || (e instanceof DriverError);
        return {
            success: false,
            ...meta,
            error: serializable ? e.serialize() : e.message,
        };
    }


    /**
    * This method is responsible for registering collections in the service registry.
    * It registers 'interfaces', 'drivers', and 'types' collections.
    */
    // Above line 465
    async list_interfaces () {
        return this.interfaces;
    }


    /**
    * This method is responsible for registering collections in the service registry.
    * It registers 'interfaces', 'drivers', and 'types' collections.
    *
    * @returns {void}
    */
    // line 469
    async _process_args (interface_name, method_name, args) {
        const svc_registry = this.services.get('registry');
        const c_interfaces = svc_registry.get('interfaces');
        const c_types = svc_registry.get('types');

        // Note: 'interface' is a strict mode reserved word.
        const interface_ = c_interfaces.get(interface_name);
        if ( ! interface_ ) {
            throw APIError.create('interface_not_found', null, { interface_name });
        }

        const processed_args = {};
        const method = interface_.methods[method_name];
        if ( ! method ) {
            throw APIError.create('method_not_found', null, { interface_name, method_name });
        }
        
        for ( const [arg_name, arg_descriptor] of Object.entries(method.parameters) ) {
            const arg_value = args[arg_name];
            const arg_behaviour = c_types.get(arg_descriptor.type);

            // TODO: eventually put this in arg behaviour base class.
            // There's a particular way I want to do this that involves
            // a trait for extensible behaviour.
            if ( arg_value === undefined && arg_descriptor.required ) {
                throw APIError.create('missing_required_argument', null, {
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
                throw APIError.create('argument_consolidation_failed', null, {
                    interface_name,
                    method_name,
                    arg_name,
                    message: e.message,
                });
            }
        }

        return processed_args;
    }
}

module.exports = {
    DriverService,
};
