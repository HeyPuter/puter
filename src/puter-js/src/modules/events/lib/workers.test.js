import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every verb goes through the one HTTP helper, so mocking it needs no server.
const mockRequest = vi.fn();
vi.mock('./api.js', () => ({
    request: (...args) => mockRequest(...args),
}));

const { EventsWorkers } = await import('./workers.js');
const { EventHandlers } = await import('./handlers.js');

const makeModule = () => {
    const module = { puter: { APIOrigin: 'https://api.test' } };
    return new EventsWorkers(module);
};

const bodyOf = (index = 0) => mockRequest.mock.calls[index][2];
const queryOf = (index = 0) => mockRequest.mock.calls[index][3];
const routeOf = (index = 0) => mockRequest.mock.calls[index][1];

beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({});
});

describe('list', () => {
    it('reads /events/workers with no query by default', async () => {
        mockRequest.mockResolvedValue({ items: [], deployable: true });
        await makeModule().list();

        expect(routeOf()).toBe('/events/workers');
        expect(bodyOf()).toBeUndefined();
        expect(queryOf()).toEqual({});
    });

    it('forwards limit and cursor as query params', async () => {
        await makeModule().list({ limit: 10, cursor: 'abc' });
        expect(queryOf()).toEqual({ limit: 10, cursor: 'abc' });
    });

    it('normalizes the page, defaulting items and dropping an absent cursor', async () => {
        mockRequest.mockResolvedValue({ items: [{ appUid: 'app-1' }], deployable: false });
        const page = await makeModule().list();

        expect(page).toEqual({ items: [{ appUid: 'app-1' }], deployable: false });
        expect('cursor' in page).toBe(false);
    });

    it('carries a cursor through when the server returns one', async () => {
        mockRequest.mockResolvedValue({ items: [], cursor: 'next', deployable: true });
        const page = await makeModule().list();
        expect(page.cursor).toBe('next');
    });

    it('treats a missing deployable as false', async () => {
        mockRequest.mockResolvedValue({ items: [] });
        const page = await makeModule().list();
        expect(page.deployable).toBe(false);
    });
});

describe('destroy', () => {
    it('posts appUid to /events/workers/destroy', async () => {
        mockRequest.mockResolvedValue({ appUid: 'app-1', removed: 2, suspended: 1 });
        const result = await makeModule().destroy('app-1');

        expect(routeOf()).toBe('/events/workers/destroy');
        expect(bodyOf()).toEqual({ appUid: 'app-1' });
        expect(result).toEqual({ appUid: 'app-1', removed: 2, suspended: 1 });
    });

    it('rejects client-side for a non-string appUid, without calling the server', async () => {
        for ( const bad of [undefined, '', '   ', 42] ) {
            await expect(makeModule().destroy(bad)).rejects.toMatchObject({
                code: 'invalid_request',
            });
        }
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('drops the destroyed app`s cached publish bases, and keeps other apps`', async () => {
        const module = { puter: { APIOrigin: 'https://api.test' }, handlers: new EventHandlers({}) };
        module.handlers.known.set('app-1|a', 'hash-a');
        module.handlers.known.set('|b', 'hash-b');
        module.handlers.known.set('app-2|c', 'hash-c');

        await new EventsWorkers(module).destroy('app-1');

        expect([...module.handlers.known.keys()]).toEqual(['app-2|c']);
    });
});
