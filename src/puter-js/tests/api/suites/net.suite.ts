import { suite } from '../harness/types.ts';

/** The socket surface, which the public `.d.ts` types loosely. */
type Socket = {
    on: (event: string, handler: (data: unknown) => void) => unknown;
    off: (event: string, handler: (data: unknown) => void) => unknown;
    emit: (event: string, data?: unknown) => void;
    write: (data: unknown, callback?: () => void) => void;
    close: () => void;
};

/** Resolves once `socket` reports the connection attempt failed. */
const failure = (socket: Socket) =>
    new Promise<{ error: unknown; hadError: unknown }>((resolve, reject) => {
        let error: unknown;
        const timer = setTimeout(
            () => reject(new Error('socket never reported a failure')),
            15_000,
        );
        socket.on('error', (e) => {
            error = e;
        });
        socket.on('close', (hadError) => {
            clearTimeout(timer);
            resolve({ error, hadError });
        });
    });

/**
 * The relay-token endpoints are part of the core backend and run keyless;
 * only the relay itself (`wisp.server`) is external. Socket-level tests
 * are capability-gated on `net.wisp`; everything reachable without a live
 * relay — option validation, event wiring, the failed-dial path — is not.
 */
export default suite('net', {
    'relay-token create mints a token': async (t) => {
        const res = await fetch(
            `${t.env.apiOrigin}/wisp/relay-token/create`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${t.env.users.user.token}`,
                    'Content-Type': 'application/json',
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({}),
            },
        );
        t.assert.equal(res.status, 200);
        const body = (await res.json()) as { token?: string };
        t.assert.ok(body.token, 'response should include a token');
        t.assert.ok('server' in body, 'response should include the server field');
    },

    'relay-token verify accepts a freshly minted token': async (t) => {
        const createRes = await fetch(
            `${t.env.apiOrigin}/wisp/relay-token/create`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${t.env.users.user.token}`,
                    'Content-Type': 'application/json',
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({}),
            },
        );
        const { token } = (await createRes.json()) as { token: string };

        const verifyRes = await fetch(
            `${t.env.apiOrigin}/wisp/relay-token/verify`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({ token }),
            },
        );
        t.assert.equal(verifyRes.status, 200);
    },

    'relay-token verify rejects garbage': async (t) => {
        const res = await fetch(
            `${t.env.apiOrigin}/wisp/relay-token/verify`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: t.env.apiOrigin,
                },
                body: JSON.stringify({ token: 'not-a-real-wisp-token' }),
            },
        );
        t.assert.ok(res.status !== 200, 'garbage token should not verify');
    },

    'generateWispV1URL embeds a relay token': {
        requires: ['net.wisp'],
        fn: async (t) => {
            const url = await t.puter.net.generateWispV1URL();
            t.assert.ok(
                url.startsWith('ws'),
                `wisp URL should point at the configured relay, got: ${url}`,
            );
        },
    },

    // -- puter.net.fetch --

    'net.fetch refuses a URL scheme it cannot tunnel': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.net.fetch('ftp://example.com/file.txt'),
        );
        t.assert.equal(
            error,
            'Failed to fetch. URL scheme "ftp:" is not supported.',
        );
    },

    'net.fetch surfaces an invalid request rather than dialing': async (t) => {
        const error = (await t.assert.rejects(() =>
            t.puter.net.fetch('http://example.com/', {
                method: 'GET',
                body: 'not allowed on a GET',
            }),
        )) as Error;
        t.assert.ok(error instanceof TypeError, `expected a TypeError, got ${error}`);
    },

    // `Content-Length` is a forbidden header name in a browser, where
    // `new Headers()` drops it outright, so the mismatch this guard exists
    // for can only be constructed off the browser.
    'net.fetch rejects a Content-Length that disagrees with the body': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            const error = await t.assert.rejects(() =>
                t.puter.net.fetch('http://example.com/', {
                    method: 'POST',
                    headers: { 'content-length': '999' },
                    body: 'short',
                }),
            );
            t.assert.equal(
                error,
                'Content-Length header does not match the body length. Please check your request.',
            );
        },
    },

    // -- Sockets --

    // With no relay configured the dial cannot complete, and the failure has
    // to reach the caller as events: nothing awaits the socket constructor.
    'a socket with no relay configured reports an error and closes': async (t) => {
        const socket = new t.puter.net.Socket(
            'example.com',
            80,
        ) as unknown as Socket;
        const { error, hadError } = await failure(socket);
        t.assert.ok(error instanceof Error, `expected an Error, got ${error}`);
        t.assert.equal(hadError, true, 'a failed dial closes with hadError');
    },

    'a socket only accepts the event names it declares': async (t) => {
        const socket = new t.puter.net.Socket(
            'example.com',
            80,
        ) as unknown as Socket;
        const handler = () => {};
        t.assert.equal(
            socket.on('data', handler),
            socket,
            'registering a known event returns the socket',
        );
        t.assert.equal(
            socket.off('data', handler),
            socket,
            'removing a known event returns the socket',
        );
        t.assert.equal(socket.on('net-suite-unknown', handler), undefined);
        t.assert.equal(socket.off('net-suite-unknown', handler), undefined);

        let delivered: unknown = 'never';
        socket.on('data', (value) => {
            delivered = value;
        });
        socket.emit('data', 'payload');
        t.assert.equal(delivered, 'payload');
        // Emitting an undeclared event is reported and dropped, not thrown.
        socket.emit('net-suite-unknown', 'ignored');
        t.assert.equal(delivered, 'payload');
        await failure(socket);
    },

    'a socket refuses data that is not a string, buffer or typed array': async (
        t,
    ) => {
        const socket = new t.puter.net.Socket(
            'example.com',
            80,
        ) as unknown as Socket;
        const error = (await t.assert.rejects(async () =>
            socket.write(42),
        )) as Error;
        t.assert.equal(
            error.message,
            'Invalid data type (not TypedArray, ArrayBuffer or String!!)',
        );
        await failure(socket);
    },

    'a TLS socket aliases the plain socket event names': async (t) => {
        const socket = new t.puter.net.tls.TLSSocket(
            'example.com',
            443,
        ) as unknown as Socket;
        const seen: string[] = [];
        // On a TLS socket 'data'/'open'/'close' are aliases of the
        // tls-prefixed events, so the same handler code works on either type.
        socket.on('data', (value) => seen.push(`data:${String(value)}`));
        socket.on('open', () => seen.push('open'));
        socket.on('close', (hadError) => seen.push(`close:${String(hadError)}`));
        socket.emit('tlsdata', 'ciphertext');
        socket.emit('tlsopen', undefined);
        socket.emit('tlsclose', false);
        t.assert.deepEqual(seen, [
            'data:ciphertext',
            'open',
            'close:false',
        ]);

        const error = (await t.assert.rejects(async () =>
            socket.write(42),
        )) as Error;
        t.assert.equal(
            error.message,
            'Invalid data type (not TypedArray, ArrayBuffer or String!!)',
        );
    },
});
