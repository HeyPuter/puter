import { describe, expect, it, vi } from 'vitest';
import { EventSubscription } from './subscription.js';

/**
 * `context` is one snapshot shared across every delivery (R2-16): a handler
 * that could mutate it would have every later delivery see the mutation, on
 * every subscriber sharing that context. `deliver()` is where a value crosses
 * from "stored" to "handed to the developer's code", so it is where the
 * freeze has to happen.
 */

const fakeChannel = { remove: vi.fn() };

describe('what a delivery hands the handler', () => {
    it('freezes ctx before the handler ever sees it', () => {
        const handler = vi.fn();
        const sub = new EventSubscription(fakeChannel, 'fs:~/Documents', handler);

        sub.deliver({ id: 'e1', op: 'write' }, { url: 'https://ingest.example' });

        expect(handler).toHaveBeenCalledTimes(1);
        const [{ ctx }] = handler.mock.calls[0];
        expect(Object.isFrozen(ctx)).toBe(true);
        expect(ctx).toEqual({ url: 'https://ingest.example' });
    });

    it('omits ctx entirely for a subscription that carries none', () => {
        const handler = vi.fn();
        const sub = new EventSubscription(fakeChannel, 'fs:~/Documents', handler);

        sub.deliver({ id: 'e1', op: 'write' });

        expect(handler).toHaveBeenCalledWith({ event: { id: 'e1', op: 'write' } });
        expect('ctx' in handler.mock.calls[0][0]).toBe(false);
    });

    it('does not let the handler write back into the shared context', () => {
        const handler = vi.fn((arg) => {
            expect(() => {
                arg.ctx.url = 'https://tampered.example';
            }).toThrow();
        });
        const sub = new EventSubscription(fakeChannel, 'fs:~/Documents', handler);

        sub.deliver({ id: 'e1', op: 'write' }, { url: 'https://ingest.example' });

        expect(handler).toHaveBeenCalledTimes(1);
    });
});
