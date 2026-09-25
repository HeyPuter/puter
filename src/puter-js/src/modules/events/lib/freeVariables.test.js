import { describe, expect, it } from 'vitest';
import { scanHandlerSource } from './freeVariables.js';
import { tokenize } from './tokenize.js';

const scan = (source) => scanHandlerSource(source);

const rejects = (source) => {
    try {
        scan(source);
    } catch (error) {
        return error;
    }
    throw new Error(`expected a rejection for: ${source}`);
};

/** Handlers a developer would plausibly write, none of which close over anything. */
const ACCEPTED = [
    [
        'the design`s example handler',
        `async ({ event, ctx, user, fetch, ack }) => {
            await fetch(ctx.endpoint, {
                method: 'POST',
                body: JSON.stringify({ path: event.path, key: ctx.apiKey }),
            });
            await ack();
        }`,
    ],
    ['a bare arrow with one parameter', 'delivery => console.log(delivery.event.op)'],
    ['a named function declaration', 'function onWrite ({ event }) { console.log(event.uid); }'],
    ['an anonymous function expression', 'function ({ event, ctx }) { return ctx.prefix + event.path; }'],
    ['locals declared with const and let', '({ event }) => { const p = event.path; let n = p.length; return n; }'],
    ['a destructured local with a default', '({ ctx }) => { const { retries = 3, url } = ctx; return url.repeat(retries); }'],
    ['an array destructuring local', '({ event }) => { const [head, ...rest] = event.path.split("/"); return rest.concat(head); }'],
    ['a for-of loop variable', '({ ctx }) => { for (const item of ctx.items) console.log(item); }'],
    ['a classic for loop', '({ ctx }) => { for (let i = 0; i < ctx.n; i++) console.log(i); }'],
    ['a catch parameter', '({ ctx }) => { try { JSON.parse(ctx.body); } catch (err) { console.warn(err); } }'],
    ['a nested function and its parameters', '({ event }) => { const f = (a, b) => a + b; return f(1, event.seq); }'],
    ['a class declaration with methods', '({ ctx }) => { class Sink { constructor (url) { this.url = url; } send (body) { return fetch(this.url, { body }); } } return new Sink(ctx.url); }'],
    ['object property keys that share a name with nothing', '({ event }) => ({ endpoint: event.path, retries: 2 })'],
    ['a template literal reading only ctx', '({ ctx, event }) => `${ctx.base}/${event.uid}`'],
    ['a regex literal that looks like division', '({ event }) => /\\/tmp\\/[a-z]+/.test(event.path)'],
    ['a comment naming something undeclared', '({ event }) => { /* endpoint is gone now */ return event.uid; }'],
    ['a string naming something undeclared', '({ event }) => event.path + "endpoint"'],
    ['runtime globals', '({ event }) => { console.log(Date.now(), Math.max(1, event.seq), JSON.stringify(event), new URL("https://x.example")); }'],
    ['the delivered puter, reached through `user`', '({ user }) => user.fs.read("/x").then(r => user.print(r))'],
    ['optional chaining and computed member access', '({ event, ctx }) => event?.meta?.[ctx.key]'],
    ['a shorthand method on an object literal', '({ event }) => ({ run (x) { return x + event.seq; } })'],
    ['an async generator with a yield', 'async function* ({ ctx }) { yield ctx.first; }'],
    ['a label and a break to it', '({ ctx }) => { outer: for (const a of ctx.rows) { break outer; } }'],
    ['a label and a continue to it', '({ ctx, event }) => { loop: while (ctx.n-- > 0) { if (ctx.skip) continue loop; event.push(ctx.n); } }'],
    ['a getter on a class', '({ ctx }) => { class C { get url () { return ctx.url; } } return new C(); }'],
    [
        'the design doc`s own example, verbatim',
        `async ({ event, ctx, user, fetch, ack }) => {
            const meta = await user.fs.stat(event.path);
            if (meta.size < ctx.minSize) return ack();
            await fetch(ctx.endpoint, {
                method: 'POST',
                body: JSON.stringify({ uid: event.uid, size: meta.size }),
            });
            await ack();
        }`,
    ],
    ['object shorthand naming a declared local', '({ event }) => { const endpoint = event.path; return { endpoint }; }'],
    ['rest in a destructured object parameter', 'async ({ event, ...rest }) => { return rest.foo + event.seq; }'],
    ['typeof on a bound parameter', '({ event }) => typeof event === "object"'],
    // Regex directly after a block-closing `}`, with no `return`/other
    // regex-triggering keyword in between — the tokenizer has to decide this
    // is a regex from the `}` alone, not from what came before it.
    [
        'a regex literal right after a closed block, not division',
        '({ ctx }) => { if (ctx.on) { console.log(ctx.on); } /ab+c/.test(ctx.body); }',
    ],
];

/** Handlers that close over something the serialized source cannot carry. */
const REJECTED = [
    ['a closure over an outer const', '({ event }) => fetch(endpoint, { body: event.path })', 'endpoint'],
    ['a closure used as a bare value', '({ event }) => event.path + suffix', 'suffix'],
    ['a closure inside a template hole', '({ event }) => `${base}/${event.uid}`', 'base'],
    ['a closure inside a nested function', '({ event }) => { const f = () => apiKey; return f(); }', 'apiKey'],
    ['a closure used as a call target', '({ event }) => publish(event)', 'publish'],
    ['a closure in a default parameter value', '({ event }, retries = maxRetries) => retries + event.seq', 'maxRetries'],
    ['a closure in a destructuring default', '({ event, timeout = defaultTimeout }) => timeout + event.seq', 'defaultTimeout'],
    ['a closure in a for-of subject', '() => { for (const row of rows) console.log(row); }', 'rows'],
    ['a closure used with new', '({ ctx }) => new Sink(ctx.url)', 'Sink'],
    ['a closure in a declaration initializer', '({ event }) => { const target = destination; return target + event.uid; }', 'destination'],
    ['a closure in an object value position', '({ event }) => ({ endpoint: outerEndpoint, path: event.path })', 'outerEndpoint'],
    ['a closure in a computed key', '({ event }) => ({ [outerKey]: event.uid })', 'outerKey'],
    // Shorthand `{ endpoint }` is sugar for `{ endpoint: endpoint }` — a
    // *reference*, not a key — and has to be told apart from `{ endpoint: x }`
    // above, where `endpoint` is a label nothing needs to resolve.
    ['a closure read through object shorthand', '({ event }) => ({ endpoint, path: event.path })', 'endpoint'],
    ['typeof on an undeclared name', '({ event }) => typeof missingGlobal === "undefined" ? event.seq : 0', 'missingGlobal'],
    // An events worker has no ambient SDK, so a handler that reaches for one
    // has to be caught here rather than on its first delivery.
    ['the ambient SDK a client has and a worker does not', '({ event }) => puter.print(event.path)', 'puter'],
    ['the worker`s own identity', '({ event }) => me.puter.fs.write(event.path, "x")', 'me'],
];

describe('handlers a scan accepts', () => {
    it.each(ACCEPTED)('accepts %s', (_label, source) => {
        expect(() => scan(source)).not.toThrow();
    });
});

describe('handlers a scan rejects', () => {
    it.each(REJECTED)('rejects %s', (_label, source, identifier) => {
        const error = rejects(source);
        expect(error.code).toBe('events_handler_free_variable');
        expect(error.message).toContain(`\`${identifier}\``);
    });

    it('points an ambient-SDK reference at the binding that replaces it', () => {
        const error = rejects('({ event }) => puter.print(event.path)');
        expect(error.code).toBe('events_handler_free_variable');
        expect(error.message).toContain('`user`');
    });

    it('names the identifier so the developer knows what to move into context', () => {
        const error = rejects('({ event }) => fetch(ingestUrl, { body: event.path })');
        expect(error.message).toContain('`ingestUrl`');
        expect(error.message).toContain('ctx');
    });
});

describe('what the tokenizer hides from the scan', () => {
    it('drops strings, comments and regex bodies', () => {
        const values = tokenize(
            '({ a }) => { /* comment */ const s = "text"; return /pattern/.test(s) && a; }',
        ).map(token => token.value);

        expect(values).not.toContain('comment');
        expect(values).not.toContain('text');
        expect(values).not.toContain('pattern');
        expect(values).toContain('a');
    });

    it('keeps the code inside a template hole', () => {
        const values = tokenize('`prefix ${value} suffix`').map(token => token.value);
        expect(values).toContain('value');
        expect(values).not.toContain('prefix');
        expect(values).not.toContain('suffix');
    });

    it('reads a nested template inside a hole', () => {
        expect(() => scan('({ ctx }) => `${`${ctx.a}`}`')).not.toThrow();
        expect(rejects('({ ctx }) => `${`${nested}`}`').message).toContain('`nested`');
    });

    it('does not mistake division for a regex', () => {
        expect(() => scan('({ ctx }) => (ctx.a + ctx.b) / 2')).not.toThrow();
    });
});

/**
 * Known misses, not bugs: the scan collects bindings flat rather than
 * per-scope and treats a name before `:` as a label/key rather than a
 * reference (see the module doc). Both directions only ever *accept* code
 * that closes over something real — they never reject code that would have
 * worked, which is the safe side to be wrong on. Pinned here so a future
 * tightening of the scan is a deliberate choice, not an accidental one.
 */
describe('known accept-biased misses (documented, not fixed)', () => {
    it('does not resolve the truthy arm of a ternary, so a free name there slips through', () => {
        // `freeVar` sits directly before the ternary`s `:` and reads the same
        // as a label, so the scan skips it — even though it is a real,
        // undeclared reference here.
        expect(() => scan('({ event }) => event.ok ? freeVar : event.seq')).not.toThrow();
    });

    it('over-binds a destructuring rename`s source key', () => {
        // `{ event: renamed }` binds only `renamed` — `event` is the property
        // being read off the parameter, not a local. The scan collects every
        // name in a pattern as bound, so it treats `event` as available too,
        // and a bare reference to it below is not caught even though it would
        // be a ReferenceError at runtime.
        expect(() =>
            scan('({ event: renamed }) => { return renamed.x + event; }'),
        ).not.toThrow();
    });
});

describe('an arrow inside a declaration initializer binds its own params', () => {
    it('accepts a callback param the declaration used to swallow before it was ever scanned', () => {
        expect(() =>
            scan('({ event }) => { const ids = event.items.map(x => x.id); return ids; }'),
        ).not.toThrow();
    });

    it('accepts a param bound through a nested function expression, not just an arrow', () => {
        expect(() =>
            scan('({ event }) => { const ids = event.items.map(function (x) { return x.id; }); return ids; }'),
        ).not.toThrow();
    });

    it('blames the closure in a default value, not the parameter that carries it', () => {
        const error = rejects('({ event }) => { const f = (a = SECRET) => a; return f(event.seq); }');
        expect(error.message).toContain('`SECRET`');
        expect(error.message).not.toContain('`a`');
    });

    it('still binds every comma-separated declarator once the initializer is scanned separately', () => {
        const { bound } = scan('({ event }) => { const a = 1, b = event.seq, c = x => x; return a + b + c(1); }');
        expect(bound.has('a')).toBe(true);
        expect(bound.has('b')).toBe(true);
        expect(bound.has('c')).toBe(true);
    });
});

describe('a `,` inside a call argument list is not a pattern separator', () => {
    it('rejects a closure passed as a second argument to a declaration initializer', () => {
        const error = rejects('({ event }) => { const u = new URL(event.path, SECRET); return u.href; }');
        expect(error.code).toBe('events_handler_free_variable');
        expect(error.message).toContain('`SECRET`');
    });

    it('accepts the same shape when every argument is a bound reference', () => {
        expect(() =>
            scan('({ ctx }) => { const u = new URL(ctx.path, ctx.base); return u.href; }'),
        ).not.toThrow();
    });
});

describe('a destructuring default no longer blocks the keys after it (regression)', () => {
    it('binds a key that follows a default value in the same pattern', () => {
        expect(() =>
            scan('({ ctx }) => { const { retries = 3, url, other } = ctx; return url + other + retries; }'),
        ).not.toThrow();
    });
});

describe('what the scan reports back', () => {
    it('lists what the source binds and what it reads', () => {
        const { bound, references } = scan('({ event, ctx }) => { const n = ctx.n; return event.seq + n; }');

        expect([...bound].sort()).toEqual(['ctx', 'event', 'n']);
        expect(references).toEqual(['event', 'ctx', 'n']);
    });
});
