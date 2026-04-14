import { TeePromise } from 'teepromise';

export default class BaseOperation {
    static STATUS_PENDING = {};
    static STATUS_RUNNING = {};
    static STATUS_DONE = {};

    /** @type {PromiseLike<void> & { resolve: () => void }} */
    #donePromise;

    constructor () {
        this.status_ = this.constructor.STATUS_PENDING;
        this.#donePromise = new TeePromise();
    }
    get status () {
        return this.status_;
    }
    set status (status) {
        this.status_ = status;
        if ( status === this.constructor.STATUS_DONE ) {
            this.#donePromise.resolve();
        }
    }
    async awaitDone () {
        await this.#donePromise;
    }
    async onComplete (fn) {
        await this.#donePromise;
        fn();
    }
}
