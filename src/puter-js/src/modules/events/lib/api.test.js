import { beforeEach, describe, expect, it, vi } from 'vitest';

// `request()` is the one HTTP path every route above it shares, so this is
// where the sign-in prompt has to live. A `socket.io-client` that throws
// catches any of these calls straying onto the socket path instead.
const mockFetchUrl = vi.fn();
vi.mock('../../../lib/networkUtils.js', () => ({
    fetchUrl: (...args) => mockFetchUrl(...args),
}));
vi.mock('socket.io-client', () => ({
    io: () => {
        throw new Error('an HTTP-only call reached the socket');
    },
}));

const { EventsModule } = await import('../index.js');

const jsonResponse = (body) => ({
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
});

const makeEvents = (over = {}) => {
    const puter = {
        env: 'web',
        authToken: null,
        APIOrigin: 'https://api.test',
        onAuthStateChanged: () => {},
        fs: { read: vi.fn() },
        ui: {
            authenticateWithPuter: vi.fn(async () => {
                puter.authToken = 'token-2';
            }),
        },
        ...over,
    };
    return new EventsModule(puter);
};

/** One call per HTTP-backed method, run against a built `EventsModule`. */
const CALLS = [
    ['fetch({ subject })', events => events.fetch({ subject: 'notif:app-user' })],
    ['list()', events => events.list()],
    ['list({ stream: true })', async (events) => {
        for await ( const _page of events.list({ stream: true }) ) break;
    }],
    ['unsubscribe(subId)', events => events.unsubscribe('app-1#a')],
    ['onPersistent({ subject })', events => events.onPersistent({ subject: 'fs:~/Documents' })],
    ['handlers.publish(name, handler)', events => events.handlers.publish('a', '({ event }) => event')],
    ['handlers.publishAll([...])', events => events.handlers.publishAll([
        { name: 'a', handler: '({ event }) => event' },
    ])],
    ['handlers.list()', events => events.handlers.list()],
    ['handlers.remove(name)', events => events.handlers.remove('a')],
    ['workers.list()', events => events.workers.list()],
    ['workers.destroy(appUid)', events => events.workers.destroy('app-1')],
];

const rejects = async (run) => {
    try {
        await run();
    } catch (error) {
        return error;
    }
    throw new Error('expected a rejection');
};

beforeEach(() => {
    mockFetchUrl.mockReset();
    mockFetchUrl.mockResolvedValue(jsonResponse({ items: [] }));
});

describe('signing in before an HTTP call', () => {
    it.each(CALLS)('signs a signed-out website visitor in before %s', async (_label, run) => {
        const events = makeEvents();
        await run(events);

        expect(events.puter.ui.authenticateWithPuter).toHaveBeenCalledTimes(1);
        expect(
            events.puter.ui.authenticateWithPuter.mock.invocationCallOrder[0],
        ).toBeLessThan(mockFetchUrl.mock.invocationCallOrder[0]);
    });

    it.each(CALLS)('rejects %s with auth_canceled and sends nothing when the sign-in is closed', async (_label, run) => {
        const events = makeEvents({
            ui: {
                authenticateWithPuter: vi.fn(async () => {
                    throw new Error('user closed the dialog');
                }),
            },
        });

        const error = await rejects(() => run(events));
        expect(error.code).toBe('auth_canceled');
        expect(mockFetchUrl).not.toHaveBeenCalled();
    });

    it('sends without asking when signed in or inside an app', async () => {
        const signedIn = makeEvents({ authToken: 'token-1' });
        await signedIn.list();
        expect(signedIn.puter.ui.authenticateWithPuter).not.toHaveBeenCalled();

        const inApp = makeEvents({ env: 'app' });
        await inApp.list();
        expect(inApp.puter.ui.authenticateWithPuter).not.toHaveBeenCalled();
    });

    /** Each tuple's input fails that method's own client-side check. */
    const VALIDATION_FIRST_CALLS = [
        ['unsubscribe("")', events => events.unsubscribe(''), 'subscription_does_not_exist'],
        ['fetch({})', events => events.fetch({}), 'invalid_subject'],
        ['handlers.remove("")', events => events.handlers.remove(''), 'events_handler_name_invalid'],
        ['workers.destroy("")', events => events.workers.destroy(''), 'invalid_request'],
    ];

    it.each(VALIDATION_FIRST_CALLS)('rejects %s with its own code, never asking to sign in', async (_label, run, code) => {
        const events = makeEvents();

        const error = await rejects(() => run(events));
        expect(error.code).toBe(code);
        expect(events.puter.ui.authenticateWithPuter).not.toHaveBeenCalled();
        expect(mockFetchUrl).not.toHaveBeenCalled();
    });
});
