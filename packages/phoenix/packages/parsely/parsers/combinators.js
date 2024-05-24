import { INVALID, UNRECOGNIZED, VALUE, adapt_parser, Parser } from '../lib.js';

export class Discard extends Parser {
    _create (parser) {
        this.parser = adapt_parser(parser);
    }

    _parse (stream) {
        const subStream = stream.fork();
        const result = this.parser.parse(subStream);
        if ( result.status === UNRECOGNIZED ) {
            return UNRECOGNIZED;
        }
        if ( result.status === INVALID ) {
            return result;
        }
        stream.join(subStream);
        return { status: VALUE, $: 'none', $discard: true, value: result };
    }
}

export class FirstMatch extends Parser {
    _create (...parsers) {
        this.parsers = parsers.map(adapt_parser);
    }

    _parse (stream) {
        for ( const parser of this.parsers ) {
            const subStream = stream.fork();
            const result = parser.parse(subStream);
            if ( result.status === UNRECOGNIZED ) {
                continue;
            }
            if ( result.status === INVALID ) {
                return result;
            }
            stream.join(subStream);
            return result;
        }

        return UNRECOGNIZED;
    }
}

export class None extends Parser {
    _create () {}

    _parse (stream) {
        return { status: VALUE, $: 'none', $discard: true };
    }
}

export class Optional extends Parser {
    _create (parser) {
        this.parser = adapt_parser(parser);
    }

    _parse (stream) {
        const subStream = stream.fork();
        const result = this.parser.parse(subStream);
        if ( result.status === VALUE ) {
            stream.join(subStream);
            return result;
        }
        return { status: VALUE, $: 'none', $discard: true };
    }
}

export class Repeat extends Parser {
    _create (value_parser, separator_parser, { trailing = false } = {}) {
        this.value_parser = adapt_parser(value_parser);
        this.separator_parser = adapt_parser(separator_parser);
        this.trailing = trailing;
    }

    _parse (stream) {
        const results = [];
        for ( ;; ) {
            const subStream = stream.fork();

            // Value
            const result = this.value_parser.parse(subStream);
            if ( result.status === UNRECOGNIZED ) {
                break;
            }
            if ( result.status === INVALID ) {
                return { status: INVALID, value: result };
            }
            stream.join(subStream);
            if ( ! result.$discard ) results.push(result);

            // Separator
            if ( ! this.separator_parser ) {
                continue;
            }
            const separatorResult = this.separator_parser.parse(subStream);
            if ( separatorResult.status === UNRECOGNIZED ) {
                break;
            }
            if ( separatorResult.status === INVALID ) {
                return { status: INVALID, value: separatorResult };
            }
            stream.join(subStream);
            if ( ! result.$discard ) results.push(separatorResult);

            // TODO: Detect trailing separator and reject it if trailing==false
        }

        if ( results.length === 0 ) {
            return UNRECOGNIZED;
        }

        return { status: VALUE, value: results };
    }
}

export class Sequence extends Parser {
    _create (...parsers) {
        this.parsers = parsers.map(adapt_parser);
    }

    _parse (stream) {
        const results = [];
        for ( const parser of this.parsers ) {
            const subStream = stream.fork();
            const result = parser.parse(subStream);
            if ( result.status === UNRECOGNIZED ) {
                return UNRECOGNIZED;
            }
            if ( result.status === INVALID ) {
                return { status: INVALID, value: result };
            }
            stream.join(subStream);
            if ( ! result.$discard ) results.push(result);
        }

        return { status: VALUE, value: results };
    }
}
