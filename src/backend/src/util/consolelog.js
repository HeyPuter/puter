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
class ConsoleLogManager {
    static instance_;

    static getInstance () {
        if ( this.instance_ ) return this.instance_;
        return this.instance_ = new ConsoleLogManager();
    }

    static CONSOLE_METHODS = [
        'log', 'error', 'warn',
    ];

    static PROXY_METHOD = function (method, ...args) {
        const decorators = this.get_log_decorators_(method);

        // TODO: Add this feature later
        // const pre_listeners = self.get_log_pre_listeners_(method);
        // const post_listeners = self.get_log_post_listeners_(method);

        const replace = (...newargs) => {
            args = newargs;
        };
        for ( const dec of decorators ) {
            dec({
                manager: this,
                replace,
            }, ...args);
        }

        this.__original_methods[method](...args);

        const post_hooks = this.get_post_hooks_(method);
        for ( const fn of post_hooks ) {
            fn();
        }
    };

    get_log_decorators_ (method) {
        return this.__log_decorators[method];
    }

    get_post_hooks_ (method) {
        return this.__log_hooks_post[method];
    }

    constructor () {
        const THIS = this.constructor;
        this.__original_console = console;
        this.__original_methods = {};
        for ( const k of THIS.CONSOLE_METHODS ) {
            this.__original_methods[k] = console[k];
        }
        this.__proxy_methods = {};
        this.__log_decorators = {};
        this.__log_hooks_post = {};

        // TODO: Add this feature later
        // this.__log_pre_listeners = {};
        // this.__log_post_listeners = {};
    }

    initialize_proxy_methods (methods) {
        const THIS = this.constructor;
        methods = methods || THIS.CONSOLE_METHODS;
        for ( const k of methods ) {
            this.__proxy_methods[k] = THIS.PROXY_METHOD.bind(this, k);
            console[k] = this.__proxy_methods[k];
            this.__log_decorators[k] = [];
            this.__log_hooks_post[k] = [];
        }
    }

    decorate (method, dec_fn) {
        this.__log_decorators[method] = dec_fn;
    }

    decorate_all (dec_fn) {
        const THIS = this.constructor;
        for ( const k of THIS.CONSOLE_METHODS ) {
            this.__log_decorators[k].push(dec_fn);
        }
    }

    post_all (post_fn) {
        const THIS = this.constructor;
        for ( const k of THIS.CONSOLE_METHODS ) {
            this.__log_hooks_post[k].push(post_fn);
        }
    }

    log_raw (method, ...args) {
        this.__original_methods[method](...args);
    }
}

module.exports = {
    consoleLogManager: ConsoleLogManager.getInstance(),
};
