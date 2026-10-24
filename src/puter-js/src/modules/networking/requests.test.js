import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// pFetch is a thin wrapper over the epoxy client, so the client module is
// stubbed: the tests care about delegation, cache invalidation, and logging.
const mockGetEpoxyClient = vi.fn();
const mockClearEpoxyClientCache = vi.fn();
vi.mock('./index.js', () => ({
    getEpoxyClient: (...args) => mockGetEpoxyClient(...args),
    clearEpoxyClientCache: (...args) => mockClearEpoxyClientCache(...args),
}));

const { pFetch } = await import('./requests.js');

const origPuter = globalThis.puter;

let mockClientFetch;
let logRequest;

// Matches what the epoxy client resolves to: a Response-like object.
const RESPONSE = { status: 204, statusText: 'No Content' };

beforeEach(() => {
    mockClearEpoxyClientCache.mockReset();
    mockClientFetch = vi.fn(async () => RESPONSE);
    mockGetEpoxyClient.mockReset()
        .mockResolvedValue({ fetch: (...args) => mockClientFetch(...args) });

    logRequest = vi.fn();
    globalThis.puter = {
        apiCallLogger: { isEnabled: () => true, logRequest },
    };
});

afterEach(() => {
    globalThis.puter = origPuter;
});

describe('pFetch delegation', () => {
    it('passes its arguments straight through and returns the response', async () => {
        const init = { method: 'POST', body: 'payload' };

        const response = await pFetch('https://example.com/api', init);

        expect(response).toBe(RESPONSE);
        expect(mockClientFetch).toHaveBeenCalledWith('https://example.com/api', init);
    });

    it('works with no init argument', async () => {
        await pFetch('https://example.com/api');

        expect(mockClientFetch).toHaveBeenCalledWith('https://example.com/api');
    });

    it('rethrows a failed request', async () => {
        mockClientFetch.mockRejectedValue(new Error('socket closed'));

        await expect(pFetch('https://example.com')).rejects.toThrow('socket closed');
    });

    it('drops the cached client when the request fails', async () => {
        mockClientFetch.mockRejectedValue(new Error('socket closed'));

        await expect(pFetch('https://example.com')).rejects.toThrow();

        expect(mockClearEpoxyClientCache).toHaveBeenCalledTimes(1);
    });

    // Nothing was cached if the client itself never came up, so there is
    // nothing to invalidate -- clearing here would just mask the real failure.
    it('leaves the cache alone when the client could not be created', async () => {
        mockGetEpoxyClient.mockRejectedValue(new Error('wasm unavailable'));

        await expect(pFetch('https://example.com')).rejects.toThrow('wasm unavailable');

        expect(mockClearEpoxyClientCache).not.toHaveBeenCalled();
    });
});

describe('pFetch api call logging', () => {
    it('logs the response status on success', async () => {
        await pFetch('https://example.com/api', { method: 'PUT' });

        expect(logRequest).toHaveBeenCalledTimes(1);
        expect(logRequest).toHaveBeenCalledWith(expect.objectContaining({
            service: 'network',
            operation: 'pFetch',
            params: { url: 'https://example.com/api', method: 'PUT' },
            result: { status: 204, statusText: 'No Content' },
        }));
    });

    it('logs the message and stack on failure', async () => {
        const failure = new Error('socket closed');
        mockClientFetch.mockRejectedValue(failure);

        await expect(pFetch('https://example.com/api')).rejects.toThrow();

        const [entry] = logRequest.mock.calls[0];
        expect(entry.error.message).toBe('socket closed');
        expect(entry.error.stack).toBe(failure.stack);
    });

    it('stringifies a non-Error rejection reason', async () => {
        mockClientFetch.mockRejectedValue('just a string');

        await expect(pFetch('https://example.com/api')).rejects.toBe('just a string');

        const [entry] = logRequest.mock.calls[0];
        expect(entry.error.message).toBe('just a string');
        expect(entry.error.stack).toBeUndefined();
    });

    it('stays quiet while logging is disabled', async () => {
        globalThis.puter.apiCallLogger.isEnabled = () => false;

        await pFetch('https://example.com/api');

        expect(logRequest).not.toHaveBeenCalled();
    });

    it('does not require a puter runtime to be present', async () => {
        globalThis.puter = undefined;

        await expect(pFetch('https://example.com/api')).resolves.toBe(RESPONSE);
    });

    describe('request description', () => {
        it('reads a string url and defaults the method to GET', async () => {
            await pFetch('https://example.com/plain');

            const [entry] = logRequest.mock.calls[0];
            expect(entry.params).toEqual({ url: 'https://example.com/plain', method: 'GET' });
        });

        it('serialises a URL instance', async () => {
            await pFetch(new URL('https://example.com/from-url'));

            const [entry] = logRequest.mock.calls[0];
            expect(entry.params.url).toBe('https://example.com/from-url');
        });

        it('reads url and method off a Request object', async () => {
            await pFetch(new Request('https://example.com/req', { method: 'DELETE' }));

            const [entry] = logRequest.mock.calls[0];
            expect(entry.params).toEqual({ url: 'https://example.com/req', method: 'DELETE' });
        });

        // An explicit init overrides the method carried by the request object.
        it('prefers the init method over the request object method', async () => {
            await pFetch(
                new Request('https://example.com/req', { method: 'DELETE' }),
                { method: 'PATCH' },
            );

            const [entry] = logRequest.mock.calls[0];
            expect(entry.params.method).toBe('PATCH');
        });

        it('records an undefined url for an unrecognised resource', async () => {
            await expect(pFetch(42)).rejects.toThrow(TypeError);

            const [entry] = logRequest.mock.calls[0];
            expect(entry.params).toEqual({ url: undefined, method: 'GET' });
        });
    });
});

// The pre-epoxy client made these checks itself; epoxy reports the same
// failures as opaque wasm values, so they stay client-side and keep rejecting
// with exactly what they used to.
describe('pFetch request validation', () => {
    it('refuses a URL scheme it cannot tunnel without dialing', async () => {
        await expect(pFetch('ftp://example.com/file.txt')).rejects.toBe(
            'Failed to fetch. URL scheme "ftp:" is not supported.',
        );

        expect(mockGetEpoxyClient).not.toHaveBeenCalled();
        expect(mockClientFetch).not.toHaveBeenCalled();
    });

    it('surfaces a malformed request as a TypeError without dialing', async () => {
        await expect(pFetch('http://example.com/', {
            method: 'GET',
            body: 'not allowed on a GET',
        })).rejects.toThrow(TypeError);

        expect(mockGetEpoxyClient).not.toHaveBeenCalled();
    });

    it('rejects a Content-Length that disagrees with the body', async () => {
        await expect(pFetch('http://example.com/', {
            method: 'POST',
            headers: { 'content-length': '999' },
            body: 'short',
        })).rejects.toBe(
            'Content-Length header does not match the body length. Please check your request.',
        );

        expect(mockGetEpoxyClient).not.toHaveBeenCalled();
    });

    it('accepts a Content-Length that matches the body', async () => {
        await pFetch('http://example.com/', {
            method: 'POST',
            headers: { 'content-length': '5' },
            body: 'short',
        });

        expect(mockClientFetch).toHaveBeenCalledTimes(1);
    });

    // Validation builds a Request of its own; doing that from the caller's
    // Request would consume the body epoxy is about to send.
    it('leaves the body of a caller-supplied Request intact', async () => {
        const request = new Request('https://example.com/api', {
            method: 'POST',
            body: 'payload',
        });

        await pFetch(request);

        expect(mockClientFetch).toHaveBeenCalledWith(request);
        expect(request.bodyUsed).toBe(false);
        await expect(request.text()).resolves.toBe('payload');
    });

    it('logs a validation failure without clearing the client cache', async () => {
        await expect(pFetch('ftp://example.com/file.txt')).rejects.toBeTruthy();

        const [entry] = logRequest.mock.calls[0];
        expect(entry.error.message).toBe(
            'Failed to fetch. URL scheme "ftp:" is not supported.',
        );
        expect(mockClearEpoxyClientCache).not.toHaveBeenCalled();
    });
});
