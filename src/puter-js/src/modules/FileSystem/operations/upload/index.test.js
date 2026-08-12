import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Both upload strategies are stubbed: these tests are about what `upload`
// decides before handing off, not about how bytes reach the server.
vi.mock('./signedBatchUpload.js', () => ({
    performSignedBatchUpload: vi.fn(async () => false),
}));
vi.mock('./legacyBatchUpload.js', () => ({
    performLegacyBatchUpload: vi.fn(function (ctx) {
        ctx.resolve({ uid: 'uploaded' });
    }),
}));

import upload from './index.js';
import { SPACE_CHECK_MIN_BYTES } from './constants.js';

const origXHR = globalThis.XMLHttpRequest;
const origPuter = globalThis.puter;

let fs;

const uploadOf = (bytes) => {
    const file = new File(['x'.repeat(bytes)], 'notes.txt', { type: 'text/plain' });
    return upload.call(fs, file, '/user/dir');
};

beforeEach(() => {
    globalThis.XMLHttpRequest = class {
        open () {}
        setRequestHeader () {}
        addEventListener () {}
        send () {}
    };
    fs = {
        APIOrigin: 'https://api.test',
        authToken: 'test-token',
        space: vi.fn(async () => ({ capacity: 1024 ** 3, used: 0 })),
    };
    globalThis.puter = {
        authToken: 'test-token',
        APIOrigin: 'https://api.test',
        env: 'nodejs',
        fs,
    };
});

afterEach(() => {
    globalThis.XMLHttpRequest = origXHR;
    globalThis.puter = origPuter;
    vi.clearAllMocks();
});

describe('storage capacity pre-flight', () => {
    it('is skipped for an upload below the threshold', async () => {
        await expect(uploadOf(64)).resolves.toEqual({ uid: 'uploaded' });
        expect(fs.space).not.toHaveBeenCalled();
    });

    it('runs for an upload at the threshold', async () => {
        await expect(uploadOf(SPACE_CHECK_MIN_BYTES)).resolves.toEqual({ uid: 'uploaded' });
        expect(fs.space).toHaveBeenCalledTimes(1);
    });

    it('rejects an upload that would exceed the remaining space', async () => {
        fs.space = vi.fn(async () => ({ capacity: SPACE_CHECK_MIN_BYTES, used: SPACE_CHECK_MIN_BYTES }));
        await expect(uploadOf(SPACE_CHECK_MIN_BYTES)).rejects.toMatchObject({
            code: 'NOT_ENOUGH_SPACE',
        });
    });

    it('is skipped entirely in the web environment', async () => {
        globalThis.puter.env = 'web';
        await expect(uploadOf(SPACE_CHECK_MIN_BYTES)).resolves.toEqual({ uid: 'uploaded' });
        expect(fs.space).not.toHaveBeenCalled();
    });
});
