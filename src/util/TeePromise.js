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
