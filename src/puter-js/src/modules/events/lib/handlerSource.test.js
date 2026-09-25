import { describe, expect, it } from 'vitest';
import { asExpression, sourceOf } from './handlerSource.js';

describe('sourceOf', () => {
    it('leaves function expressions, arrows and classes alone', () => {
        const cases = [
            async ({ event }) => event,
            ({ event }) => event,
            (x) => x,
            async function ingest({ event }) { return event; },
            function ingest() {},
            class Handler {},
        ];
        for ( const fn of cases )
            expect(sourceOf(fn)).toBe(Function.prototype.toString.call(fn));
    });

    it('gives a shorthand method the keyword it stringified without', () => {
        const handlers = {
            async ingest({ event, ack }) { await ack(); return event; },
            plain(event) { return event; },
            $ok_1() {},
        };
        for ( const [name, fn] of Object.entries(handlers) ) {
            const source = sourceOf(fn);
            expect(source.startsWith(fn.constructor.name === 'AsyncFunction' ? 'async function ' : 'function ')).toBe(true);
            expect(source).toContain(`${name}(`);
            // The point: it now parses as an expression on its own.
            expect(() => new Function(`return (\n${source}\n);`)).not.toThrow();
        }
    });

    it('does not touch what it cannot fix', () => {
        expect(asExpression('get value() { return 1; }')).toBe('get value() { return 1; }');
        expect(asExpression('[computed]() {}')).toBe('[computed]() {}');
        expect(asExpression('x => x')).toBe('x => x');
    });
});
