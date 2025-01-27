module.exports = class Assert {
    equal (expected, actual) {
        this.assert(expected === actual);
    }

    assert (b) {
        if ( ! b ) {
            throw new Error('assertion failed');
        }
    }
}
