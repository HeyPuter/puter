export class TransformUsageWriter {
    constructor (fn, delegate) {
        this.fn = fn;
        this.delegate = delegate;
    }
    
    resolve (v) {
        return this.delegate(this.fn.call(null, v));
    }
}
