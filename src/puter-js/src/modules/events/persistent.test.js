import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every persistent verb goes through the one HTTP helper, so mocking it needs
// no server and still exercises the real request bodies.
const mockRequest = vi.fn();
vi.mock('./lib/api.js', () => ({
    request: (...args) => mockRequest(...args),
}));

const { EventHandlers } = await import('./lib/handlers.js');
const { list } = await import('./list.js');
const { onPersistent } = await import('./onPersistent.js');
const { unsubscribe } = await import('./unsubscribe.js');

const SUBJECT = 'fs:~/Documents';
const HANDLER = ({ event, ctx }) => fetch(ctx.url, { body: event.path });
/** SHA-256 of the serialized `HANDLER`, computed the same way the SDK does. */
let handlerHash;

const makeModule = (fsRead) => {
    const module = {
        puter: {
            APIOrigin: 'https://api.test',
            fs: { read: fsRead ?? vi.fn() },
        },
        channel: {
            registered: [],
            deregistered: [],
            registerDurable (subId, handler, ctx) {
                this.registered.push({ subId, handler, ctx });
            },
            deregisterDurable (subId) {
                this.deregistered.push(subId);
            },
        },
        onPersistent,
        unsubscribe,
        list,
    };
    module.handlers = new EventHandlers(module);
    return module;
};

const bodyOf = (index = 0) => mockRequest.mock.calls[index][2];
const routeOf = (index = 0) => mockRequest.mock.calls[index][1];

const rejects = async (run) => {
    try {
        await run();
    } catch (error) {
        return error;
    }
    throw new Error('expected a rejection');
};

beforeEach(async () => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({});
    if ( ! handlerHash ) {
        const { hashSource } = await import('./lib/handlerSource.js');
        handlerHash = await hashSource(Function.prototype.toString.call(HANDLER));
    }
});

describe('onPersistent', () => {
    it('sends the subject and the server`s answer comes straight back', async () => {
        const view = { subId: 'app-1#a', subject: SUBJECT };
        mockRequest.mockResolvedValue(view);

        const sub = await makeModule().onPersistent({ subject: SUBJECT });

        expect(routeOf()).toBe('/events/subscribe');
        expect(bodyOf()).toEqual({ subject: SUBJECT });
        expect(sub).toBe(view);
    });

    it('carries delivery, targets, handlerName and expiry when given', async () => {
        await makeModule().onPersistent({
            subject: SUBJECT,
            delivery: 'single',
            targets: ['worker'],
            handlerName: 'ingestUpload',
            expiresAt: 4102444800,
        });

        expect(bodyOf()).toEqual({
            subject: SUBJECT,
            delivery: 'single',
            targets: ['worker'],
            handlerName: 'ingestUpload',
            expiresAt: 4102444800,
        });
    });

    it('sends an inline handler as a hash, never as source', async () => {
        await makeModule().onPersistent({
            subject: SUBJECT,
            handlerName: 'ingestUpload',
            handler: HANDLER,
        });

        expect(bodyOf().handlerHash).toBe(handlerHash);
        expect(bodyOf().source).toBeUndefined();
        expect(JSON.stringify(bodyOf())).not.toContain('fetch(');
    });

    it('refuses an inline handler with no name to publish it under', async () => {
        const error = await rejects(() =>
            makeModule().onPersistent({ subject: SUBJECT, handler: HANDLER }),
        );

        expect(error.code).toBe('events_handler_name_required');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('rejects an inline handler that closes over something', async () => {
        const error = await rejects(() =>
            makeModule().onPersistent({
                subject: SUBJECT,
                handlerName: 'ingestUpload',
                handler: '({ event }) => fetch(endpoint, { body: event.path })',
            }),
        );

        expect(error.code).toBe('events_handler_free_variable');
        expect(error.message).toContain('`endpoint`');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('reads a `{ file }` handler through the caller`s own filesystem', async () => {
        const read = vi.fn(async () => ({
            text: async () => '({ event, ctx }) => console.log(event.uid, ctx.url)',
        }));

        await makeModule(read).onPersistent({
            subject: SUBJECT,
            handlerName: 'ingestUpload',
            handler: { file: '~/AppData/handler.js' },
        });

        expect(read).toHaveBeenCalledWith('~/AppData/handler.js');
        expect(bodyOf().handlerHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('refuses a `single` delivery with no handlerName to match it against', async () => {
        const error = await rejects(() =>
            makeModule().onPersistent({ subject: SUBJECT, delivery: 'single' }),
        );

        expect(error.code).toBe('events_handler_required');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('refuses a subject that is not a non-empty string', async () => {
        for ( const subject of [undefined, null, '', '  ', 42] ) {
            const error = await rejects(() =>
                makeModule().onPersistent({ subject }),
            );
            expect(error.code).toBe('invalid_subject');
        }
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('refuses a handler that is none of the three accepted forms', async () => {
        const error = await rejects(() =>
            makeModule().onPersistent({
                subject: SUBJECT,
                handlerName: 'x',
                handler: 42,
            }),
        );
        expect(error.code).toBe('events_handler_invalid');
    });

    describe('context', () => {
        it('sends what was passed, evaluated now', async () => {
            await makeModule().onPersistent({
                subject: SUBJECT,
                context: { url: 'https://ingest.example', retries: 2 },
            });

            expect(bodyOf().context).toEqual({
                url: 'https://ingest.example',
                retries: 2,
            });
        });

        it('refuses one over the cap before the network', async () => {
            const error = await rejects(() =>
                makeModule().onPersistent({
                    subject: SUBJECT,
                    context: { blob: 'x'.repeat(5000) },
                }),
            );

            expect(error.code).toBe('events_context_too_large');
            expect(mockRequest).not.toHaveBeenCalled();
        });

        it('refuses one that cannot be serialized', async () => {
            const cyclic = {};
            cyclic.self = cyclic;

            const error = await rejects(() =>
                makeModule().onPersistent({ subject: SUBJECT, context: cyclic }),
            );
            expect(error.code).toBe('events_context_invalid');
        });
    });

    describe('running the handler here as well', () => {
        it('routes the subscription`s deliveries to the function it was given', async () => {
            mockRequest.mockResolvedValue({ subId: 'app-1#a', subject: SUBJECT });
            const module = makeModule();

            await module.onPersistent({
                subject: SUBJECT,
                handlerName: 'ingestUpload',
                handler: HANDLER,
                context: { url: 'https://ingest.example' },
            });

            expect(module.channel.registered).toMatchObject([
                { subId: 'app-1#a', handler: HANDLER, ctx: { url: 'https://ingest.example' } },
            ]);
        });

        it('routes nothing when the handler is source this client cannot run', async () => {
            mockRequest.mockResolvedValue({ subId: 'app-1#a', subject: SUBJECT });
            const module = makeModule();

            await module.onPersistent({
                subject: SUBJECT,
                handlerName: 'ingestUpload',
                handler: '({ event }) => console.log(event.path)',
            });

            expect(module.channel.registered).toEqual([]);
        });

        it('off() stops routing and ends the subscription', async () => {
            mockRequest.mockResolvedValue({ subId: 'app-1#a', subject: SUBJECT });
            const module = makeModule();
            const sub = await module.onPersistent({
                subject: SUBJECT,
                handlerName: 'ingestUpload',
                handler: HANDLER,
            });

            await sub.off();

            expect(module.channel.deregistered).toEqual(['app-1#a']);
            expect(routeOf(1)).toBe('/events/unsubscribe');
            expect(bodyOf(1)).toEqual({ subId: 'app-1#a' });
        });
    });
});

describe('unsubscribe', () => {
    it('names the subscription to end', async () => {
        await makeModule().unsubscribe('app-1#a');

        expect(routeOf()).toBe('/events/unsubscribe');
        expect(bodyOf()).toEqual({ subId: 'app-1#a' });
    });

    it('answers an empty id the way the server answers one it cannot find', async () => {
        const error = await rejects(() => makeModule().unsubscribe(''));
        expect(error.code).toBe('subscription_does_not_exist');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('stops routing deliveries here as well as ending the subscription', async () => {
        const module = makeModule();

        await module.unsubscribe('app-1#a');

        expect(module.channel.deregistered).toEqual(['app-1#a']);
    });
});

describe('list', () => {
    it('follows the cursor and resolves to one array', async () => {
        mockRequest
            .mockResolvedValueOnce({ items: [{ subId: 'a' }], cursor: 'next' })
            .mockResolvedValueOnce({ items: [{ subId: 'b' }] });

        const rows = await makeModule().list();

        expect(rows.map(row => row.subId)).toEqual(['a', 'b']);
        expect(mockRequest.mock.calls[1][3]).toMatchObject({ cursor: 'next' });
    });

    it('returns one page envelope when the caller asks for pagination', async () => {
        mockRequest.mockResolvedValue({ items: [], cursor: 'c', total: 7 });

        const page = await makeModule().list({ cursor: null, includeTotal: true });

        expect(page).toEqual({ items: [], cursor: 'c', total: 7 });
        expect(mockRequest.mock.calls[0][3]).toMatchObject({ includeTotal: true });
    });

    it('streams page envelopes when asked to', async () => {
        mockRequest
            .mockResolvedValueOnce({ items: [{ subId: 'a' }], cursor: 'next' })
            .mockResolvedValueOnce({ items: [{ subId: 'b' }] });

        const pages = [];
        for await ( const page of makeModule().list({ stream: true }) ) pages.push(page);

        expect(pages.map(page => page.items[0].subId)).toEqual(['a', 'b']);
    });
});

describe('handlers', () => {
    it('publishes the serialized source under a name', async () => {
        mockRequest.mockResolvedValue({
            name: 'ingestUpload',
            hash: handlerHash,
            outcome: 'created',
        });

        const published = await makeModule().handlers.publish('ingestUpload', HANDLER);

        expect(routeOf()).toBe('/events/handlers/publish');
        expect(bodyOf()).toEqual({
            name: 'ingestUpload',
            source: Function.prototype.toString.call(HANDLER),
        });
        expect(published.outcome).toBe('created');
    });

    it('names the base it is updating once it knows one', async () => {
        const module = makeModule();
        mockRequest.mockResolvedValue({ name: 'ingestUpload', hash: 'hash-1' });
        await module.handlers.publish('ingestUpload', HANDLER);

        mockRequest.mockResolvedValue({ name: 'ingestUpload', hash: 'hash-2' });
        await module.handlers.publish('ingestUpload', '({ ctx }) => ctx.url');

        expect(bodyOf(1).ifHash).toBe('hash-1');
    });

    it('takes the base from a listing too', async () => {
        const module = makeModule();
        mockRequest.mockResolvedValue({
            handlers: [{ name: 'ingestUpload', hash: 'hash-9', subscriptions: 0 }],
        });
        await module.handlers.list();

        mockRequest.mockResolvedValue({ name: 'ingestUpload', hash: 'hash-10' });
        await module.handlers.publish('ingestUpload', HANDLER);

        expect(bodyOf(1).ifHash).toBe('hash-9');
    });

    it('names no base when the caller means to take the name', async () => {
        const module = makeModule();
        mockRequest.mockResolvedValue({ name: 'ingestUpload', hash: 'hash-1' });
        await module.handlers.publish('ingestUpload', HANDLER);

        await module.handlers.publish('ingestUpload', '({ ctx }) => ctx.url', {
            replace: true,
        });

        expect(bodyOf(1)).toMatchObject({ replace: true });
        expect(bodyOf(1).ifHash).toBeUndefined();
    });

    it('publishes a whole set in one call', async () => {
        mockRequest.mockResolvedValue({
            handlers: [
                { name: 'a', hash: 'h1' },
                { name: 'b', hash: 'h2' },
            ],
        });

        const published = await makeModule().handlers.publishAll([
            { name: 'a', handler: HANDLER },
            { name: 'b', handler: '({ ctx }) => ctx.url' },
        ]);

        expect(routeOf()).toBe('/events/handlers/publishAll');
        expect(bodyOf().handlers.map(entry => entry.name)).toEqual(['a', 'b']);
        expect(published).toHaveLength(2);
    });

    it('rejects a set item that closes over something, before sending anything', async () => {
        const error = await rejects(() =>
            makeModule().handlers.publishAll([
                { name: 'a', handler: HANDLER },
                { name: 'b', handler: '({ event }) => publish(event)' },
            ]),
        );

        expect(error.code).toBe('events_handler_free_variable');
        expect(error.message).toContain('`publish`');
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('names an app when the caller is an account session', async () => {
        mockRequest.mockResolvedValue({ name: 'a', hash: 'h' });
        await makeModule().handlers.publish('a', HANDLER, { appUid: 'app-7' });

        expect(bodyOf()).toMatchObject({ appUid: 'app-7' });
    });

    it('does not carry one app`s base into another`s', async () => {
        const module = makeModule();
        mockRequest.mockResolvedValue({ name: 'a', hash: 'hash-1' });
        await module.handlers.publish('a', HANDLER, { appUid: 'app-1' });

        // The same name in another app is different code, and this publish is
        // not an update to anything.
        await module.handlers.publish('a', HANDLER, { appUid: 'app-2' });
        expect(bodyOf(1).ifHash).toBeUndefined();
    });

    it('lists names and hashes, and forgets a name it removes', async () => {
        const module = makeModule();
        mockRequest.mockResolvedValue({
            handlers: [{ name: 'a', hash: 'h', updatedAt: 1, subscriptions: 3 }],
        });

        const listed = await module.handlers.list();
        expect(routeOf()).toBe('/events/handlers/list');
        expect(listed).toEqual([
            { name: 'a', hash: 'h', updatedAt: 1, subscriptions: 3 },
        ]);

        mockRequest.mockResolvedValue({ name: 'a', removed: true, suspended: 3 });
        await module.handlers.remove('a');
        expect(routeOf(1)).toBe('/events/handlers/remove');
        expect(module.handlers.known.size).toBe(0);
    });

    it('refuses a name that is not a non-empty string', async () => {
        for ( const name of [undefined, '', '   ', 7] ) {
            const error = await rejects(() =>
                makeModule().handlers.publish(name, HANDLER),
            );
            expect(error.code).toBe('events_handler_name_invalid');
        }
    });

    it('works when destructured off the module', async () => {
        const { publish } = makeModule().handlers;
        mockRequest.mockResolvedValue({ name: 'a', hash: 'h' });

        await publish('a', HANDLER);
        expect(routeOf()).toBe('/events/handlers/publish');
    });
});
