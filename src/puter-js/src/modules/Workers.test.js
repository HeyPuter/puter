import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LOGGING_URL = 'wss://logs.test';

vi.mock('../lib/utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    makeDriverMethod: () => async () => LOGGING_URL,
}));

const { WorkersHandler } = await import('./Workers.js');

/** Stands in for the browser WebSocket; the test drives the server side. */
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

    serverOpens () {
        this.onopen?.();
    }

    serverSends (data) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
    }

    serverCloses () {
        this.onclose?.(new Event('close'));
    }
}

const origWebSocket = globalThis.WebSocket;

beforeEach(() => {
    FakeSocket.last = null;
    globalThis.WebSocket = FakeSocket;
});

afterEach(() => {
    globalThis.WebSocket = origWebSocket;
});

const makeWorkers = () => new WorkersHandler({ authToken: 'secret-token' });

describe('getLoggingHandle', () => {
    it('sends the token in the first message, never in the URL', async () => {
        const pending = makeWorkers().getLoggingHandle('myworker');
        await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
        const socket = FakeSocket.last;

        expect(socket.url).toBe(`${LOGGING_URL}/myworker`);
        expect(socket.url).not.toContain('secret-token');

        socket.serverOpens();
        expect(socket.sent.map((m) => JSON.parse(m))).toEqual([
            { type: 'auth', token: 'secret-token' },
        ]);

        socket.serverSends({ type: 'ready' });
        const handle = await pending;
        expect(handle).toBeInstanceOf(EventTarget);
    });

    it('delivers logs after the handshake without surfacing the handshake itself', async () => {
        const pending = makeWorkers().getLoggingHandle('myworker');
        await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
        const socket = FakeSocket.last;
        socket.serverOpens();
        socket.serverSends({ type: 'ready' });
        const handle = await pending;

        const logs = [];
        handle.addEventListener('log', (event) => logs.push(event.data));
        const log = { workerName: 'myworker', logs: ['hi'], outcome: 'ok' };
        socket.serverSends(log);

        expect(logs).toEqual([log]);
    });

    it('rejects when the server closes before accepting the token', async () => {
        const pending = makeWorkers().getLoggingHandle('myworker');
        await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
        const socket = FakeSocket.last;
        socket.serverOpens();
        socket.serverCloses();

        await expect(pending).rejects.toBe('Failed to open logging connection');
    });

    it('closes the socket through the handle', async () => {
        const pending = makeWorkers().getLoggingHandle('myworker');
        await vi.waitFor(() => expect(FakeSocket.last).not.toBeNull());
        const socket = FakeSocket.last;
        socket.serverOpens();
        socket.serverSends({ type: 'ready' });
        const handle = await pending;

        handle.close();
        expect(socket.closed).toBe(true);
    });
});
