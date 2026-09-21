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

describe('xdrpc callback source binding', () => {
    const $SCOPE = '9a9c83a4-7897-43a0-93b9-53217b84fde6';

    /** A stand-in for `globalThis` that lets a test deliver a message event. */
    const fakeWindow = () => {
        const handlers = [];
        return {
            addEventListener: (type, handler) =>
                type === 'message' && handlers.push(handler),
            deliver: event => handlers.forEach(handler => handler(event)),
        };
    };

    const register = ({ source }) => {
        const manager = new CallbackManager();
        const calls = [];
        const id = manager.register_callback((...args) => calls.push(args), source);
        const listener = fakeWindow();
        manager.attach_to_source(listener);
        return { calls, id, listener };
    };

    it('invokes a callback for a message from its registered source', () => {
        const gui = {};
        const { calls, id, listener } = register({ source: gui });
        listener.deliver({ source: gui, data: { $SCOPE, id, args: ['ok'] } });
        expect(calls).toEqual([['ok']]);
    });

    it('ignores the same message from another window', () => {
        const gui = {};
        const { calls, id, listener } = register({ source: gui });
        listener.deliver({
            source: { sibling: true },
            data: { $SCOPE, id, args: ['forged'] },
        });
        expect(calls).toEqual([]);
    });

    it('ignores a callback registered without a source', () => {
        const { calls, id, listener } = register({ source: undefined });
        listener.deliver({ source: {}, data: { $SCOPE, id, args: [] } });
        expect(calls).toEqual([]);
    });

    it('hands out ids that cannot be guessed from an earlier one', () => {
        const manager = new CallbackManager();
        const ids = Array.from({ length: 5 }, () =>
            manager.register_callback(() => {}, {}),
        );
        expect(new Set(ids).size).toBe(ids.length);
        for ( const id of ids ) {
            expect(id).toMatch(/^[0-9a-f]{32}$/);
        }
    });
});
