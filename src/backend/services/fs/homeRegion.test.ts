import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_REGION, resolveHomeRegion } from './homeRegion.js';

describe('resolveHomeRegion', () => {
    it("prefers the account's own home region", () => {
        expect(
            resolveHomeRegion({ home: 'node-a', signup_server: 'node-b' }),
        ).toBe('node-a');
    });

    it('falls back to the server that served the signup', () => {
        // Every account that predates the `home` column is this case.
        expect(resolveHomeRegion({ home: null, signup_server: 'node-b' })).toBe(
            'node-b',
        );
        expect(resolveHomeRegion({ signup_server: 'node-c' })).toBe('node-c');
    });

    it('falls back to the primary region when neither is set', () => {
        expect(resolveHomeRegion({ home: null, signup_server: null })).toBe(
            'oregon',
        );
        expect(resolveHomeRegion({})).toBe(DEFAULT_HOME_REGION);
    });

    it('treats an empty string as unset rather than as a region', () => {
        expect(resolveHomeRegion({ home: '', signup_server: 'node-d' })).toBe(
            'node-d',
        );
        expect(resolveHomeRegion({ home: '', signup_server: '' })).toBe(
            'oregon',
        );
    });
});
