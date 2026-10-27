import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PSocket's only collaborator is the epoxy client, so that module is stubbed:
// no wasm runtime, no relay, no websocket. Stubbing it also breaks the
// PSocket <-> index.js import cycle for these tests.
const mockGetEpoxyClient = vi.fn();
const mockDiscardOnRelayFailure = vi.fn();
vi.mock('./index.js', () => ({
    getEpoxyClient: (...args) => mockGetEpoxyClient(...args),
    discardOnRelayFailure: (...args) => mockDiscardOnRelayFailure(...args),
}));

const { PSocket, PTLSSocket } = await import('./PSocket.js');

// Socket events land a few microtasks after the call that triggers them, so
// assertions retry rather than guess a tick count. The default 50ms poll would
// dominate the runtime of a suite this size; these waits resolve almost
// immediately.
const until = assertion => vi.waitFor(assertion, { interval: 1, timeout: 1000 });

// A duplex pair shaped like what `EpoxyClient.connect` returns: a
// ReadableStream of inbound bytes plus a WritableStream of outbound ones.
// These are the platform's real stream implementations, so reader/writer
// locking, cancel, and abort behave as they do in the browser.
function makeStream ({ failWrite } = {}) {
    let readController;
    const read = new ReadableStream({
        start (controller) {
            readController = controller;
        },
    });

    const written = [];
    const write = new WritableStream({
        write (chunk) {
            if ( failWrite ) {
                throw failWrite;
            }
            written.push(chunk);
        },
    });

    return {
        read,
        write,
        written,
        push: bytes => readController.enqueue(bytes),
        endRead: () => readController.close(),
        failRead: error => readController.error(error),
    };
}

// The epoxy client's streams come from wasm rather than being the platform's
// ReadableStream, so a cancel that rejects the pending read -- instead of
// resolving it `done` the way the spec requires -- is possible. This models
// that, which a real ReadableStream cannot be made to do.
function makeRejectingStream ({ failWrite } = {}) {
    let rejectRead;
    const reader = {
        read: () => new Promise((resolve, reject) => {
            rejectRead = reject;
        }),
        cancel: async () => {
            rejectRead?.(new Error('stream torn down'));
        },
        releaseLock: () => {},
    };

    const written = [];
    const writer = {
        write: async chunk => {
            if ( failWrite ) {
                throw failWrite;
            }
            written.push(chunk);
        },
        close: async () => {},
        releaseLock: () => {},
    };

    return {
        read: { getReader: () => reader },
        write: { getWriter: () => writer },
        written,
    };
}

function makeClient (stream) {
    return {
        connect: vi.fn(async () => stream),
        connectTls: vi.fn(async () => stream),
    };
}

// A promise whose settlement the test controls, for pausing mid-connect.
function deferred () {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Attaches spies for every event a caller can observe. `error` is never
// tls-prefixed, unlike open/data/close.
function listen (socket) {
    const spies = {
        open: vi.fn(),
        data: vi.fn(),
        close: vi.fn(),
        error: vi.fn(),
    };
    for ( const event of Object.keys(spies) ) {
        socket.on(event, spies[event]);
    }
    return spies;
}

// Opens a socket and waits until it is ready to write.
async function connected (stream = makeStream()) {
    const client = makeClient(stream);
    mockGetEpoxyClient.mockResolvedValue(client);

    const socket = new PSocket('example.com', 80);
    const events = listen(socket);
    await until(() => expect(events.open).toHaveBeenCalledTimes(1));

    return { socket, events, client, stream };
}

beforeEach(() => {
    mockGetEpoxyClient.mockReset();
    mockDiscardOnRelayFailure.mockReset().mockReturnValue(false);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PSocket connect', () => {
    it('opens a stream through the epoxy client', async () => {
        const { client, events } = await connected();

        expect(client.connect).toHaveBeenCalledWith('example.com', 80);
        expect(client.connectTls).not.toHaveBeenCalled();
        expect(mockGetEpoxyClient).toHaveBeenCalledTimes(1);
        expect(events.error).not.toHaveBeenCalled();
    });

    it('coerces a string port to a number', async () => {
        const client = makeClient(makeStream());
        mockGetEpoxyClient.mockResolvedValue(client);

        const socket = new PSocket('example.com', '443');
        const events = listen(socket);
        await until(() => expect(events.open).toHaveBeenCalled());

        expect(client.connect).toHaveBeenCalledWith('example.com', 443);
    });

    it('retries once when the client could not be built', async () => {
        const client = makeClient(makeStream());
        mockGetEpoxyClient
            .mockRejectedValueOnce(new Error('wasm unavailable'))
            .mockResolvedValueOnce(client);

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);
        await until(() => expect(events.open).toHaveBeenCalledTimes(1));

        expect(mockGetEpoxyClient).toHaveBeenCalledTimes(2);
        expect(events.error).not.toHaveBeenCalled();
    });

    it('retries on a fresh client when the relay itself failed', async () => {
        const relayError = new Error('Wisp: Multiplexor task ended');
        const dead = makeClient(makeStream());
        dead.connect.mockRejectedValue(relayError);
        const fresh = makeClient(makeStream());
        mockGetEpoxyClient
            .mockResolvedValueOnce(dead)
            .mockResolvedValueOnce(fresh);
        mockDiscardOnRelayFailure.mockReturnValueOnce(true);

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);
        await until(() => expect(events.open).toHaveBeenCalledTimes(1));

        expect(mockDiscardOnRelayFailure).toHaveBeenCalledWith(
            dead,
            relayError,
        );
        expect(fresh.connect).toHaveBeenCalledWith('example.com', 80);
        expect(events.error).not.toHaveBeenCalled();
    });

    // One unreachable host must not cost a second relay client.
    it('does not retry a stream failure on a working relay', async () => {
        const refused = new Error('connection refused');
        const client = makeClient(makeStream());
        client.connect.mockRejectedValue(refused);
        mockGetEpoxyClient.mockResolvedValue(client);

        const socket = new PSocket('down.example', 80);
        const events = listen(socket);
        await until(() => expect(events.close).toHaveBeenCalledWith(true));

        expect(mockGetEpoxyClient).toHaveBeenCalledTimes(1);
        expect(mockDiscardOnRelayFailure).toHaveBeenCalledWith(client, refused);
        expect(events.error.mock.calls[0][0]).toBe(refused);
    });

    it('emits an error and closes when both attempts fail', async () => {
        mockGetEpoxyClient.mockRejectedValue(new Error('relay down'));

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);
        await until(() => expect(events.close).toHaveBeenCalled());

        expect(events.open).not.toHaveBeenCalled();
        expect(events.error).toHaveBeenCalledTimes(1);
        expect(events.close).toHaveBeenCalledWith(true);
        expect(mockGetEpoxyClient).toHaveBeenCalledTimes(2);
    });

    // The types declare the handler as `(error: Error) => void` and document the
    // reason as `error.message`, so a rejection has to arrive wrapped.
    it('reports failures as Error instances', async () => {
        mockGetEpoxyClient.mockRejectedValue(new Error('relay down'));

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);
        await until(() => expect(events.error).toHaveBeenCalled());

        const [reason] = events.error.mock.calls[0];
        expect(reason).toBeInstanceOf(Error);
        expect(reason.message).toBe('relay down');
    });

    it('wraps a non-Error rejection reason', async () => {
        mockGetEpoxyClient.mockRejectedValue('just a string');

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);
        await until(() => expect(events.error).toHaveBeenCalled());

        const [reason] = events.error.mock.calls[0];
        expect(reason).toBeInstanceOf(Error);
        expect(reason.message).toBe('just a string');
    });
});

describe('PSocket inbound data', () => {
    it('emits each chunk the remote sends', async () => {
        const { events, stream } = await connected();

        stream.push(new Uint8Array([1, 2, 3]));
        await until(() => expect(events.data).toHaveBeenCalledTimes(1));

        expect(Array.from(events.data.mock.calls[0][0])).toEqual([1, 2, 3]);
    });

    it('emits chunks in order', async () => {
        const { events, stream } = await connected();

        stream.push(new Uint8Array([1]));
        stream.push(new Uint8Array([2]));
        await until(() => expect(events.data).toHaveBeenCalledTimes(2));

        expect(events.data.mock.calls.map(([chunk]) => Array.from(chunk)))
            .toEqual([[1], [2]]);
    });

    it('closes without an error flag when the remote ends the stream', async () => {
        const { events, stream } = await connected();

        stream.endRead();
        await until(() => expect(events.close).toHaveBeenCalled());

        expect(events.close).toHaveBeenCalledWith(false);
        expect(events.error).not.toHaveBeenCalled();
    });

    it('emits an error and reports it to the client cache when the read fails', async () => {
        const { events, stream, client } = await connected();

        const reset = new Error('connection reset');
        stream.failRead(reset);
        await until(() => expect(events.error).toHaveBeenCalled());

        expect(events.error.mock.calls[0][0].message).toBe('connection reset');
        expect(mockDiscardOnRelayFailure).toHaveBeenCalledWith(client, reset);
        await until(() => expect(events.close).toHaveBeenCalledWith(true));
    });
});

describe('PSocket write', () => {
    it('writes a typed array', async () => {
        const { socket, stream } = await connected();

        socket.write(new Uint8Array([1, 2, 3]));
        await until(() => expect(stream.written).toHaveLength(1));

        expect(Array.from(stream.written[0])).toEqual([1, 2, 3]);
    });

    it('writes an ArrayBuffer', async () => {
        const { socket, stream } = await connected();

        socket.write(new Uint8Array([4, 5, 6]).buffer);
        await until(() => expect(stream.written).toHaveLength(1));

        expect(Array.from(stream.written[0])).toEqual([4, 5, 6]);
    });

    // A view can cover part of a larger buffer; only its own bytes may be sent.
    it('writes only the bytes a partial view covers', async () => {
        const { socket, stream } = await connected();
        const backing = new Uint8Array([9, 1, 2, 3, 9]).buffer;

        socket.write(new Uint8Array(backing, 1, 3));
        await until(() => expect(stream.written).toHaveLength(1));

        expect(Array.from(stream.written[0])).toEqual([1, 2, 3]);
    });

    it('encodes a string as utf-8', async () => {
        const { socket, stream } = await connected();

        socket.write('hé');
        await until(() => expect(stream.written).toHaveLength(1));

        expect(Array.from(stream.written[0])).toEqual([104, 195, 169]);
    });

    it('throws on an unsupported data type', async () => {
        const { socket } = await connected();

        expect(() => socket.write(42)).toThrow(/Invalid data type/);
    });

    it('invokes the callback once the write lands', async () => {
        const { socket } = await connected();
        const callback = vi.fn();

        socket.write('hi', callback);
        await until(() => expect(callback).toHaveBeenCalledTimes(1));
    });

    it('sends queued writes before writes from the open handler', async () => {
        const stream = makeStream();
        const gate = deferred();
        mockGetEpoxyClient.mockReturnValue(gate.promise);
        const socket = new PSocket('example.com', 80);
        socket.write('first');
        socket.on('open', () => socket.write('second'));
        gate.resolve(makeClient(stream));
        await until(() => expect(stream.written).toHaveLength(2));
        expect(
            stream.written.map((chunk) => new TextDecoder().decode(chunk)),
        ).toEqual(['first', 'second']);
        socket.close();
    });

    it('queues a write made during the flush behind the queued writes', async () => {
        const written = [];
        const sinkGate = deferred();
        let sinkCalls = 0;
        const stream = {
            read: new ReadableStream(),
            write: new WritableStream({
                async write(chunk) {
                    written.push(new TextDecoder().decode(chunk));
                    if (sinkCalls++ === 0) await sinkGate.promise;
                },
            }),
        };
        const gate = deferred();
        mockGetEpoxyClient.mockReturnValue(gate.promise);
        const socket = new PSocket('example.com', 80);
        socket.write('first');
        socket.write('second');
        gate.resolve(makeClient(stream));

        // The flush is parked on 'first'; this write comes from elsewhere.
        await until(() => expect(written).toEqual(['first']));
        socket.write('third');
        sinkGate.resolve();

        await until(() => expect(written).toHaveLength(3));
        expect(written).toEqual(['first', 'second', 'third']);
        socket.close();
    });

    it('queues writes issued before the socket opens and flushes them in order', async () => {
        const stream = makeStream();
        const gate = deferred();
        mockGetEpoxyClient.mockReturnValue(gate.promise);

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);

        // Still connecting, so neither write can reach the stream yet.
        socket.write('first');
        socket.write('second');
        expect(stream.written).toHaveLength(0);

        gate.resolve(makeClient(stream));
        await until(() => expect(events.open).toHaveBeenCalled());
        await until(() => expect(stream.written).toHaveLength(2));

        const decoder = new TextDecoder();
        expect(stream.written.map(chunk => decoder.decode(chunk)))
            .toEqual(['first', 'second']);
    });

    it('throws when writing to a closed socket', async () => {
        const { socket, events } = await connected();

        socket.close();
        await until(() => expect(events.close).toHaveBeenCalled());

        expect(() => socket.write('late')).toThrow(/already closed/);
    });

    it('emits an error and reports it to the client cache when a write fails', async () => {
        const failWrite = new Error('write failed');
        const stream = makeStream({ failWrite });
        const { socket, events, client } = await connected(stream);

        socket.write('doomed');
        await until(() => expect(events.error).toHaveBeenCalled());

        expect(events.error.mock.calls[0][0].message).toBe('write failed');
        expect(mockDiscardOnRelayFailure).toHaveBeenCalledWith(
            client,
            failWrite,
        );
    });

    // Regression guard: a failed write hands the close event to #closeStreams,
    // whose reader.cancel() resolves #readLoop's pending read with {done: true}.
    // The loop must not treat that as a clean shutdown and emit close(false)
    // before #closeStreams reports the error.
    it('closes with the error flag set when a write fails', async () => {
        const stream = makeStream({ failWrite: new Error('write failed') });
        const { socket, events } = await connected(stream);

        socket.write('doomed');
        await until(() => expect(events.close).toHaveBeenCalled());

        expect(events.close).toHaveBeenCalledWith(true);
    });

    // Same guarantee when the teardown's cancel rejects the in-flight read
    // rather than ending it cleanly: the flag must still come from the path
    // that knows an error happened.
    it('keeps the error flag when cancelling rejects the pending read', async () => {
        const stream = makeRejectingStream({ failWrite: new Error('write failed') });
        mockGetEpoxyClient.mockResolvedValue(makeClient(stream));

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);
        await until(() => expect(events.open).toHaveBeenCalled());

        socket.write('doomed');
        await until(() => expect(events.close).toHaveBeenCalled());

        expect(events.error.mock.calls[0][0].message).toBe('write failed');
        expect(events.close).toHaveBeenCalledTimes(1);
        expect(events.close).toHaveBeenCalledWith(true);
    });
});

describe('PSocket close', () => {
    it('emits close exactly once, even when called repeatedly', async () => {
        const { socket, events } = await connected();

        socket.close();
        socket.close();
        await until(() => expect(events.close).toHaveBeenCalled());

        expect(events.close).toHaveBeenCalledTimes(1);
        expect(events.close).toHaveBeenCalledWith(false);
        expect(events.error).not.toHaveBeenCalled();
    });

    // Closing while the relay handshake is still in flight must not leave the
    // freshly opened stream dangling, and must not surface as an open socket.
    it('tears down a stream that arrives after close, without emitting open', async () => {
        const stream = makeStream();
        const cancelSpy = vi.spyOn(stream.read, 'cancel');
        const abortSpy = vi.spyOn(stream.write, 'abort');
        const gate = deferred();
        mockGetEpoxyClient.mockReturnValue(gate.promise);

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);

        socket.close();
        gate.resolve(makeClient(stream));

        await until(() => expect(cancelSpy).toHaveBeenCalled());
        expect(abortSpy).toHaveBeenCalled();
        expect(events.open).not.toHaveBeenCalled();
    });

    // #readLoop now defers the close event to #closeStreams whenever a teardown
    // is under way, so #closeStreams has to emit it even when cancelling the
    // reader fails -- otherwise close would go missing entirely.
    it('still emits close when cancelling the reader fails', async () => {
        let readController;
        const read = new ReadableStream({
            start (controller) {
                readController = controller;
            },
            cancel () {
                throw new Error('cancel failed');
            },
        });
        void readController;
        const write = new WritableStream({ write () {} });
        mockGetEpoxyClient.mockResolvedValue(makeClient({ read, write }));

        const socket = new PSocket('example.com', 80);
        const events = listen(socket);
        await until(() => expect(events.open).toHaveBeenCalled());

        socket.close();
        await until(() => expect(events.close).toHaveBeenCalled());

        expect(events.close).toHaveBeenCalledTimes(1);
        expect(events.close).toHaveBeenCalledWith(false);
    });

    it('stops emitting data after close', async () => {
        const { socket, events, stream } = await connected();

        socket.close();
        await until(() => expect(events.close).toHaveBeenCalled());
        expect(() => stream.push(new Uint8Array([1]))).toThrow();

        expect(events.data).not.toHaveBeenCalled();
    });
});

describe('PTLSSocket', () => {
    it('opens a TLS stream and reports tls-prefixed events through on()', async () => {
        const stream = makeStream();
        const client = makeClient(stream);
        mockGetEpoxyClient.mockResolvedValue(client);

        const socket = new PTLSSocket('example.com', 443);
        const events = listen(socket);
        await until(() => expect(events.open).toHaveBeenCalledTimes(1));

        expect(client.connectTls).toHaveBeenCalledWith('example.com', 443);
        expect(client.connect).not.toHaveBeenCalled();

        stream.push(new Uint8Array([7]));
        await until(() => expect(events.data).toHaveBeenCalledTimes(1));
        expect(Array.from(events.data.mock.calls[0][0])).toEqual([7]);

        stream.endRead();
        await until(() => expect(events.close).toHaveBeenCalledWith(false));
    });

    // `on('open')` is sugar that remaps onto the tls-prefixed name; listening
    // for the prefixed name directly has to keep working too.
    it('also accepts the tls-prefixed event names directly', async () => {
        const stream = makeStream();
        mockGetEpoxyClient.mockResolvedValue(makeClient(stream));

        const socket = new PTLSSocket('example.com', 443);
        const onTlsOpen = vi.fn();
        const onTlsData = vi.fn();
        socket.on('tlsopen', onTlsOpen);
        socket.on('tlsdata', onTlsData);

        await until(() => expect(onTlsOpen).toHaveBeenCalledTimes(1));

        stream.push(new Uint8Array([8]));
        await until(() => expect(onTlsData).toHaveBeenCalledTimes(1));
    });

    it('reports errors on the unprefixed error event', async () => {
        mockGetEpoxyClient.mockRejectedValue(new Error('tls handshake failed'));

        const socket = new PTLSSocket('example.com', 443);
        const events = listen(socket);
        await until(() => expect(events.error).toHaveBeenCalled());

        expect(events.error.mock.calls[0][0].message).toBe('tls handshake failed');
    });

    it('routes addListener through the same remapping as on()', async () => {
        const stream = makeStream();
        mockGetEpoxyClient.mockResolvedValue(makeClient(stream));

        const socket = new PTLSSocket('example.com', 443);
        const onOpen = vi.fn();
        socket.addListener('open', onOpen);

        await until(() => expect(onOpen).toHaveBeenCalledTimes(1));
    });
});
