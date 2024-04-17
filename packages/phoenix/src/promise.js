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
