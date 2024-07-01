import { adapt_parser, INVALID, Parser, UNRECOGNIZED, VALUE } from '../parser.js';

/**
 * Runs its child parser, and discards its result.
 * @param parser Child parser
 */
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

/**
 * Runs its child parsers in order, and returns the first successful result.
 * @param parsers Child parsers
 */
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

/**
 * Runs its child parser, and then returns its result, or nothing.
 * @param parser Child parser
 */
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

/**
 * Parses a repeated sequence of values with separators between them.
 * @param value_parser Parser for the value
 * @param separator_parser Parser for the separator, optional
 * @param trailing Whether to allow a trailing separator
 */
export class Repeat extends Parser {
    _create (value_parser, separator_parser, { trailing = false } = {}) {
        this.value_parser = adapt_parser(value_parser);
        this.separator_parser = separator_parser ? adapt_parser(separator_parser) : null;
        this.trailing = trailing;
    }

    _parse (stream) {
        const results = [];
        const subStream = stream.fork();

        // Parse first value
        const result = this.value_parser.parse(subStream);
        if ( result.status === INVALID )
            return { status: INVALID, value: result };

        if ( result.status === VALUE ) {
            stream.join(subStream);
            if (!result.$discard) results.push(result);

            // Repeatedly parse <separator> <value>
            for (;;) {
                // Separator
                let parsed_separator = false;
                if (this.separator_parser) {
                    const separatorResult = this.separator_parser.parse(subStream);
                    if (separatorResult.status === UNRECOGNIZED)
                        break;
                    if (separatorResult.status === INVALID)
                        return { status: INVALID, value: separatorResult };
                    stream.join(subStream);
                    if (!separatorResult.$discard) results.push(separatorResult);
                    parsed_separator = true;
                }

                // Value
                const result = this.value_parser.parse(subStream);
                if (result.status === UNRECOGNIZED) {
                    // If we failed to parse a value, we have a trailing separator
                    if (parsed_separator && this.trailing === false)
                        return { status: INVALID, value: result };
                    break;
                }
                if (result.status === INVALID)
                    return { status: INVALID, value: result };

                stream.join(subStream);
                if (!result.$discard) results.push(result);
            }
        }

        if ( results.length === 0 )
            return UNRECOGNIZED;

        return { status: VALUE, value: results };
    }
}

/**
 * Runs a sequence of child parsers, and returns their result as an array if they all succeed.
 * @param parsers Child parsers
 */
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
