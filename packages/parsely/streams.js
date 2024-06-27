/**
 * Base class for input streams.
 * Defines which methods are expected for any stream implementations.
 */
export class ParserStream {
    value_at (index) { throw new Error(`${this.constructor.name}.value_at() not implemented`); }
    look () { throw new Error(`${this.constructor.name}.look() not implemented`); }
    next () { throw new Error(`${this.constructor.name}.next() not implemented`); }
    fork () { throw new Error(`${this.constructor.name}.fork() not implemented`); }
    join () { throw new Error(`${this.constructor.name}.join() not implemented`); }

    is_eof () {
        return this.look().done;
    }
}

/**
 * ParserStream that takes a string, and processes it character by character.
 */
export class StringStream extends ParserStream {
    constructor (str, startIndex = 0) {
        super();
        this.str = str;
        this.i = startIndex;
    }

    value_at (index) {
        if ( index >= this.str.length ) {
            return { done: true, value: undefined };
        }

        return { done: false, value: this.str[index] };
    }

    look () {
        return this.value_at(this.i);
    }

    next () {
        const result = this.value_at(this.i);
        this.i++;
        return result;
    }

    fork () {
        return new StringStream(this.str, this.i);
    }

    join (forked) {
        this.i = forked.i;
    }
}
