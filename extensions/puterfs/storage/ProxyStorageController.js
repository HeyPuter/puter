export default class {
    constructor (delegate) {
        this.delegate = delegate ?? null;
    }
    setDelegate (delegate) {
        this.delegate = delegate;
    }

    init (...a) {
        return this.delegate.init(...a);
    }
    upload (...a) {
        return this.delegate.upload(...a);
    }
    copy (...a) {
        return this.delegate.copy(...a);
    }
    delete (...a) {
        return this.delegate.delete(...a);
    }
    read (...a) {
        return this.delegate.read(...a);
    }
}
