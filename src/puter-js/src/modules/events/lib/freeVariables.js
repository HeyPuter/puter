import { PuterJSError } from '../../../lib/PuterJSError.js';
import { tokenize } from './tokenize.js';

/**
 * The free-variable scan a handler is held to at subscribe time.
 *
 * A handler is deployed, not called: it is serialized with
 * `Function.prototype.toString()` and run later, somewhere else, with nothing
 * around it. A closed-over variable is therefore not discouraged, it is
 * unrepresentable — so anything the source names that it does not also bind has
 * to come from `ctx`, from a parameter, or from the runtime. Catching that here
 * turns a rule that would otherwise fail on the first delivery, in production,
 * into a rejected `subscribe`.
 *
 * The scan collects every name the source *binds* anywhere — parameters,
 * destructured names, `var`/`let`/`const`/`function`/`class`/`catch` — and then
 * requires every identifier *reference* to be one of those or a known global.
 *
 * Known limitation: bindings are collected flat rather than per scope, so a
 * name bound in one block counts as bound in the whole handler. That direction
 * is deliberate — it can miss a shadowing case, and it never rejects code that
 * would have worked.
 */

/**
 * Reserved words and the contextual keywords that read as identifiers. Skipped
 * rather than resolved: none of them is a variable reference, and treating
 * `async` or `get` as one would reject perfectly ordinary handlers.
 */
const KEYWORDS = new Set([
    'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
    'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
    'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
    'typeof', 'var', 'void', 'while', 'with', 'yield',
    'async', 'as', 'from', 'get', 'set', 'of', 'static', 'accessor',
]);

/** Declaration keywords whose head is a binding pattern. */
const DECLARATORS = new Set(['var', 'let', 'const']);

/**
 * Names the runtime provides. Curated rather than derived from `globalThis`:
 * the handler runs in a worker isolate, not in the environment doing the scan,
 * so what is present here says nothing about what is present there.
 */
export const HANDLER_GLOBALS = new Set([
    // Language
    'globalThis', 'undefined', 'NaN', 'Infinity', 'arguments',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
    'Math', 'JSON', 'Date', 'RegExp', 'Function', 'Promise', 'Proxy', 'Reflect',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
    'EvalError', 'URIError', 'AggregateError', 'Intl',
    'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
    'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
    'BigInt64Array', 'BigUint64Array',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',
    'structuredClone', 'queueMicrotask', 'atob', 'btoa',
    // Runtime
    'console', 'fetch', 'Request', 'Response', 'Headers', 'FormData', 'Blob',
    'File', 'URL', 'URLSearchParams', 'AbortController', 'AbortSignal',
    'TextEncoder', 'TextDecoder', 'ReadableStream', 'WritableStream',
    'TransformStream', 'CompressionStream', 'DecompressionStream',
    'crypto', 'Crypto', 'SubtleCrypto', 'performance', 'WebSocket',
    'Event', 'EventTarget', 'CustomEvent', 'MessageChannel', 'MessagePort',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
]);

/**
 * Names an events worker deliberately does not provide, and what to use
 * instead. A handler runs with no ambient SDK: there is no account it belongs
 * to until a delivery says whose it is.
 */
const NO_AMBIENT_SDK = new Set(['puter', 'me', 'my', 'myself']);

/** Raised for the identifier that could not be resolved, naming it. */
const freeVariable = (name) =>
    new PuterJSError(
        NO_AMBIENT_SDK.has(name)
            ? `Handler refers to \`${name}\`, and a handler has no ambient SDK: ` +
                  'it runs as whoever the delivery belongs to. Use the `user` binding.'
            : `Handler refers to \`${name}\`, which is not a parameter, a local, or a known global. ` +
                  'A handler is serialized and run elsewhere, so it cannot close over anything — ' +
                  'pass the value in `context` and read it from `ctx`.',
        'events_handler_free_variable',
    );

const isName = (token) => token?.type === 'name';
const isPunct = (token, value) => token?.type === 'punct' && token.value === value;

const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);

/** Index of the token closing the group that opens at `start`, or -1. */
const matchGroup = (tokens, start) => {
    const stack = [];
    for ( let i = start; i < tokens.length; i++ ) {
        const token = tokens[i];
        if ( token.type !== 'punct' ) continue;
        if ( OPENERS[token.value] ) { stack.push(OPENERS[token.value]); continue; }
        if ( ! CLOSERS.has(token.value) ) continue;
        if ( stack.pop() !== token.value ) return -1;
        if ( stack.length === 0 ) return i;
    }
    return -1;
};

/**
 * Collect the names a binding pattern introduces, between `start` and `end`.
 * A `=` opens a default-value expression at the current nesting depth; only a
 * `,` back at that same depth ends it (a `,` one level deeper belongs to the
 * default value itself, e.g. the call in `{ a = f(x, y), b }`).
 */
const collectPattern = (tokens, start, end, into) => {
    let depth = 0;
    let inInitializer = false;
    let initializerDepth = -1;
    for ( let i = start; i < end; i++ ) {
        const token = tokens[i];
        if ( token.type === 'punct' ) {
            if ( OPENERS[token.value] ) depth++;
            else if ( CLOSERS.has(token.value) ) depth--;
            else if ( token.value === '=' && ! inInitializer ) { inInitializer = true; initializerDepth = depth; }
            else if ( token.value === ',' && inInitializer && depth === initializerDepth ) inInitializer = false;
            continue;
        }
        if ( inInitializer || ! isName(token) || KEYWORDS.has(token.value) ) continue;
        // `.b` in a pattern is a member target, which binds nothing new.
        if ( isPunct(tokens[i - 1], '.') ) continue;
        into.add(token.value);
    }
};

/** Where a declarator's binding pattern ends: `=`, `,`, `;`, a depth-0 closer, or `of`/`in`. */
const findPatternEnd = (tokens, start) => {
    let depth = 0;
    let i = start;
    for ( ; i < tokens.length; i++ ) {
        const token = tokens[i];
        if ( token.type === 'punct' ) {
            if ( OPENERS[token.value] ) { depth++; continue; }
            if ( CLOSERS.has(token.value) ) {
                if ( depth === 0 ) return i;
                depth--;
                continue;
            }
            if ( depth === 0 && (token.value === '=' || token.value === ',' || token.value === ';') )
                return i;
            continue;
        }
        if ( isName(token) && depth === 0 && (token.value === 'of' || token.value === 'in') )
            return i;
    }
    return i;
};

/**
 * Names a `var`/`let`/`const` head introduces, and where the head ends. Only
 * the pattern is bound here — an initializer is a reference, not a binding,
 * but it can still contain its own arrow/function/class/catch, each binding
 * its own names, so it is handed to `scanBindings` rather than skipped whole.
 */
const collectDeclaration = (tokens, start, into) => {
    let i = start;
    for ( ;; ) {
        const patternEnd = findPatternEnd(tokens, i);
        collectPattern(tokens, i, patternEnd, into);
        i = patternEnd;
        if ( i >= tokens.length ) return i;

        const boundary = tokens[i];
        if ( isName(boundary) || CLOSERS.has(boundary.value) || boundary.value === ';' )
            return i;
        if ( boundary.value === ',' ) { i++; continue; }

        // boundary is '=': scan the initializer for constructs that bind
        // their own names, then resume after it.
        i++;
        const initStart = i;
        let depth = 0;
        for ( ; i < tokens.length; i++ ) {
            const token = tokens[i];
            if ( token.type !== 'punct' ) continue;
            if ( OPENERS[token.value] ) { depth++; continue; }
            if ( CLOSERS.has(token.value) ) {
                if ( depth === 0 ) break;
                depth--;
                continue;
            }
            if ( depth === 0 && (token.value === ',' || token.value === ';') ) break;
        }
        scanBindings(tokens, initStart, i, into);

        if ( i >= tokens.length || tokens[i].value !== ',' ) return i;
        i++;
    }
};

/**
 * The binding constructs `collectBindings` looks for — arrow/function/class
 * declarations, `catch`, a `var`/`let`/`const` head — restricted to
 * `[start, end)`. Shared by the top-level scan and by `collectDeclaration`,
 * which needs it to see an arrow or function inside an initializer without
 * also handing it the pattern-only tokens around it.
 */
const scanBindings = (tokens, start, end, bound) => {
    for ( let i = start; i < end; i++ ) {
        const token = tokens[i];

        if ( isPunct(token, '=>') ) {
            const before = tokens[i - 1];
            if ( isPunct(before, ')') ) {
                // Walk back to the `(` this `)` closes.
                let depth = 0;
                for ( let j = i - 1; j >= start; j-- ) {
                    const back = tokens[j];
                    if ( back.type !== 'punct' ) continue;
                    if ( CLOSERS.has(back.value) ) depth++;
                    else if ( OPENERS[back.value] ) {
                        depth--;
                        if ( depth === 0 ) {
                            collectPattern(tokens, j + 1, i - 1, bound);
                            break;
                        }
                    }
                }
            } else if ( isName(before) && ! KEYWORDS.has(before.value) ) {
                bound.add(before.value);
            }
            continue;
        }

        if ( ! isName(token) ) continue;

        if ( DECLARATORS.has(token.value) ) {
            i = collectDeclaration(tokens, i + 1, bound) - 1;
            continue;
        }

        if ( token.value === 'function' || token.value === 'class' ) {
            const next = tokens[i + 1];
            // `function *gen()` and `function ()` both leave the name absent.
            const nameAt = isPunct(next, '*') ? i + 2 : i + 1;
            if ( isName(tokens[nameAt]) && ! KEYWORDS.has(tokens[nameAt].value) )
                bound.add(tokens[nameAt].value);
            continue;
        }

        if ( token.value === 'catch' && isPunct(tokens[i + 1], '(') ) {
            const close = matchGroup(tokens, i + 1);
            if ( close !== -1 ) collectPattern(tokens, i + 2, close, bound);
            continue;
        }

        // `name(...) {` is a function or method definition — every construct
        // that reads the same way (`if`, `for`, `while`, `switch`, `catch`) is
        // a keyword and never reaches here. Its parameters are bindings, and so
        // is the name itself.
        if ( ! KEYWORDS.has(token.value) && isPunct(tokens[i + 1], '(') ) {
            const close = matchGroup(tokens, i + 1);
            if ( close !== -1 && isPunct(tokens[close + 1], '{') ) {
                bound.add(token.value);
                collectPattern(tokens, i + 2, close, bound);
            }
            continue;
        }
    }
};

/**
 * Every name the source binds, wherever it binds it. Over-approximate on
 * purpose: the alternative is a scope tree, and the cost of getting one wrong
 * is rejecting a handler that works.
 *
 * @param {import('./tokenize.js').Token[]} tokens
 * @returns {Set<string>}
 */
export const collectBindings = (tokens) => {
    /** @type {Set<string>} */
    const bound = new Set();
    scanBindings(tokens, 0, tokens.length, bound);

    // An anonymous `function (a, b) {`, whose parameters the pass above only
    // reaches when the function is named.
    for ( let i = 0; i < tokens.length; i++ ) {
        if ( ! isName(tokens[i]) || tokens[i].value !== 'function' ) continue;
        let open = i + 1;
        while ( open < tokens.length && ! isPunct(tokens[open], '(') ) {
            if ( isPunct(tokens[open], '{') ) break;
            open++;
        }
        if ( ! isPunct(tokens[open], '(') ) continue;
        const close = matchGroup(tokens, open);
        if ( close !== -1 ) collectPattern(tokens, open + 1, close, bound);
    }

    return bound;
};

/**
 * Identifiers the source *reads*, in order and without duplicates. Property
 * names, keys and labels are not reads: `a.b` reaches `b` through `a`, and only
 * `a` has to resolve to anything.
 *
 * @param {import('./tokenize.js').Token[]} tokens
 * @returns {string[]}
 */
export const collectReferences = (tokens) => {
    const seen = new Set();
    /** @type {string[]} */
    const names = [];

    for ( let i = 0; i < tokens.length; i++ ) {
        const token = tokens[i];
        if ( ! isName(token) || KEYWORDS.has(token.value) ) continue;

        const before = tokens[i - 1];
        const after = tokens[i + 1];

        // `a.b`, `a?.b`, `#private`, and the target of `break`/`continue`.
        if ( isPunct(before, '.') || isPunct(before, '?.') || isPunct(before, '#') )
            continue;
        if ( isName(before) && (before.value === 'break' || before.value === 'continue') )
            continue;
        // A property key or a label. Also swallows the middle of a ternary,
        // which is a name this scan then does not check — the safe direction.
        if ( isPunct(after, ':') ) continue;
        // A method or function definition, whose name is not a read.
        if ( isPunct(after, '(') ) {
            const close = matchGroup(tokens, i + 1);
            if ( close !== -1 && isPunct(tokens[close + 1], '{') ) continue;
        }

        if ( seen.has(token.value) ) continue;
        seen.add(token.value);
        names.push(token.value);
    }

    return names;
};

/**
 * Throws for the first identifier a handler names and cannot reach. Returns the
 * bound names, which is only useful to a test.
 *
 * @param {string} source Serialized handler source.
 * @returns {{ bound: Set<string>, references: string[] }}
 */
export const scanHandlerSource = (source) => {
    const tokens = tokenize(source);
    const bound = collectBindings(tokens);
    const references = collectReferences(tokens);

    for ( const name of references ) {
        if ( bound.has(name) || HANDLER_GLOBALS.has(name) ) continue;
        throw freeVariable(name);
    }

    return { bound, references };
};
