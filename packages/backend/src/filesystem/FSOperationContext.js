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
const PerformanceMonitor = require('../monitor/PerformanceMonitor');

const FSNodeContext = require('./FSNodeContext');
const FSAccessContext = require('./FSAccessContext');
const { Context } = require('../util/context');

/**
 * FSOperationContext represents a single operation on the filesystem.
 * 
 * FSOperationContext is used to record events such as side-effects
 * which occur during a high-level filesystem operation. It is also
 * responsible for generating a client-safe result which describes
 * the operation.
 */
module.exports = class FSOperationContext {
    // TODO: rename this.fs to this.access
    constructor (op_name, context, options) {
        // TRACK: fs:create-service
        // TODO: rename this.fs to this.access
        // NOTE: the 2nd parameter of this constructor
        //   was called `fs` and was expected to be FSAccessContext.
        //   Now it should be a context object holding the services
        //   container. context.access is the FSAccessContext.
        if ( context instanceof FSAccessContext ) {
            this.fs = context;
        } else if ( context ) {
            this.context = context;
            this.fs = context.access;
        } else {
            const x = Context.get();
            this.fs = {};
            this.fs.traceService = x.get('services').get('traceService');
        }

        this.name = op_name;
        this.events = [];
        this.parent_dirs_created = [];
        this.created = [];
        this.fields = {};
        this.safeFields = {};

        this.valueListeners_ = {};
        this.valueFactories_ = {};
        this.values_ = {};
        this.rejections_ = {};

        this.tasks_ = [];

        this.currentCheckpoint_ = 'checkpoint not set';

        if ( options.parent_operation ) {
            this.parent = options.parent_operation;
        }

        this.donePromise = new Promise((resolve, reject) => {
            this.doneResolve = resolve;
            this.doneReject = reject;
        });

        // TRACK: arch:trace-service:move-outta-fs
        if ( this.fs.traceService ) {
            // Set 'span_' to current active span
            const { context, trace } = require('@opentelemetry/api');
            this.span_ = trace.getSpan(context.active());
        }

        this.monitor = PerformanceMonitor.createContext(`fs.${op_name}`);
    }

    checkpoint (label) {
        this.currentCheckpoint_ = label;
    }

    async addTask (name, fn) {
        const task = {
            name,
            operations: [],
            promise: Promise.resolve(),
        };

        const taskContext = {
            registerOperation: op => {
                task.operations.push(op);
                task.promise = task.promise.then(() => op.awaitDone());
            }
        };

        const monitor = PerformanceMonitor.createContext('fs.rm');
        monitor.label(`task:${name}`);
        task.promise = task.promise.then(() => fn(taskContext));
        this.tasks_.push(task);

        let last_promise = null;
        while ( task.promise !== last_promise ) {
            last_promise = task.promise;
            await task.promise;
        }
        // await task.promise;

        monitor.stamp();
        monitor.end();
    }

    get span () { return this.span_; }

    recordParentDirCreated (fsNode) {
        if ( ! fsNode ) {
            throw new Error(
                'falsy value to recordParentDirCreated',
                fsNode,
            );
        }
        this.parent_dirs_created.push(fsNode);
    }

    recordCreated (fsNode) {
        this.created.push(fsNode);
    }

    set (field, value) {
        this.fields[field] = value;
    }

    async set_now (field, value) {
        this.fields[field] = value;
        if ( value instanceof FSNodeContext ) {
            this.safeFields[field] = await value.getSafeEntry();
        }
    }

    get (field) {
        return this.fields[field];
    }

    complete (options) {
        options = options ?? {};

        if ( this.parent ) {
            for ( const fsNode of this.parent_dirs_created ) {
                this.parent.recordParentDirCreated(fsNode);
            }

            for ( const fsNode of this.created ) {
                this.parent.recordCreated(fsNode);
            }
        }

        if ( this.tasks_.length > 0 ) {
            // TODO: it's mutating input options, which is not ideal
            if ( ! options.after ) options.after = [];
            
            options.after.push(
                this.tasks_.map(task => task.promise)
            );
        }

        if ( options.after ) {
            const thingsToWaitFor = options.after.map(item => {
                if ( item.awaitDone ) return item.awaitDone;
                return item;
            });
            (async () => {
                await Promise.all(thingsToWaitFor);
                this.doneResolve();
            })();
            return;
        }

        this.doneResolve();
    }

    onComplete(fn) {
        this.donePromise.then(fn);
    }

    awaitDone () {
        return this.donePromise;
    }

    provideValue (key, value) {
        this.values_[key] = value;

        let listeners = this.valueListeners_[key];
        if ( ! listeners ) return;

        delete this.valueListeners_[key];

        for ( let listener of listeners ) {
            if ( Array.isArray(listener) ) listener = listener[0];
            listener(value);
        }
    }

    rejectValue (key, err) {
        this.rejections_[key] = err;

        let listeners = this.valueListeners_[key];
        if ( ! listeners ) return;

        delete this.valueListeners_[key];

        for ( let listener of listeners ) {
            if ( ! Array.isArray(listener) ) continue;
            if ( ! listener[1] ) continue;
            listener = listener[1];

            listener(err);
        }
    }

    awaitValue (key) {
        return new Promise ((rslv, rjct) => {
            this.onValue(key, rslv, rjct);
        });
    }

    onValue (key, fn, rjct) {
        if ( this.values_[key] ) {
            fn(this.values_[key]);
            return;
        }

        if ( this.rejections_[key] ) {
            if ( rjct ) {
                rjct(this.rejections_[key]);
            } else throw this.rejections_[key];
            return;
        }

        if ( ! this.valueListeners_[key] ) {
            this.valueListeners_[key] = [];
        }
        this.valueListeners_[key].push([fn, rjct]);

        if ( this.valueFactories_[key] ) {
            const fn = this.valueFactories_[key];
            delete this.valueFactories_[key];
            (async () => {
                try {
                    const value = await fn();
                    this.provideValue(key, value);
                } catch (e) {
                    this.rejectValue(key, e);
                }
            })();
        }
    }

    async setFactory (key, factoryFn) {
        if ( this.valueListeners_[key] ) {
            let v;
            try {
                v = await factoryFn();
            } catch (e) {
                this.rejectValue(key, e);
            }
            this.provideValue(key, v);
            return;
        }

        this.valueFactories_[key] = factoryFn;
    }

    /**
     * Listen for another operation to complete, and then
     * complete this operation. This is useful for operations
     * which delegate to other operations.
     * 
     * @param {FSOperationContext} other 
     * @returns {FSOperationContext} this
     */
    completedBy (other) {
        other.onComplete(() => {
            this.complete();
        });

        return this;
    }

    /**
     * Produces an object which describes the operation in a
     * way that is intended to be sent to the client.
     * 
     * @returns {Promise<Object>}
     */
    async getClientSafeResult () {
        const result = {};
        for ( const field in this.fields ) {
            if ( this.fields[field] instanceof FSNodeContext ) {
                result[field] = this.safeFields[field] ??
                    await this.fields[field].getSafeEntry();
                continue;
            }

            result[field] = this.fields[field];
        }

        result.parent_dirs_created = [];
        for ( const fsNode of this.parent_dirs_created ) {
            const fsNodeResult = await fsNode.getSafeEntry();
            result.parent_dirs_created.push(fsNodeResult);
        }

        return result;
    }
}
