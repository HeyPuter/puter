import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isStorageLimitError, promptIfStorageLimitError } from './storageLimitPrompt.js';

// Every filesystem operation routes its rejections through this helper, so an
// over-quota copy or mkdir prompts the user to upgrade exactly like an
// over-quota upload does — instead of only rejecting into an app that may
// swallow the error.
describe('isStorageLimitError', () => {
    it.each([
        [{ code: 'storage_limit_reached' }, true],
        [{ status: 413 }, true],
        [{ code: 'NOT_ENOUGH_SPACE' }, true],
        [{ code: 'storage_limit_reached', status: 413 }, true],
        [{ code: 'item_with_same_name_exists' }, false],
        [{ status: 403 }, false],
        [{ message: 'network error' }, false],
        ['Storage limit reached', false],
        [null, false],
        [undefined, false],
    ])('%o -> %s', (error, expected) => {
        expect(isStorageLimitError(error)).toBe(expected);
    });
});

describe('promptIfStorageLimitError', () => {
    const origPuter = globalThis.puter;

    beforeEach(() => {
        globalThis.puter = { env: 'app', ui: { requestUpgrade: vi.fn() } };
    });

    afterEach(() => {
        globalThis.puter = origPuter;
    });

    it('hands off to the app upgrade flow inside an app', () => {
        promptIfStorageLimitError({ code: 'storage_limit_reached' });
        expect(globalThis.puter.ui.requestUpgrade).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a non-storage rejection', () => {
        promptIfStorageLimitError({ status: 403 });
        promptIfStorageLimitError(new Error('offline'));
        expect(globalThis.puter.ui.requestUpgrade).not.toHaveBeenCalled();
    });

    it('outside an app it warns rather than throwing without a DOM', () => {
        // In node there is no document; showUsageLimitDialog logs instead.
        globalThis.puter.env = 'web';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() =>
            promptIfStorageLimitError({ status: 413 }),
        ).not.toThrow();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
