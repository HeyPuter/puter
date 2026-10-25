import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterJSError } from './PuterJSError.js';

const mockFetchUrl = vi.fn();
vi.mock('./networkUtils.js', async (importOriginal) => ({
    ...await importOriginal(),
    fetchUrl: (...args) => mockFetchUrl(...args),
}));

const { routeRequest } = await import('./routeRequest.js');

const puter = { APIOrigin: 'https://api.test' };

/** @param {{ status?: number, body?: unknown, json?: boolean }} opts */
const respond = ({ status = 200, body = {}, json = true } = {}) => {
    mockFetchUrl.mockResolvedValue({
        status,
        headers: { get: name => (name === 'content-type' && json ? 'application/json' : 'text/plain') },
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    });
};

beforeEach(() => {
    mockFetchUrl.mockReset();
});

describe('routeRequest', () => {
    it('sends the body and the query params that have a value, logged under the service', async () => {
        respond({ body: { ok: 1 } });
        await expect(routeRequest(puter, 'POST', '/things', {
            body: { name: 'a' },
            query: { limit: 5, cursor: null, includeTotal: undefined },
            service: 'things',
        })).resolves.toEqual({ ok: 1 });
        const [url, opts] = mockFetchUrl.mock.calls[0];
        expect(url).toBe('https://api.test/things?limit=5');
        expect(opts).toMatchObject({
            method: 'POST',
            includePuterAuth: true,
            body: '{"name":"a"}',
            logContext: { service: 'things', operation: 'POST /things' },
        });
    });

    it('keeps the server\'s code, and fills in a status-derived one when it names none', async () => {
        respond({ status: 404, body: { message: 'gone', code: 'thing_not_found' } });
        await expect(routeRequest(puter, 'GET', '/things/1', { service: 'things' }))
            .rejects.toMatchObject({ message: 'gone', code: 'thing_not_found' });

        respond({ status: 403, body: { message: 'nope' } });
        await expect(routeRequest(puter, 'GET', '/things/1', { service: 'things' }))
            .rejects.toMatchObject({ code: 'forbidden' });
        await expect(routeRequest(puter, 'GET', '/things/1', {
            service: 'things',
            statusCodes: { 403: 'permission_denied' },
        })).rejects.toMatchObject({ code: 'permission_denied' });
    });

    it('rejects a non-JSON failure with its text', async () => {
        respond({ status: 502, body: 'bad gateway', json: false });
        await expect(routeRequest(puter, 'GET', '/things', { service: 'things' }))
            .rejects.toMatchObject({ code: 'unknown_error', message: 'bad gateway' });
    });

    it('rejects a network failure as a PuterJSError', async () => {
        mockFetchUrl.mockRejectedValue(new Error('offline'));
        let error;
        try {
            await routeRequest(puter, 'GET', '/things', { service: 'things' });
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(PuterJSError);
        expect(error.message).toBe('offline');
    });
});
