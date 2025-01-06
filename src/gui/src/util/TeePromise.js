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
export default def(class TeePromise {
    static ID = 'util.TeePromise';

    static STATUS_PENDING = {};
    static STATUS_RUNNING = {};
    static STATUS_DONE = {};
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
    then (fn, rfn) {
        return this.donePromise.then(fn, rfn);
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
});
