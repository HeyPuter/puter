import { describe, expect, it } from 'vitest';

const { hasOpaqueOrigin } = await import('./auth-popup.js');

/** Replaces `globalThis.location` / `globalThis.origin` for one assertion. */
const withDocument = (location, origin, fn) => {
    const descriptors = ['location', 'origin'].map(key => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
    ]);
    Object.defineProperty(globalThis, 'location', {
        value: location, configurable: true, writable: true,
    });
    Object.defineProperty(globalThis, 'origin', {
        value: origin, configurable: true, writable: true,
    });
    try {
        return fn();
    } finally {
        for ( const [key, descriptor] of descriptors ) {
            if ( descriptor ) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
};

describe('hasOpaqueOrigin', () => {
    it('is false for a page served over http(s)', () => {
        expect(withDocument(
            { protocol: 'https:' }, 'https://example.com', hasOpaqueOrigin,
        )).toBe(false);
    });

    it('is true for a page opened from disk', () => {
        expect(withDocument(
            { protocol: 'file:' }, 'null', hasOpaqueOrigin,
        )).toBe(true);
    });

    // An http page in an iframe sandboxed without allow-same-origin.
    it('is true when the browser reports no origin', () => {
        expect(withDocument(
            { protocol: 'https:' }, 'null', hasOpaqueOrigin,
        )).toBe(true);
    });

    it('is true where there is no document at all', () => {
        expect(withDocument(undefined, undefined, hasOpaqueOrigin)).toBe(true);
    });
});
