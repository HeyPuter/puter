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
const { Context } = require("../util/context");
const BaseService = require("./BaseService");

// DRY: (2/3) - src/util/context.js; move install() to base class
class ContextInitExpressMiddleware {
    constructor () {
        this.value_initializers_ = [];
    }
    register_initializer (initializer) {
        this.value_initializers_.push(initializer);
    }
    install (app) {
        app.use(this.run.bind(this));
    }
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

class ContextInitService extends BaseService {
    _construct () {
        this.mw = new ContextInitExpressMiddleware();
    }
    register_value (key, value) {
        this.mw.register_initializer({
            key, value,
        });
    }
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