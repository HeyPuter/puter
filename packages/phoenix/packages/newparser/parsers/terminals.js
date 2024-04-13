import { Parser, UNRECOGNIZED, VALUE } from '../lib.js';

export class Literal extends Parser {
    _create (value) {
        this.value = value;
    }

    _parse (stream) {
        const subStream = stream.fork();
        for ( let i=0 ; i < this.value.length ; i++ ) {
            let { done, value } = subStream.next();
            if ( done ) return UNRECOGNIZED;
            if ( this.value[i] !== value ) return UNRECOGNIZED;
        }

        stream.join(subStream);
        return { status: VALUE, $: 'literal', value: this.value };
    }
}

export class StringOf extends Parser {
    _create (values) {
        this.values = values;
    }

    _parse (stream) {
        const subStream = stream.fork();
        let text = '';

        while (true) {
            let { done, value } = subStream.look();
            if ( done ) break;
            if ( ! this.values.includes(value) ) break;

            subStream.next();
            text += value;
        }

        if (text.length === 0) {
            return UNRECOGNIZED;
        }

        stream.join(subStream);
        return { status: VALUE, $: 'stringOf', value: text };
    }
}