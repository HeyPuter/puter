import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

// Loaded natively: the module's CommonJS export branch trips the test module runner.
const { default: localStorageMemory } = createRequire(import.meta.url)('./localStorage.js');

beforeEach(() => {
    localStorageMemory.clear();
});

describe('in-memory localStorage', () => {
    it('returns null for a key that was never set', () => {
        expect(localStorageMemory.getItem('missing')).toBeNull();
        expect(localStorageMemory.length).toBe(0);
    });

    it('stores every value as a string', () => {
        localStorageMemory.setItem('count', 3);
        localStorageMemory.setItem('flag', false);
        localStorageMemory.setItem('nothing', null);
        expect(localStorageMemory.getItem('count')).toBe('3');
        expect(localStorageMemory.getItem('flag')).toBe('false');
        expect(localStorageMemory.getItem('nothing')).toBe('null');
    });

    it('counts each key once, however often it is set', () => {
        localStorageMemory.setItem('token', 'a');
        localStorageMemory.setItem('token', 'b');
        localStorageMemory.setItem('origin', 'https://api.puter.com');
        expect(localStorageMemory.length).toBe(2);
        expect(localStorageMemory.getItem('token')).toBe('b');
    });

    it('removes a key, and treats setting undefined as removing', () => {
        localStorageMemory.setItem('token', 'a');
        localStorageMemory.setItem('origin', 'https://api.puter.com');
        localStorageMemory.removeItem('token');
        localStorageMemory.removeItem('token');
        localStorageMemory.setItem('origin', undefined);
        expect(localStorageMemory.getItem('token')).toBeNull();
        expect(localStorageMemory.getItem('origin')).toBeNull();
        expect(localStorageMemory.length).toBe(0);
    });

    it('lists keys by position, in the order they were first set', () => {
        localStorageMemory.setItem('token', 'a');
        localStorageMemory.setItem('origin', 'https://api.puter.com');
        expect([localStorageMemory.key(0), localStorageMemory.key(1), localStorageMemory.key(2)])
            .toEqual(['token', 'origin', null]);
    });

    it('forgets everything on clear', () => {
        localStorageMemory.setItem('token', 'a');
        localStorageMemory.clear();
        expect(localStorageMemory.length).toBe(0);
        expect(localStorageMemory.getItem('token')).toBeNull();
        expect(localStorageMemory.key(0)).toBeNull();
    });
});
