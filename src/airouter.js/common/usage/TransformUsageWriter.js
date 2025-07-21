export class TransformUsageWriter {
    constructor (fn, delegate) {
        this.fn = fn;
        this.delegate = delegate;
    }
    
    async resolve (v) {
        const v_or_p = this.fn.call(null, v);
        return this.delegate.resolve(await v_or_p);
    }
}
