let EPOXY_BASE = 'https://puter-net.b-cdn.net/epoxy/affd9f5';
let epoxyRuntimePromise;

const textEncoder = new TextEncoder();

async function getEpoxyRuntime () {
    if ( epoxyRuntimePromise ) {
        return await epoxyRuntimePromise;
    }

    epoxyRuntimePromise = (async () => {
        const base = EPOXY_BASE;
        const runtime = await import(/* webpackIgnore: true */ `${base}/full.js`);
        const wasmResponse = await fetch(`${base}/full.wasm`);
        if ( ! wasmResponse.ok ) {
            throw new Error(
                `Failed to load epoxy wasm (HTTP ${wasmResponse.status} ${wasmResponse.statusText}).`,
            );
        }
        await runtime.init({ module_or_path: wasmResponse });
        return runtime;
    })();

    try {
        return await epoxyRuntimePromise;
    } catch ( error ) {
        epoxyRuntimePromise = undefined;
        throw error;
    }
}

// Exported for tests: the wisp password extension's byte layout is hand-packed,
// and `runtime` is injectable, so it can be exercised without the wasm bundle.
export function createPuterPasswordBuilder (runtime, wispToken) {
    class PuterPasswordExt extends runtime.JsProtocolExtension {
        constructor (required, toSend) {
            super(0x02, [], []);
            this.required = required;
            this.toSend = toSend;
        }

        encode () {
            if ( ! this.toSend ) {
                return new Uint8Array();
            }

            const [_user, _pw] = this.toSend;
            const user = textEncoder.encode(_user);
            const pw = textEncoder.encode(_pw);

            const buffer = new Uint8Array(3 + user.byteLength + pw.byteLength);
            buffer[0] = user.byteLength;
            new DataView(buffer.buffer).setUint16(1, pw.byteLength, true);
            buffer.set(user, 3);
            buffer.set(pw, 3 + user.byteLength);

            return buffer;
        }
    }

    class PuterPasswordExtBuilder extends runtime.JsProtocolExtensionBuilder {
        constructor (toSend) {
            super(0x02);
            this.toSend = toSend;
        }

        buildFromBytes (bytes) {
            return new PuterPasswordExt(bytes[0] !== 0);
        }

        buildToExtension () {
            return new PuterPasswordExt(undefined, this.toSend);
        }
    }

    return new PuterPasswordExtBuilder(['', wispToken]);
}

/**
 * The runtime's `WebSocketJsProvider`, except that each relay websocket is
 * recorded on `transport`: `down` says whether the current one is unusable, and
 * a `closed` transport refuses to dial again.
 *
 * @param {string} url
 * @param {string | undefined} protocol
 * @param {import('./types.js').RelayTransport} transport
 * @returns {Promise<[ReadableStream, WritableStream]>}
 */
export function openRelaySocket (url, protocol, transport) {
    if ( transport.closed ) {
        return Promise.reject(new Error('Relay connection was closed.'));
    }

    const ws = new WebSocket(url, protocol ? [protocol] : []);
    ws.binaryType = 'arraybuffer';
    transport.sockets.add(ws);
    transport.current = ws;

    const markDown = () => {
        transport.sockets.delete(ws);
        if ( transport.current === ws ) {
            transport.down = true;
        }
    };
    ws.addEventListener('error', markDown);
    ws.addEventListener('close', markDown);

    return new Promise((resolve, reject) => {
        ws.addEventListener('error', reject);
        ws.addEventListener('open', () => {
            ws.removeEventListener('error', reject);
            if ( transport.current === ws ) {
                transport.down = false;
            }

            const readable = new ReadableStream({
                start (controller) {
                    ws.addEventListener('message', ({ data }) => {
                        controller.enqueue(typeof data === 'string' ? data : new Uint8Array(data));
                    });
                    ws.addEventListener('error', error => controller.error(error));
                    ws.addEventListener('close', () => {
                        try {
                            controller.close();
                        } catch {
                            // already errored
                        }
                    });
                },
                cancel: () => ws.close(),
            });
            const writable = new WritableStream({
                write: chunk => ws.send(chunk),
                abort: () => ws.close(),
                close: () => ws.close(),
            });
            resolve([readable, writable]);
        });
    });
}

export let initEpoxy = async ({ wispToken, wispServer, transport }) => {
    const runtime = await getEpoxyRuntime();

    const provider = new runtime.WispSocketProvider(
        new runtime.JsProvider((url, protocol) => openRelaySocket(url, protocol, transport)),
        wispServer,
        () => ({
            builders: [createPuterPasswordBuilder(runtime, wispToken)],
            requiredExts: [],
        }),
    );

    return new runtime.EpoxyClient(provider);
};
