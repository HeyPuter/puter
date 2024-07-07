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
const config = require("../config");
const { Context } = require("../util/context");
const { CompositeError } = require("../util/errorutil");
const { TeePromise } = require("../util/promise");

// 17 lines of code instead of an entire dependency-injection framework
class Container {
    constructor ({ logger }) {
        this.logger = logger;
        this.instances_ = {};
        this.ready = new TeePromise();
    }
    /**
     * registerService registers a service with the servuces container.
     * 
     * @param {String} name - the name of the service
     * @param {BaseService.constructor} cls - an implementation of BaseService
     * @param {Array} args - arguments to pass to the service constructor
     */
    registerService (name, cls, args) {
        const my_config = config.services?.[name] || {};
        this.instances_[name] = cls.getInstance
            ? cls.getInstance({ services: this, config, my_config, name, args })
            : new cls({ services: this, config, my_config, name, args }) ;
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
    set (name, instance) { this.instances_[name] = instance; }
    get (name, opts) {
        if ( this.instances_[name] ) {
            return this.instances_[name];
        }
        if ( ! opts?.optional ) {
            throw new Error(`missing service: ${name}`);
        }
    }
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

    async init () {
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

    async emit (id, ...args) {
        if ( this.logger ) {
            this.logger.noticeme(`services:event ${id}`, { args });
        }
        const promises = [];
        for ( const k in this.instances_ ) {
            if ( this.instances_[k].__on ) {
                promises.push(this.instances_[k].__on(id, args));
            }
        }
        await Promise.all(promises);
    }
}

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
