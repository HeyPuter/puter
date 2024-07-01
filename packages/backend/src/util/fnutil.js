const UtilFn = fn => {
    /**
     * A null-coalescing call
     */
    fn.if = function utilfn_if (v) {
        if ( v === null || v === undefined ) return v;
        return this(v);
    }
    return fn;
};

module.exports = {
    UtilFn,
};
