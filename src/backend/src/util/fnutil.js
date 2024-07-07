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

const OnlyOnceFn = fn => {
    let called = false;
    return function onlyoncefn_call (...args) {
        if ( called ) return;
        called = true;
        return fn(...args);
    };
};

module.exports = {
    UtilFn,
    OnlyOnceFn,
};
