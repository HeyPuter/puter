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
export class TeePromise {
    static STATUS_PENDING = Symbol('pending');
    static STATUS_RUNNING = {};
    static STATUS_DONE = Symbol('done');
    constructor () {
        this.status_ = this.constructor.STATUS_PENDING;
        this.donePromise = new Promise((resolve, reject) => {
            this.doneResolve = resolve;
            this.doneReject = reject;
        });
    }
    get status () {
        return this.status_;
    }
    set status (status) {
        this.status_ = status;
        if ( status === this.constructor.STATUS_DONE ) {
            this.doneResolve();
        }
    }
    resolve (value) {
        this.status_ = this.constructor.STATUS_DONE;
        this.doneResolve(value);
    }
    awaitDone () {
        return this.donePromise;
    }
    then (fn, ...a) {
        return this.donePromise.then(fn, ...a);
    }

    reject (err) {
        this.status_ = this.constructor.STATUS_DONE;
        this.doneReject(err);
    }

    /**
     * @deprecated use then() instead
     */
    onComplete(fn) {
        return this.then(fn);
    }
}

/**
 * raceCase is like Promise.race except it takes an object instead of
 * an array, and returns the key of the promise that resolves first
 * as well as the value that it resolved to.
 * 
 * @param {Object.<string, Promise>} promise_map 
 * 
 * @returns {Promise.<[string, any]>}
 */
export const raceCase = async (promise_map) => {
    return Promise.race(Object.entries(promise_map).map(
        ([key, promise]) => promise.then(value => [key, value])));
};
