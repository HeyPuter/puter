import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the worker-service driver answers per method, and every call it got. */
let driverReplies;
let driverCalls;

vi.mock('../lib/utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    makeDriverMethod: ({ method }) => async (...args) => {
        driverCalls.push([method, ...args]);
        return driverReplies[method];
    },
}));

const { WorkersHandler } = await import('./Workers.js');

const ALICE = { uuid: 'u-alice', username: 'alice', is_user_token: true };

class FakeSocket extends EventTarget {
    static last = null;

    constructor (url) {
        super();
        this.url = url;
        this.sent = [];
        FakeSocket.last = this;
    }

    send (data) {
        this.sent.push(data);
    }

    close () {
        this.closed = true;
    }

    serverSends (data) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
}

/** An SDK instance with the modules a worker deployment reads and writes. */
const makeSdk = ({ sandboxApp, storedWorkers } = {}) => {
    const kv = new Map(storedWorkers === undefined ? [] : [['user-workers', storedWorkers]]);
    return {
        env: 'app',
        authToken: 'secret-token',
        whoami: ALICE,
        apps: {
            get: vi.fn(async () => {
                if ( ! sandboxApp ) throw { code: 'entity_not_found' };
                return sandboxApp;
            }),
            create: vi.fn(async name => ({ uid: 'app-new', name, owner: ALICE })),
        },
        kv: {
            stored: kv,
            get: async key => kv.get(key) ?? null,
            set: async (key, value) => void kv.set(key, value),
        },
        ui: { authenticateWithPuter: vi.fn(async () => {}) },
    };
};

beforeEach(() => {
    driverReplies = {
        create: { success: true, url: 'https://myworker.puter.work' },
        destroy: { result: true },
        getLoggingUrl: 'wss://logs.test',
    };
    driverCalls = [];
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('workers.create', () => {
    it('deploys into a sandbox app of its own and records the worker', async () => {
        const sdk = makeSdk();
        vi.stubGlobal('puter', sdk);
        const result = await new WorkersHandler(sdk).create('MyWorker', '/alice/worker.js');

        expect(result).toEqual({ success: true, url: 'https://myworker.puter.work' });
        expect(sdk.apps.create).toHaveBeenCalledWith('sandbox-MyWorker', 'https://worker-sandbox.puter.com/');
        expect(driverCalls).toEqual([['create', 'secret-token', '/alice/worker.js', 'myworker', 'app-new']]);
        expect(sdk.kv.stored.get('user-workers').myworker).toMatchObject({
            filePath: '/alice/worker.js',
            url: 'https://myworker.puter.work',
        });
    });

    it('refuses a sandbox app that belongs to someone else', async () => {
        const sdk = makeSdk({ sandboxApp: { uid: 'app-bob', owner: { uuid: 'u-bob', username: 'bob' } } });
        vi.stubGlobal('puter', sdk);
        await expect(new WorkersHandler(sdk).create('myworker', '/alice/worker.js')).rejects.toThrow(
            'Sandbox context is not owned by you! This worker\'s sandbox is currently owned by: bob',
        );
        expect(driverCalls).toEqual([]);
        expect(sdk.apps.create).not.toHaveBeenCalled();
    });

    it.each([
        [{ success: false, errors: 'Worker source is over 10MB' }, 'Worker source is over 10MB'],
        [{ success: false }, 'Driver failed to execute, do you have the necessary permissions?'],
    ])('fails with the driver\'s reason and records nothing: %o', async (reply, message) => {
        driverReplies.create = reply;
        const sdk = makeSdk();
        vi.stubGlobal('puter', sdk);
        await expect(new WorkersHandler(sdk).create('myworker', '/alice/worker.js', { sandbox: false }))
            .rejects.toThrow(message);
        expect(sdk.kv.stored.has('user-workers')).toBe(false);
    });
});

describe('workers on a signed-out web page', () => {
    const signedOut = () => Object.assign(makeSdk(), { env: 'web', authToken: null });

    it('signs the user in first', async () => {
        const sdk = signedOut();
        sdk.ui.authenticateWithPuter.mockImplementation(async () => {
            sdk.authToken = 'fresh-token';
        });
        expect(await new WorkersHandler(sdk).delete('myworker')).toBe(true);
        expect(driverCalls).toEqual([['destroy', 'fresh-token', 'myworker']]);
    });

    it('does nothing when the sign-in is declined', async () => {
        const sdk = signedOut();
        sdk.ui.authenticateWithPuter.mockRejectedValue(new Error('declined'));
        await expect(new WorkersHandler(sdk).delete('myworker')).rejects.toBe('Authentication failed.');
        expect(driverCalls).toEqual([]);
    });
});

describe('workers.delete', () => {
    it('forgets the worker it deleted, keeping the others', async () => {
        const sdk = makeSdk({ storedWorkers: { myworker: { url: 'a' }, other: { url: 'b' } } });
        expect(await new WorkersHandler(sdk).delete('MyWorker')).toBe(true);
        expect(driverCalls).toEqual([['destroy', 'secret-token', 'myworker']]);
        expect(sdk.kv.stored.get('user-workers')).toEqual({ other: { url: 'b' } });
    });

    it('succeeds when no workers were ever recorded', async () => {
        const sdk = makeSdk();
        expect(await new WorkersHandler(sdk).delete('myworker')).toBe(true);
        expect(sdk.kv.stored.get('user-workers')).toEqual({});
    });

    it.each([
        [{ result: false, errors: 'Worker not found' }, 'Worker not found'],
        [{ result: false }, 'Driver failed to execute, do you have the necessary permissions?'],
    ])('fails with the driver\'s reason and keeps the record: %o', async (reply, message) => {
        driverReplies.destroy = reply;
        const sdk = makeSdk({ storedWorkers: { myworker: { url: 'a' } } });
        await expect(new WorkersHandler(sdk).delete('myworker')).rejects.toThrow(message);
        expect(sdk.kv.stored.get('user-workers')).toEqual({ myworker: { url: 'a' } });
    });
});

describe('a logging handle as a stream', () => {
    const openHandle = async () => {
        const pending = new WorkersHandler(makeSdk()).getLoggingHandle('myworker');
        await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
        const socket = FakeSocket.last;
        socket.serverSends({ type: 'ready' });
        return { socket, handle: await pending };
    };

    it('feeds a ReadableStream with the worker\'s logs until the socket closes', async () => {
        const { socket, handle } = await openHandle();
        const reader = new ReadableStream(handle).getReader();
        socket.serverSends({ level: 'info', message: 'started' });
        socket.serverSends({ level: 'error', message: 'failed' });

        expect(await reader.read()).toEqual({ done: false, value: { level: 'info', message: 'started' } });
        expect(await reader.read()).toEqual({ done: false, value: { level: 'error', message: 'failed' } });

        socket.dispatchEvent(new Event('close'));
        expect(await reader.read()).toEqual({ done: true, value: undefined });
    });

    it('closes the socket when the stream is cancelled', async () => {
        const { socket, handle } = await openHandle();
        const stream = new ReadableStream(handle);
        await stream.cancel();
        expect(socket.closed).toBe(true);
        // The socket's own close after that has nothing left to end.
        socket.dispatchEvent(new Event('close'));
    });
});
