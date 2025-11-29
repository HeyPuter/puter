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
const { AsyncLocalStorage } = require('async_hooks');
const context_config = {};

class Context {
    static USE_NAME_FALLBACK = {};
    static next_name_ = 0;
    static other_next_names_ = {};

    // Context hooks should be registered via service (ContextService.js)
    static context_hooks_ = {
        pre_create: [],
        post_create: [],
        pre_arun: [],
    };

    static contextAsyncLocalStorage = new AsyncLocalStorage();
    static __last_context_key = 0;
    static make_context_key (opt_human_readable) {
        let k = `_:${++this.__last_context_key}`;
        if ( opt_human_readable ) {
            k += `:${opt_human_readable}`;
        }
        return k;
    }
    static create (values, opt_name) {
        return new Context(values, undefined, opt_name);
    }
    static get (key, { allow_fallback } = {}) {
        const existingContext = this.contextAsyncLocalStorage.getStore()?.get('context');
        if ( ! existingContext ) {
            if ( context_config.strict && !allow_fallback ) {
                throw new Error('FAILED TO GET THE CORRECT CONTEXT');
            }
            const rootFallback =  this.root.sub({}, this.USE_NAME_FALLBACK);
            if ( key ) {
                return rootFallback.get(key);
            }
            return rootFallback;
        }
        if ( key ) {
            return existingContext.get(key);
        }
        return existingContext;
    }
    static set (k, v) {
        const x = this.contextAsyncLocalStorage.getStore()?.get('context');
        if ( x ) return x.set(k, v);
    }
    static root = new Context({}, undefined, 'root');
    static describe () {
        return this.get().describe();
    }
    static arun (...a) {
        return this.get().arun(...a);
    }
    static sub (values, opt_name) {
        return this.get().sub(values, opt_name);
    }

    #dead = false;

    /**
     * Clears this context's values and unlinks from its parent. This context
     * will become empty. This is to ensure contexts that aren't used anymore
     * get garbage collected. This was added to prevent memory leaks due to
     * ECMAP, where currently we're not sure what's holding a reference back
     * to the ECMAP (or perhaps its subcontext).
     */
    unlink () {
        // Settings `values_` to an empty object should clear any references
        // that were inside it while avoiding errors if .get() happens to be
        // called by a lingering asynchronous function.
        this.values_ = {};
        this.#dead = true;
    }

    get (k) {
        return this.values_[k];
    }
    set (k, v) {
        if ( this.#dead ) return;
        this.values_[k] = v;
    }
    sub (values, opt_name) {
        if ( typeof values === 'string' ) {
            opt_name = values;
            values = {};
        }
        const name = opt_name ?? this.name ?? this.get('name');
        for ( const hook of this.constructor.context_hooks_.pre_create ) {
            hook({ values, name });
        }
        return new Context(values, this, opt_name);
    }
    get values () {
        return this.values_;
    }

    /**
     * @untested
     */
    get_proxy_object () {
        return new Proxy(this.values_, {
            get: (target, prop) => {
                return this.get(prop);
            },
            set: (target, prop, value) => {
                this.set(prop, value);
                return true;
            },
        });
    }

    constructor (imm_values, opt_parent, opt_name) {
        const values = { ...imm_values };
        imm_values = null;

        opt_parent = opt_parent || Context.root;

        this.trace_name = opt_name ?? undefined;
        this.name = (() => {
            if ( opt_name === this.constructor.USE_NAME_FALLBACK ) {
                opt_name = 'F';
            }
            if ( opt_name ) {
                const name_numbers = this.constructor.other_next_names_;
                if ( ! Object.prototype.hasOwnProperty.call(name_numbers, opt_name) ) {
                    name_numbers[opt_name] = 0;
                }
                const num = ++name_numbers[opt_name];
                return `{${opt_name}:${num}}`;
            }
            return `${++this.constructor.next_name_}`;
        })();
        this.parent_ = opt_parent;

        if ( opt_parent ) {
            Object.setPrototypeOf(values, opt_parent.values_);
            for ( const k in values ) {
                const parent_val = opt_parent.values_[k];
                if ( parent_val instanceof Context ) {
                    if ( ! (values[k] instanceof Context) ) {
                        values[k] = parent_val.sub(values[k]);
                    }
                }
            }
        }

        this.values_ = values;
    }
    async arun (...args) {
        let cb = args.shift();

        let hints = {};
        if ( typeof cb === 'object' ) {
            hints = cb;
            cb = args.shift();
        }

        if ( typeof cb === 'string' ) {
            const sub_context = this.sub(cb);
            return await sub_context.arun({ trace: true }, ...args);
        }

        const replace_callback = new_cb => {
            cb = new_cb;
        };

        for ( const hook of this.constructor.context_hooks_.pre_arun ) {
            hook({
                hints,
                name: this.name ?? this.get('name'),
                trace_name: this.trace_name,
                replace_callback,
                callback: cb,
            });
        }

        const als = this.constructor.contextAsyncLocalStorage;
        return await als.run(new Map(), async () => {
            als.getStore().set('context', this);
            return await cb();
        });
    }
    abind (cb) {
        return async (...args) => {
            return await this.arun(async () => {
                return await cb(...args);
            });
        };
    }

    describe () {
        return `Context(${this.describe_()})`;
    }
    describe_ () {
        if ( ! this.parent_ ) return '[R]';
        return `${this.parent_.describe_()}->${this.name}`;
    }

    static async allow_fallback (cb) {
        const x = this.get(undefined, { allow_fallback: true });
        return await x.arun(async () => {
            return await cb();
        });
    }
}

const uuidv4 = require('uuid').v4;

class ContextExpressMiddleware {
    constructor ({ parent }) {
        this.parent_ = parent;
    }
    install (app) {
        app.use(this.run.bind(this));
    }
    async run (req, res, next) {
        return await this.parent_.sub({
            req,
            res,
            trace_request: uuidv4(),
        }, 'req').arun(async () => {
            const ctx = Context.get();
            req.ctx = ctx;
            res.locals.ctx = ctx;
            next();
        });
    }
}

module.exports = {
    Context,
    ContextExpressMiddleware,
    context_config,
};
