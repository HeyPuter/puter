let EPOXY_BASE = 'https://puter-net.b-cdn.net/epoxy/7fbb05b';
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

function createPuterPasswordBuilder (runtime, wispToken) {
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

export let initEpoxy = async ({ wispToken, wispServer }) => {
    const runtime = await getEpoxyRuntime();

    const provider = new runtime.WispSocketProvider(
        new runtime.WebSocketJsProvider(),
        wispServer,
        () => [
            { builders: [createPuterPasswordBuilder(runtime, wispToken)] },
            [0x02],
        ],
    );

    return new runtime.EpoxyClient(provider);
};
