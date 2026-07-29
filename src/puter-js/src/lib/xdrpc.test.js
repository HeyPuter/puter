import { describe, expect, it } from 'vitest';
import { CallbackManager, Dehydrator, Hydrator } from './xdrpc.js';

/**
 * Build `{ [key]: value }` with `key` as a real own property — an object
 * literal can't spell that for `__proto__`, but a message from the other
 * document (or any JSON payload) carries it just fine.
 */
const withOwnKey = (key, value) =>
    JSON.parse(`{"${key}":${JSON.stringify(value)}}`);

describe('xdrpc prototype safety', () => {
    const prototypeKeys = ['__proto__', 'constructor', 'toString'];

    it.each(prototypeKeys)(
        'hydrate keeps a `%s` key as data on the rebuilt object',
        (key) => {
            const hydrator = new Hydrator({ target: { postMessage: () => {} } });
            const result = hydrator.hydrate(
                withOwnKey(key, { escalated: true }),
            );
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            expect(result.escalated).toBeUndefined();
            expect(Object.hasOwn(result, key)).toBe(true);
        },
    );

    it.each(prototypeKeys)(
        'dehydrate keeps a `%s` key as data on the rebuilt object',
        (key) => {
            const dehydrator = new Dehydrator({
                callbackManager: new CallbackManager(),
            });
            const result = dehydrator.dehydrate(
                withOwnKey(key, { escalated: true }),
            );
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            expect(result.escalated).toBeUndefined();
            expect(Object.hasOwn(result, key)).toBe(true);
        },
    );

    it('leaves the shared prototype untouched', () => {
        const hydrator = new Hydrator({ target: { postMessage: () => {} } });
        hydrator.hydrate(withOwnKey('__proto__', { escalated: true }));
        expect({}.escalated).toBeUndefined();
    });

    it('still round-trips ordinary values and callback stubs', () => {
        const callbackManager = new CallbackManager();
        const dehydrated = new Dehydrator({ callbackManager }).dehydrate({
            name: 'x',
            nested: { list: [1, 2], fn: () => 'called' },
        });
        expect(dehydrated).toMatchObject({
            name: 'x',
            nested: { list: [1, 2] },
        });

        const posted = [];
        const hydrated = new Hydrator({
            target: { postMessage: (msg) => posted.push(msg) },
        }).hydrate(dehydrated);
        expect(hydrated.name).toBe('x');
        expect(hydrated.nested.list).toEqual([1, 2]);

        hydrated.nested.fn('arg');
        expect(posted).toHaveLength(1);
        expect(posted[0].args).toEqual(['arg']);
    });
});
