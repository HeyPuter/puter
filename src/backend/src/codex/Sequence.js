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

/**
 * @typedef {Object} A
 * @property {(key: string) => unknown} get - Get a value from the sequence scope.
 * @property {function(string, any): void} set - Set a value in the sequence scope.
 * @property {(valsToSet?: T) => T extends undefined ? unknown : T} values - Get or set multiple values in the sequence scope.
 * @property {function(string=): any} iget - Get a value from the instance (thisArg).
 * @property {(methodName: string, ...params: any[] ) => any} icall - Call a method on the instance (thisArg).
 * @property {function(string, ...any): any} idcall - Call a method on the instance with the sequence state as the first argument.
 * @property {Object} log - Logger, if available on the instance.
 * @property {function(any): any} stop - Stop the sequence early and optionally return a value.
 * @property {number} i - Current step index.
 */

/**
 * @typedef {(...args: any) => Promise<any>} SequenceCallable
 * A callable function returned by the Sequence constructor.
 * @param {Object|Sequence.SequenceState} [opt_values] - Initial values for the sequence scope, or a SequenceState.
 * @returns {Promise<any>} The return value of the last step in the sequence.
 */
/**
 * Sequence is a callable object that executes a series of functions in order.
 * The functions are expected to be asynchronous; if they're not it might still
 * work, but it's neither tested nor supported.
 *
 * Note: arrow functions are supported, but they are not recommended;
 * using keyword functions allows each step to be named.
 *
 * Example usage:
 *
 *     const seq = new Sequence([
 *         async function set_foo (a) {
 *             a.set('foo', 'bar')
 *         },
 *         async function print_foo (a) {
    *          console.log(a.get('foo'));
 *         },
 *         async function third_step (a) {
 *             // do something
 *         },
 *     ]);
 *
 *     await seq();
 *
 * Example with controlled conditional branches:
 *
 *     const seq = new Sequence([
 *         async function first_step (a) {
 *             // do something
 *         },
 *         {
 *             condition: async a => a.get('foo') === 'bar',
 *             fn: async function second_step (a) {
 *                 // do something
 *             }
 *         },
 *         async function third_step (a) {
 *             // do something
 *         },
 *     ]);
 *
 * If it is called with an argument, it must be an object containing values
 * which will populate the "sequence scope".
 *
 * If it is called on an instance with a member called `values`
 * (i.e. if `this.values` is defined), then these values will populate the
 * sequence scope. This is to maintain compatibility for Sequence to be used
 * as an implementation of a runnable class. (See CodeUtil.mrwrap or BaseOperation)
 *
 * The object returned by the constructor is a function, which is used to
 * make the object callable. The callable object will execute the sequence
 * when called. The return value of the sequence is the return value of the
 * last function in the sequence.
 *
 * Each function in the sequence is passed a SequenceState object
 * as its first argument. Conventionally, this argument is called `a`,
 * which is short for either "API", "access", or "the `a` variable"
 * depending on which you prefer. Sequence provides methods for accessing
 * the sequence scope.
 *
 * By accessing the sequence scope through the `a` variable, changes to the
 * sequence scope can be monitored and recorded. (TODO: implement observe methods)
 */
/**
 * Sequence is a callable object that executes a series of asynchronous functions in order.
 * Each function receives a SequenceState instance for accessing and mutating the sequence scope.
 * Supports conditional steps, deferred steps, and can be used as a runnable implementation for classes.
 * @class @extends Function
 */
class Sequence  {
    /**
     * SequenceState represents the state of a Sequence execution.
     * Provides access to the sequence scope, step control, and utility methods for step functions.
     */
    static SequenceState = class SequenceState {
        /**
         * Create a new SequenceState.
         * @param {Sequence|function} sequence - The Sequence instance or its callable function.
         * @param {Object} [thisArg] - The instance to bind as `this` for step functions.
         */
        constructor(sequence, thisArg) {
            if ( typeof sequence === 'function' ) {
                sequence = sequence.sequence;
            }

            this.sequence_ = sequence;
            this.thisArg = thisArg;
            this.steps_ = null;
            this.value_history_ = [];
            this.scope_ = {};
            this.last_return_ = undefined;
            this.i = 0;
            this.stopped_ = false;

            this.defer_ptr_ = undefined;
            this.defer = this.constructor.defer_0;
        }

        /**
         * Get the current steps array for this sequence execution.
         * @returns {Array<function|Object>} The steps to execute.
         */
        get steps() {
            return this.steps_ ?? this.sequence_?.steps_;
        }

        /**
         * Run the sequence from the current step index.
         * @param {Object} [values] - Initial values for the sequence scope.
         * @returns {Promise<void>}
         */
        async run(values) {
            // Initialize scope
            values = values || this.thisArg?.values || {};
            Object.setPrototypeOf(this.scope_, values);

            // Run sequence
            for ( ; this.i < this.steps.length ; this.i++ ) {
                let step = this.steps[this.i];
                if ( typeof step !== 'object' ) {
                    step = {
                        name: step.name,
                        fn: step,
                    };
                }

                if ( step.condition && ! await step.condition(this) ) {
                    continue;
                }

                const parent_scope = this.scope_;
                this.scope_ = {};
                // We could do Object.assign(this.scope_, parent_scope), but
                // setting the prototype should be faster (in theory)
                Object.setPrototypeOf(this.scope_, parent_scope);

                if ( this.sequence_.options_.record_history ) {
                    this.value_history_.push(this.scope_);
                }

                if ( this.sequence_.options_.before_each ) {
                    await this.sequence_.options_.before_each(this, step);
                }

                this.last_return_ = await step.fn.call(this.thisArg, this);

                if ( this.last_return_ instanceof Sequence.SequenceState ) {
                    this.scope_ = this.last_return_.scope_;
                }

                if ( this.sequence_.options_.after_each ) {
                    await this.sequence_.options_.after_each(this, step);
                }

                if ( this.stopped_ ) {
                    break;
                }
            }
        }

        // Why check a condition every time code is called,
        // when we can check it once and then replace the code?

        /**
         * The first time defer is called, clones the steps and sets up for deferred insertion.
         * @param {function(Sequence.SequenceState): Promise<any>} fn - The function to defer.
         */
        static defer_0 = function(fn) {
            this.steps_ = [...this.sequence_.steps_];
            this.defer = this.constructor.defer_1;
            this.defer_ptr_ = this.steps_.length;
            this.defer(fn);
        };
        /**
         * Subsequent calls to defer insert the function before the deferred pointer.
         * @param {function(Sequence.SequenceState): Promise<any>} fn - The function to defer.
         */
        static defer_1 = function(fn) {
            // Deferred functions don't affect the return value
            const real_fn = fn;
            fn = async () => {
                await real_fn(this);
                return this.last_return_;
            };

            // Insert deferred step before the pointer
            this.steps_.splice(this.defer_ptr_, 0, fn);
        };

        /**
         * Get a value from the sequence scope.
         * @param {string} k - The key to retrieve.
         * @returns {any} The value associated with the key.
         */
        get(k) {
            // TODO: record read1
            return this.scope_[k];
        }

        /**
         * Set a value in the sequence scope.
         * @param {string} k - The key to set.
         * @param {any} v - The value to assign.
         */
        set(k, v) {
            // TODO: record mutation
            this.scope_[k] = v;
        }

        /**
         * Get or set multiple values in the sequence scope.
         * @param {Object} [opt_itemsToSet] - Optional object of key-value pairs to set.
         * @returns {Object} Proxy to the current scope for value access.
         */
        values(opt_itemsToSet) {
            if ( opt_itemsToSet ) {
                for ( const k in opt_itemsToSet ) {
                    this.set(k, opt_itemsToSet[k]);
                }
            }

            return new Proxy(this.scope_, {
                get: (target, property) => {
                    if ( property in target ) {
                        // TODO: record read
                        return target[property];
                    }
                    return undefined;
                },
            });
        }

        /**
         * Get a value from the instance (`thisArg`).
         * @param {string} [k] - The property name to retrieve. If omitted, returns the instance.
         * @returns {any} The value from the instance or the instance itself.
         */
        iget(k) {
            if ( k === undefined ) return this.thisArg;
            return this.thisArg?.[k];
        }

        // Instance call: call a method on the instance
        /**
         * Call a method on the instance (`thisArg`).
         * @param {string} k - The method name.
         * @param {...any} args - Arguments to pass to the method.
         * @returns {any} The result of the method call.
         */
        icall(k, ...args) {
            return this.thisArg?.[k]?.call(this.thisArg, ...args);
        }

        // Instance dynamic call: call a method on the instance,
        // passing the sequence state as the first argument
        /**
         * Call a method on the instance, passing the sequence state as the first argument.
         * @param {string} k - The method name.
         * @param {...any} args - Arguments to pass after the sequence state.
         * @returns {any} The result of the method call.
         */
        idcall(k, ...args) {
            return this.thisArg?.[k]?.call(this.thisArg, this, ...args);
        }

        /**
         * Get the logger from the instance, if available.
         * @returns {Object|undefined} The logger object.
         */
        get log() {
            return this.iget('log');
        }

        /**
         * Stop the sequence early and optionally return a value.
         * @param {any} [return_value] - Value to return from the sequence.
         * @returns {any} The provided return value.
         */
        stop(return_value) {
            this.stopped_ = true;
            return return_value;
        }
    };

    /**
     *
     * @param  {Array<function(A): Promise<any> | {condition: (a: A) => boolean | Promise<boolean>, fn: function(A): Promise<any>}> | function(A): Promise<any> | Object} args
     * @returns {Sequence}
     */
    /**
     * Create a new Sequence.
     * @param {...(Array<function(Sequence.SequenceState): Promise<any>|Object>|function(Sequence.SequenceState): Promise<any>|Object)} args
     *   - Arrays of step functions or step objects, individual step functions, or options objects.
     *   - Step objects may have a `condition` property (function) and a `fn` property (function).
     *   - Options object may include `name`, `record_history`, `before_each`, `after_each`.
     * @returns {SequenceCallable} A callable function that runs the sequence.
     */
    constructor(...args) {
        const sequence = this;

        const steps = [];
        const options = {};

        for ( const arg of args ) {
            if ( Array.isArray(arg) ) {
                steps.push(...arg);
            } else if ( typeof arg === 'object' ) {
                Object.assign(options, arg);
            } else if ( typeof arg === 'function' ) {
                steps.push(arg);
            } else {
                throw new TypeError(`Invalid argument to Sequence constructor: ${arg}`);
            }
        }

        /**
         * Callable function to execute the sequence.
         * @param {Object|Sequence.SequenceState} [opt_values] - Initial values or a SequenceState.
         * @returns {Promise<any>} The return value of the last step.
         */
        const fn = async function(opt_values) {
            if ( opt_values && opt_values instanceof Sequence.SequenceState ) {
                opt_values = opt_values.scope_;
            }
            const state = new Sequence.SequenceState(sequence, this);
            await state.run(opt_values ?? undefined);
            return state.last_return_;
        };

        this.steps_ = steps;
        this.options_ = options || {};

        Object.defineProperty(fn, 'name', {
            value: options.name || 'Sequence',
        });
        Object.defineProperty(fn, 'sequence', { value: this });

        return fn;
    }
}

module.exports = {
    Sequence,
};
