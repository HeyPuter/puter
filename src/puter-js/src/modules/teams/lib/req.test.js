import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PuterJSError } from '../../../lib/PuterJSError.js';

const mockFetchUrl = vi.fn();
vi.mock('../../../lib/networkUtils.js', async (importOriginal) => ({
    ...await importOriginal(),
    fetchUrl: (...args) => mockFetchUrl(...args),
}));

const { req, requireSegment } = await import('./req.js');

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

describe('teams req', () => {
    it('returns the parsed body on success', async () => {
        respond({ body: { uid: 't-1' } });
        await expect(req(puter, 'GET', '/teams')).resolves.toEqual({ uid: 't-1' });
        expect(mockFetchUrl).toHaveBeenCalledWith('https://api.test/teams', expect.objectContaining({
            method: 'GET',
            includePuterAuth: true,
        }));
    });

    it('serializes a body and appends only the query params that have a value', async () => {
        respond();
        await req(puter, 'POST', '/teams', {
            body: { name: 'Acme' },
            query: { limit: 5, cursor: null, includeTotal: undefined },
        });
        const [url, opts] = mockFetchUrl.mock.calls[0];
        expect(url).toBe('https://api.test/teams?limit=5');
        expect(opts.body).toBe('{"name":"Acme"}');
    });

    it('throws rather than resolving an error object, keeping the backend code', async () => {
        respond({ status: 404, body: { message: 'Team not found', code: 'team_not_found' } });
        const error = await req(puter, 'GET', '/teams/t-1').catch(e => e);
        expect(error).toBeInstanceOf(PuterJSError);
        expect(error.code).toBe('team_not_found');
        expect(error.message).toBe('Team not found');
    });

    it('falls back to a status-derived code when the backend names none', async () => {
        respond({ status: 403, body: { message: 'nope' } });
        await expect(req(puter, 'GET', '/teams/t-1')).rejects.toMatchObject({ code: 'permission_denied' });
    });

    it('throws on a non-JSON failure', async () => {
        respond({ status: 502, body: 'bad gateway', json: false });
        await expect(req(puter, 'GET', '/teams')).rejects.toMatchObject({
            code: 'unknown_error',
            message: 'bad gateway',
        });
    });
});

describe('requireSegment', () => {
    it('percent-encodes the value', () => {
        expect(requireSegment('a b/c', 'uid')).toBe('a%20b%2Fc');
    });

    it.each([['', 'empty'], ['   ', 'blank'], [undefined, 'missing'], [null, 'null']])(
        'rejects an %s segment', (value) => {
            expect(() => requireSegment(value, 'uid')).toThrow(PuterJSError);
            expect(() => requireSegment(value, 'uid')).toThrowError(/`uid` is required/);
        },
    );
});
