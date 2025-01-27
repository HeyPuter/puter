// METADATA // {"ai-commented":{"service":"claude"}}
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
const { Context } = require("../util/context");
const BaseService = require("./BaseService");

// DRY: (2/3) - src/util/context.js; move install() to base class
/**
* @class ContextInitExpressMiddleware
* @description Express middleware that initializes context values for requests.
* Manages a collection of value initializers that can be synchronous values
* or asynchronous factory functions. Each initializer sets a key-value pair
* in the request context. Part of a DRY implementation shared with context.js.
* TODO: Consider moving install() method to base class.
*/
class ContextInitExpressMiddleware {
    /**
    * Express middleware class that initializes context values for requests
    * 
    * Manages a list of value initializers that populate the Context with
    * either static values or async-generated values when handling requests.
    * Part of DRY pattern with src/util/context.js.
    */
    constructor () {
        this.value_initializers_ = [];
    }
    register_initializer (initializer) {
        this.value_initializers_.push(initializer);
    }
    install (app) {
        app.use(this.run.bind(this));
    }
    /**
    * Installs the middleware into the Express application
    * @param {Express} app - The Express application instance
    * @returns {void}
    */
    async run (req, res, next) {
        const x = Context.get();
        for ( const initializer of this.value_initializers_ ) {
            if ( initializer.value ) {
                x.set(initializer.key, initializer.value);
            } else if ( initializer.async_factory ) {
                x.set(initializer.key, await initializer.async_factory());
            }
        }
        next();
    }
}


/**
* @class ContextInitService
* @extends BaseService
* @description Service responsible for initializing and managing context values in the application.
* Provides methods to register both synchronous values and asynchronous factories for context
* initialization. Works in conjunction with Express middleware to ensure proper context setup
* for each request. Extends BaseService to integrate with the application's service architecture.
*/
class ContextInitService extends BaseService {
    /**
    * Service for initializing request context with values and async factories.
    * Extends BaseService to provide middleware for Express that populates the Context
    * with registered values and async-generated values at the start of each request.
    * 
    * @extends BaseService
    */
    _construct () {
        this.mw = new ContextInitExpressMiddleware();
    }
    register_value (key, value) {
        this.mw.register_initializer({
            key, value,
        });
    }
    /**
    * Registers an asynchronous factory function to initialize a context value
    * @param {string} key - The key to store the value under in the context
    * @param {Function} async_factory - Async function that returns the value to store
    */
    register_async_factory (key, async_factory) {
        this.mw.register_initializer({
            key, async_factory,
        });
    }
    async ['__on_install.middlewares.context-aware'] (_, { app }) {
        this.mw.install(app);
        await this.services.emit('install.context-initializers');
    }
}

module.exports = {
    ContextInitService
};