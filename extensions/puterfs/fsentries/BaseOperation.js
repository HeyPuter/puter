export default class BaseOperation {
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
    awaitDone () {
        return this.donePromise;
    }
    onComplete (fn) {
        this.donePromise.then(fn);
    }
}
