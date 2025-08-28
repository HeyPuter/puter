// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const config = require("../config");
const { Context } = require("../util/context");
const { CompositeError } = require("../util/errorutil");
const { TeePromise } = require('@heyputer/putility').libs.promise;

// 17 lines of code instead of an entire dependency-injection framework
/**
* The `Container` class is a lightweight dependency-injection container designed to manage
* service instances within the application. It provides functionality for registering,
* retrieving, and managing the lifecycle of services, including initialization and event
* handling. This class is intended to simplify dependency management and ensure that services
* are properly initialized and available throughout the application.
*
* @class
*/
class Container {
    constructor ({ logger }) {
        this.logger = logger;
        this.instances_ = {};
        this.implementors_ = {};
        this.ready = new TeePromise();
        
        this.modname_ = null;
        this.modules_ = {}
    }
    
    registerModule (name, module) {
        this.modules_[name] = {
            services_l: [],
            services_m: {},
            module
        };
        this.setModuleName(name);
    }
    
    /**
     * Sets the name of the current module registering services.
     * 
     * Note: this is an antipattern; it would be a bit better to
     * provide the module name while registering a service, but
     * this requires making an implementor of Container's interface
     * with this as a hidden variable so as not to break existing
     * modules.
     */
    setModuleName (name) {
        this.modname_ = name;
    }

    /**
     * registerService registers a service with the services container.
     * 
     * @param {String} name - the name of the service
     * @param {BaseService.constructor} cls - an implementation of BaseService
     * @param {Array} args - arguments to pass to the service constructor
     */
    registerService (name, cls, args) {
        const my_config = config.services?.[name] || {};
        const instance = cls.getInstance
            ? cls.getInstance({ services: this, config, my_config, name, args })
            : new cls({
                context: Context.get(),
                services: this, config, my_config, name, args
            }) ;
        this.instances_[name] = instance;
        
        if ( this.modname_ ) {
            const mod_entry = this.modules_[this.modname_];
            mod_entry.services_l.push(name);
            mod_entry.services_m[name] = true;
        }
        
        if ( !(instance instanceof AdvancedBase) ) return;
        
        const traits = instance.list_traits();
        for ( const trait of traits ) {
            if ( ! this.implementors_[trait] ) {
                this.implementors_[trait] = [];
            }
            this.implementors_[trait].push({
                name,
                instance,
                impl: instance.as(trait),
            });
        }
    }
    /**
     * patchService allows overriding methods on a service that is already
     * constructed and initialized.
     * 
     * @param {String} name - the name of the service to patch
     * @param {ServicePatch.constructor} patch - the patch
     * @param {Array} args - arguments to pass to the patch
     */
    patchService (name, patch, args) {
        const original_service = this.instances_[name];
        const patch_instance = new patch();
        patch_instance.patch({ original_service, args });
    }
    
    // get_implementors returns a list of implementors for the specified
    // interface name.
    get_implementors (interface_name) {
        const internal_list = this.implementors_[interface_name];
        const clone = [...internal_list];
        return clone;
    }
    
    set (name, instance) { this.instances_[name] = instance; }
    get (name, opts) {
        if ( this.instances_[name] ) {
            return this.instances_[name];
        }
        if ( ! opts?.optional ) {
            throw new Error(`missing service: ${name}`);
        }
    }
    /**
    * Checks if a service is registered in the container.
    *
    * @param {String} name - The name of the service to check.
    * @returns {Boolean} - Returns true if the service is registered, false otherwise.
    */
    has (name) { return !! this.instances_[name]; }
    get values () {
        const values = {};
        for ( const k in this.instances_ ) {
            let k2 = k;

            // Replace lowerCamelCase with underscores
            // (just an idea; more effort than it's worth right now)
            // let k2 = k.replace(/([a-z])([A-Z])/g, '$1_$2')

            // Replace dashes with underscores
            k2 = k2.replace(/-/g, '_');
            // Convert to lower case
            k2 = k2.toLowerCase();

            values[k2] = this.instances_[k];
        }
        return this.instances_;
    }


    /**
    * Initializes all registered services in the container.
    *
    * This method first constructs each service by calling its `construct` method,
    * and then initializes each service by calling its `init` method. If any service
    * initialization fails, it logs the failures and throws a `CompositeError`
    * containing details of all failed initializations.
    *
    * @returns {Promise<void>} A promise that resolves when all services are
    * initialized or rejects if any service initialization fails.
    */
    async init () {
        for ( const k in this.instances_ ) {
            if ( ! this.instances_[k]._run_as_early_as_possible ) continue;
            this.logger.info(`very early hooks for ${k}`);
            await this.instances_[k].run_as_early_as_possible();
        }
        for ( const k in this.instances_ ) {
            this.logger.info(`constructing ${k}`);
            await this.instances_[k].construct();
        }
        const init_failures = [];
        for ( const k in this.instances_ ) {
            this.logger.info(`initializing ${k}`);
            try {
                await this.instances_[k].init();
            } catch (e) {
                init_failures.push({ k, e });
            }
        }

        if ( init_failures.length ) {
            console.error('init failures', init_failures);
            throw new CompositeError(
                `failed to initialize these services: ` +
                init_failures.map(({ k }) => k).join(', '),
                init_failures.map(({ k, e }) => e)
            );
        }
    }


    /**
    * Emits an event to all registered services.
    *
    * This method sends an event identified by `id` along with any additional arguments to all
    * services registered in the container. If a logger is available, it logs the event.
    *
    * @param {string} id - The identifier of the event.
    * @param {...*} args - Additional arguments to pass to the event handler.
    * @returns {Promise<void>} A promise that resolves when all event handlers have completed.
    */
    async emit (id, ...args) {
        if ( this.logger ) {
            this.logger.info(`services:event ${id}`, { args });
        }

        const promises = [];
        for ( const k in this.instances_ ) {
            if ( this.instances_[k].__on ) {
                promises.push(Context.arun(() => this.instances_[k].__on(id, args)));
            }
        }
        await Promise.all(promises);
    }
}


/**
* @class ProxyContainer
* @classdesc The ProxyContainer class is a proxy for the Container class, allowing for delegation of service management tasks.
* It extends the functionality of the Container class by providing a delegation mechanism.
* This class is useful for scenarios where you need to manage services through a proxy,
* enabling additional flexibility and control over service instances.
*/
class ProxyContainer {
    constructor (delegate) {
        this.delegate = delegate;
        this.instances_ = {};
    }
    set (name, instance) {
        this.instances_[name] = instance;
    }
    get (name) {
        if ( this.instances_.hasOwnProperty(name) ) {
            return this.instances_[name];
        }
        return this.delegate.get(name);
    }
    /**
    * Checks if the container has a service with the specified name.
    *
    * @param {string} name - The name of the service to check.
    * @returns {boolean} - Returns true if the service exists, false otherwise.
    */
    has (name) {
        if ( this.instances_.hasOwnProperty(name) ) {
            return true;
        }
        return this.delegate.has(name);
    }
    get values () {
        const values = {};
        Object.assign(values, this.delegate.values);
        for ( const k in this.instances_ ) {
            let k2 = k;

            // Replace lowerCamelCase with underscores
            // (just an idea; more effort than it's worth right now)
            // let k2 = k.replace(/([a-z])([A-Z])/g, '$1_$2')

            // Replace dashes with underscores
            k2 = k2.replace(/-/g, '_');
            // Convert to lower case
            k2 = k2.toLowerCase();

            values[k2] = this.instances_[k];
        }
        return values;
    }
}

module.exports = { Container, ProxyContainer };
