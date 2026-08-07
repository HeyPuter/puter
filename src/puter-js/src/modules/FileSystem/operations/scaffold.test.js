import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAuthenticated, firstDefined, isOptionsObject, parseOperationArgs } from './scaffold.js';

describe('parseOperationArgs', () => {
    it('returns a copy of an options object', () => {
        const options = { path: '/a' };
        const parsed = parseOperationArgs([options], ['path']);
        expect(parsed).toEqual({ path: '/a' });
        expect(parsed).not.toBe(options);
    });

    it('binds positional arguments to their names', () => {
        expect(parseOperationArgs(['/a', '/b'], ['source', 'destination']))
            .toEqual({ source: '/a', destination: '/b' });
    });

    it('merges a trailing options object over the positional names', () => {
        expect(parseOperationArgs(['/a', { overwrite: true }], ['path']))
            .toEqual({ path: '/a', overwrite: true });
    });

    it('picks up trailing success and error callbacks', () => {
        const success = () => {};
        const error = () => {};
        expect(parseOperationArgs(['/a', success, error], ['path']))
            .toEqual({ path: '/a', success, error });
    });

    it('picks up callbacks that follow an options object', () => {
        const success = () => {};
        expect(parseOperationArgs(['/a', { overwrite: true }, success], ['path']))
            .toEqual({ path: '/a', overwrite: true, success });
    });

    it('skips an explicit undefined in the options slot', () => {
        const success = () => {};
        expect(parseOperationArgs(['/a', undefined, success], ['path']))
            .toEqual({ path: '/a', success });
    });

    it('leaves an omitted positional argument unset so options can supply it', () => {
        expect(parseOperationArgs([undefined, { path: '/a' }], ['path']))
            .toEqual({ path: '/a' });
    });

    it('treats an array as a positional argument, not as options', () => {
        expect(parseOperationArgs([['/a', '/b']], ['paths']))
            .toEqual({ paths: ['/a', '/b'] });
    });

    it('treats a File as a positional argument, not as options', () => {
        const file = new File(['x'], 'x.txt');
        expect(parseOperationArgs([file], ['data'])).toEqual({ data: file });
    });

    it('handles operations that take no positional arguments', () => {
        const success = () => {};
        expect(parseOperationArgs([success], [])).toEqual({ success });
    });
});

describe('isOptionsObject', () => {
    it.each([
        [{}, true],
        [{ path: '/a' }, true],
        ['/a', false],
        [null, false],
        [undefined, false],
        [[], false],
        [new Blob(['x']), false],
    ])('%s -> %s', (value, expected) => {
        expect(isOptionsObject(value)).toBe(expected);
    });
});

describe('firstDefined', () => {
    it('prefers the first name that is defined', () => {
        expect(firstDefined({ new_name: 'b' }, 'newName', 'new_name')).toBe('b');
        expect(firstDefined({ newName: 'a', new_name: 'b' }, 'newName', 'new_name')).toBe('a');
    });

    it('keeps defined-but-falsy values', () => {
        expect(firstDefined({ dedupeName: false }, 'dedupeName', 'dedupe_name')).toBe(false);
    });

    it('is undefined when no name is set', () => {
        expect(firstDefined({}, 'newName', 'new_name')).toBeUndefined();
    });
});

describe('ensureAuthenticated', () => {
    const origPuter = globalThis.puter;

    beforeEach(() => {
        globalThis.puter = { authToken: undefined, env: 'web', ui: {} };
    });

    afterEach(() => {
        globalThis.puter = origPuter;
    });

    it('does nothing when a token is already held', async () => {
        globalThis.puter.authToken = 'token';
        globalThis.puter.ui.authenticateWithPuter = vi.fn();
        await ensureAuthenticated();
        expect(globalThis.puter.ui.authenticateWithPuter).not.toHaveBeenCalled();
    });

    it('does not prompt outside the web environment', async () => {
        globalThis.puter.env = 'nodejs';
        globalThis.puter.ui.authenticateWithPuter = vi.fn();
        await ensureAuthenticated();
        expect(globalThis.puter.ui.authenticateWithPuter).not.toHaveBeenCalled();
    });

    it('prompts when the web environment has no token', async () => {
        globalThis.puter.ui.authenticateWithPuter = vi.fn(async () => {});
        await ensureAuthenticated();
        expect(globalThis.puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
    });

    it('throws when the prompt fails', async () => {
        globalThis.puter.ui.authenticateWithPuter = vi.fn(async () => { throw new Error('declined'); });
        await expect(ensureAuthenticated()).rejects.toBe('Authentication failed.');
    });
});
