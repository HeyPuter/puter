// A tokenizer good enough to tell an identifier *reference* from everything
// that merely looks like one. It is not a parser: it produces a flat token
// stream with strings, comments and regex literals removed, and template
// literals reduced to the tokens inside their `${}` holes.
//
// This exists because the handler scan has to run in the browser, in node and
// in a worker isolate with no parser available and no dependency to add for
// one. Everything it cannot decide, it decides in the direction that produces a
// clear error rather than a silent misreading.

/** One token. Strings, comments and regex bodies never reach here. */
/** @typedef {{ type: 'name' | 'num' | 'punct', value: string }} Token */

const WHITESPACE = /\s/;
const IDENT_START = /[A-Za-z_$\u00A0-\uFFFF]/;
const IDENT_PART = /[A-Za-z0-9_$\u00A0-\uFFFF]/;
const DIGIT = /[0-9]/;

const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:[0-9][0-9_]*)?\.?[0-9][0-9_]*(?:[eE][+-]?[0-9]+)?|[0-9][0-9_]*\.)n?/;

// Longest first, so `===` is never read as `==` followed by `=`.
const PUNCTUATORS = [
    '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
    '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
];

/**
 * After these, a `/` opens a regex rather than dividing. `)` and `]` are
 * deliberately absent — `(a + b) / 2` is far more common than a regex there —
 * while `}` is present, because reading a regex as division would tokenize its
 * body and invent identifiers that were never in the code.
 */
const REGEX_AFTER_KEYWORD = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'case', 'do', 'else', 'yield', 'await', 'throw',
]);

const NO_REGEX_AFTER = new Set([')', ']', '++', '--']);

/**
 * Splits source into tokens.
 *
 * @param {string} source
 * @returns {Token[]}
 */
export const tokenize = (source) => {
    /** @type {Token[]} */
    const tokens = [];
    /** Braces that are `${` holes, so `}` can hand the template back. */
    const braces = [];
    let inTemplate = false;
    let i = 0;

    const push = (type, value) => tokens.push({ type, value });
    const previous = () => tokens[tokens.length - 1];

    const regexAllowed = () => {
        const prev = previous();
        if ( ! prev ) return true;
        if ( prev.type === 'num' ) return false;
        if ( prev.type === 'name' ) return REGEX_AFTER_KEYWORD.has(prev.value);
        return ! NO_REGEX_AFTER.has(prev.value);
    };

    /** Walk to the end of a quoted string, honouring escapes. */
    const skipString = (quote) => {
        i++;
        while ( i < source.length ) {
            if ( source[i] === '\\' ) { i += 2; continue; }
            if ( source[i] === quote ) { i++; return; }
            i++;
        }
    };

    /** Walk to the end of a regex literal, including its character classes. */
    const skipRegex = () => {
        i++;
        let inClass = false;
        while ( i < source.length ) {
            const ch = source[i];
            if ( ch === '\\' ) { i += 2; continue; }
            if ( ch === '\n' ) return;
            if ( ch === '[' ) inClass = true;
            else if ( ch === ']' ) inClass = false;
            else if ( ch === '/' && ! inClass ) {
                i++;
                while ( i < source.length && IDENT_PART.test(source[i]) ) i++;
                return;
            }
            i++;
        }
    };

    while ( i < source.length ) {
        const ch = source[i];

        if ( inTemplate ) {
            if ( ch === '\\' ) { i += 2; continue; }
            if ( ch === '`' ) { inTemplate = false; i++; continue; }
            if ( ch === '$' && source[i + 1] === '{' ) {
                // The hole is code, and code is what this is here to read.
                braces.push('template');
                inTemplate = false;
                i += 2;
                continue;
            }
            i++;
            continue;
        }

        if ( WHITESPACE.test(ch) ) { i++; continue; }

        if ( ch === '/' && source[i + 1] === '/' ) {
            while ( i < source.length && source[i] !== '\n' ) i++;
            continue;
        }
        if ( ch === '/' && source[i + 1] === '*' ) {
            const end = source.indexOf('*/', i + 2);
            i = end === -1 ? source.length : end + 2;
            continue;
        }
        if ( ch === '/' && regexAllowed() ) { skipRegex(); continue; }

        if ( ch === '"' || ch === "'" ) { skipString(ch); continue; }
        if ( ch === '`' ) { inTemplate = true; i++; continue; }

        if ( ch === '{' ) { braces.push('brace'); push('punct', '{'); i++; continue; }
        if ( ch === '}' ) {
            if ( braces.pop() === 'template' ) { inTemplate = true; i++; continue; }
            push('punct', '}');
            i++;
            continue;
        }

        if ( DIGIT.test(ch) || (ch === '.' && DIGIT.test(source[i + 1] ?? '')) ) {
            const match = NUMBER.exec(source.slice(i));
            const text = match ? match[0] : ch;
            push('num', text);
            i += text.length;
            continue;
        }

        if ( IDENT_START.test(ch) ) {
            let end = i + 1;
            while ( end < source.length && IDENT_PART.test(source[end]) ) end++;
            push('name', source.slice(i, end));
            i = end;
            continue;
        }

        const punct = PUNCTUATORS.find(candidate => source.startsWith(candidate, i));
        if ( punct ) { push('punct', punct); i += punct.length; continue; }

        push('punct', ch);
        i++;
    }

    return tokens;
};
