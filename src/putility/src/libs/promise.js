/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

class TeePromise {
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

class Lock {
    constructor() {
        this._locked = false;
        this._waiting = [];
    }

    async acquire(callback) {
        await new Promise(resolve => {
            if ( ! this._locked ) {
                this._locked = true;
                resolve();
            } else {
                this._waiting.push({
                    resolve,
                });
            }
        })
        if ( callback ) {
            let retval;
            try {
                retval = await callback();
            } finally {
                this.release();
            }
            return retval;
        }
    }

    release() {
        if (this._waiting.length > 0) {
            const { resolve } = this._waiting.shift();
            resolve();
        } else {
            this._locked = false;
        }
    }
}

class RWLock {
    static TYPE_READ = Symbol('read');
    static TYPE_WRITE = Symbol('write');

    constructor () {
        this.queue = [];

        this.readers_ = 0;
        this.writer_ = false;

        this.on_empty_ = () => {};

        this.mode = this.constructor.TYPE_READ;
    }
    get effective_mode () {
        if ( this.readers_ > 0 ) return this.constructor.TYPE_READ;
        if ( this.writer_ ) return this.constructor.TYPE_WRITE;
        return undefined;
    }
    push_ (item) {
        if ( this.readers_ === 0 && ! this.writer_ ) {
            this.mode = item.type;
        }
        this.queue.push(item);
        this.check_queue_();
    }
    check_queue_ () {
        // console.log('check_queue_', {
        //     readers_: this.readers_,
        //     writer_: this.writer_,
        //     queue: this.queue.map(item => item.type),
        // });
        if ( this.queue.length === 0 ) {
            if ( this.readers_ === 0 && ! this.writer_ ) {
                this.on_empty_();
            }
            return;
        }

        const peek = () => this.queue[0];

        if ( this.readers_ === 0 && ! this.writer_ ) {
            this.mode = peek().type;
        }

        if ( this.mode === this.constructor.TYPE_READ ) {
            while ( peek()?.type === this.constructor.TYPE_READ ) {
                const item = this.queue.shift();
                this.readers_++;
                (async () => {
                    await item.p_unlock;
                    this.readers_--;
                    this.check_queue_();
                })();
                item.p_operation.resolve();
            }
            return;
        }

        if ( this.writer_ ) return;

        const item = this.queue.shift();
        this.writer_ = true;
        (async () => {
            await item.p_unlock;
            this.writer_ = false;
            this.check_queue_();
        })();
        item.p_operation.resolve();
    }
    async rlock () {
        const p_read = new TeePromise();
        const p_unlock = new TeePromise();
        const handle = {
            unlock: () => {
                p_unlock.resolve();
            }
        };

        this.push_({
            type: this.constructor.TYPE_READ,
            p_operation: p_read,
            p_unlock,
        });
        await p_read;

        return handle;
    }

    async wlock () {
        const p_write = new TeePromise();
        const p_unlock = new TeePromise();
        const handle = {
            unlock: () => {
                p_unlock.resolve();
            }
        };

        this.push_({
            type: this.constructor.TYPE_WRITE,
            p_operation: p_write,
            p_unlock,
        });
        await p_write;

        return handle;
    }

}

/**
 * @callback behindScheduleCallback
 * @param {number} drift - The number of milliseconds that the callback was
 *    called behind schedule.
 * @returns {boolean} - If the callback returns true, the timer will be
 *   cancelled.
 */

/**
 * When passing an async callback to setInterval, it's possible for the
 * callback to be called again before the previous invocation has finished.
 *
 * This function wraps setInterval and ensures that the callback is not
 * called again until the previous invocation has finished.
 *
 * @param {Function} callback - The function to call when the timer elapses.
 * @param {number} delay - The minimum number of milliseconds between invocations.
 * @param {?Array<any>} args - Additional arguments to pass to setInterval.
 * @param {?Object} options - Additional options.
 * @param {behindScheduleCallback} options.onBehindSchedule - A callback to call when the callback is called behind schedule.
 */
const asyncSafeSetInterval = async (callback, delay, args, options) => {
    args = args ?? [];
    options = options ?? {};
    const { onBehindSchedule } = options;

    const sleep = (ms) => new Promise(rslv => setTimeout(rslv, ms));

    for ( ;; ) {
        await sleep(delay);

        const ts_start = Date.now();
        await callback(...args);
        const ts_end = Date.now();

        const runtime = ts_end - ts_start;
        const sleep_time = delay - runtime;

        if ( sleep_time < 0 ) {
            if ( onBehindSchedule ) {
                const cancel = await onBehindSchedule(-sleep_time);
                if ( cancel ) {
                    return;
                }
            }
        } else {
            await sleep(sleep_time);
        }
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
const raceCase = async (promise_map) => {
    return Promise.race(Object.entries(promise_map).map(
        ([key, promise]) => promise.then(value => [key, value])));
};

module.exports = {
    TeePromise,
    Lock,
    RWLock,
    asyncSafeSetInterval,
    raceCase,
};
