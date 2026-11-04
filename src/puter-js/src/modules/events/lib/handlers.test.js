import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('./api.js', () => ({
    request: (...args) => mockRequest(...args),
}));

const { EventHandlers } = await import('./handlers.js');

const SOURCE = '({ event }) => { console.log(event.path); }';

const makeHandlers = () =>
    new EventHandlers({ puter: { APIOrigin: 'https://api.test', fs: { read: vi.fn() } } });

const routeOf = (index = 0) => mockRequest.mock.calls[index][1];
const bodyOf = (index = 0) => mockRequest.mock.calls[index][2];
const queryOf = (index = 0) => mockRequest.mock.calls[index][3];

beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockImplementation(async (_puter, route, body) => ({
        name: body?.name,
        hash: `hash-${body?.scope ?? 'app'}`,
        handlers: body?.handlers?.map((h) => ({ name: h.name, hash: `hash-${body.scope ?? 'app'}` })),
    }));
});

describe('scope', () => {
    it('sends `scope: user` on publish, publishAll, list and remove', async () => {
        const handlers = makeHandlers();
        await handlers.publish('a', SOURCE, { appUid: 'app-1', scope: 'user' });
        await handlers.publishAll([{ name: 'a', handler: SOURCE }], { scope: 'user' });
        mockRequest.mockResolvedValueOnce({ handlers: [] });
        await handlers.list({ appUid: 'app-1', scope: 'user' });
        await handlers.remove('a', { appUid: 'app-1', scope: 'user' });

        expect(bodyOf(0)).toMatchObject({ appUid: 'app-1', scope: 'user', name: 'a' });
        expect(routeOf(1)).toBe('/events/handlers/publishAll');
        expect(bodyOf(1).scope).toBe('user');
        expect(queryOf(2)).toEqual({ appUid: 'app-1', scope: 'user' });
        expect(bodyOf(3)).toEqual({ name: 'a', appUid: 'app-1', scope: 'user' });
    });

    it('sends no scope by default', async () => {
        const handlers = makeHandlers();
        await handlers.publish('a', SOURCE, { appUid: 'app-1' });
        mockRequest.mockResolvedValueOnce({ handlers: [] });
        await handlers.list();
        await handlers.remove('a');

        expect(bodyOf(0)).not.toHaveProperty('scope');
        expect(queryOf(1)).toBeUndefined();
        expect(bodyOf(2)).toEqual({ name: 'a' });
    });

    it('does not mix a name published in the user scope with the app scope', async () => {
        const handlers = makeHandlers();
        await handlers.publish('a', SOURCE, { appUid: 'app-1', scope: 'user' });
        await handlers.publish('a', SOURCE, { appUid: 'app-1' });

        // The app-scope publish has no base: only the user scope was published.
        expect(bodyOf(1)).not.toHaveProperty('ifHash');

        await handlers.publish('a', SOURCE, { appUid: 'app-1', scope: 'user' });
        expect(bodyOf(2).ifHash).toBe('hash-user');
        await handlers.publish('a', SOURCE, { appUid: 'app-1' });
        expect(bodyOf(3).ifHash).toBe('hash-app');
    });

    it('removes only the cached base of the scope it removed', async () => {
        const handlers = makeHandlers();
        await handlers.publish('a', SOURCE, { appUid: 'app-1', scope: 'user' });
        await handlers.publish('a', SOURCE, { appUid: 'app-1' });
        await handlers.remove('a', { appUid: 'app-1', scope: 'user' });

        expect([...handlers.known.keys()]).toEqual(['app-1|a']);
    });

    it('records a user-scope listing under the user key', async () => {
        const handlers = makeHandlers();
        mockRequest.mockResolvedValueOnce({ handlers: [{ name: 'a', hash: 'h' }] });
        await handlers.list({ appUid: 'app-1', scope: 'user' });
        expect([...handlers.known.keys()]).toEqual(['user:app-1|a']);
    });

    it('forgets one scope of an app without touching the other', () => {
        const handlers = makeHandlers();
        handlers.known.set('app-1|a', 'h1');
        handlers.known.set('user:app-1|a', 'h2');
        handlers.forget('app-1', 'user');
        expect([...handlers.known.keys()]).toEqual(['app-1|a']);
        handlers.forget('app-1');
        expect([...handlers.known.keys()]).toEqual([]);
    });
});
