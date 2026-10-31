import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPuterPasswordBuilder, openRelaySocket } from './epoxy.js';

// Stand-ins for the extension base classes the epoxy wasm bundle exports.
// Loading the real runtime needs a network fetch plus a wasm instantiation, so
// only the hand-packed byte layout of our subclasses is exercised here.
function makeRuntime () {
    return {
        JsProtocolExtension: class {
            constructor (id, ...rest) {
                this.id = id;
                this.rest = rest;
            }
        },
        JsProtocolExtensionBuilder: class {
            constructor (id) {
                this.id = id;
            }
        },
    };
}

const PUTER_PASSWORD_EXT_ID = 0x02;

const build = (token = 'wisp-token') =>
    createPuterPasswordBuilder(makeRuntime(), token);

describe('puter password extension', () => {
    it('registers under the puter password extension id', () => {
        expect(build().id).toBe(PUTER_PASSWORD_EXT_ID);
        expect(build().buildToExtension().id).toBe(PUTER_PASSWORD_EXT_ID);
    });

    // Wire format: u8 username length, u16-LE password length, then the
    // username and password bytes. Puter sends an empty username and the
    // relay token as the password.
    it('packs an empty username and the token as the password', () => {
        const encoded = build('abc').buildToExtension().encode();

        expect(Array.from(encoded)).toEqual([
            0, // username length
            3, 0, // password length, little-endian
            97, 98, 99, // "abc"
        ]);
    });

    it('encodes the password length little-endian across the u16 boundary', () => {
        const token = 'x'.repeat(300);

        const encoded = build(token).buildToExtension().encode();

        expect(encoded).toHaveLength(3 + 300);
        expect(encoded[0]).toBe(0);
        // 300 == 0x012c, so the low byte leads.
        expect(encoded[1]).toBe(0x2c);
        expect(encoded[2]).toBe(0x01);
    });

    it('encodes a multi-byte token by its utf-8 length, not its character count', () => {
        // 'é' is two bytes in utf-8, so a 2-character token is 4 bytes.
        const encoded = build('éé').buildToExtension().encode();

        expect(encoded[1]).toBe(4);
        expect(Array.from(encoded.slice(3))).toEqual([195, 169, 195, 169]);
    });

    it('sends nothing for an extension parsed off the wire', () => {
        // buildFromBytes has no payload to send; only buildToExtension does.
        const parsed = build().buildFromBytes(new Uint8Array([1]));

        expect(parsed.encode()).toHaveLength(0);
    });

    it('marks the extension required when the peer flags it', () => {
        expect(build().buildFromBytes(new Uint8Array([1])).required).toBe(true);
        expect(build().buildFromBytes(new Uint8Array([2])).required).toBe(true);
        expect(build().buildFromBytes(new Uint8Array([0])).required).toBe(false);
    });
});

describe('openRelaySocket', () => {
    class FakeWebSocket extends EventTarget {
        static instances = [];

        constructor(url, protocols) {
            super();
            this.url = url;
            this.protocols = protocols;
            this.send = vi.fn();
            this.close = vi.fn(() => this.fire('close'));
            FakeWebSocket.instances.push(this);
        }

        fire(type, props = {}) {
            this.dispatchEvent(Object.assign(new Event(type), props));
        }
    }

    const origWebSocket = globalThis.WebSocket;
    const newTransport = () => ({
        sockets: new Set(),
        current: undefined,
        down: false,
        closed: false,
    });

    beforeEach(() => {
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket;
    });

    afterEach(() => {
        globalThis.WebSocket = origWebSocket;
    });

    it('hands epoxy a readable and writable over the opened websocket', async () => {
        const transport = newTransport();
        const opened = openRelaySocket(
            'wss://relay.test/',
            'wisp-v2',
            transport,
        );
        const [ws] = FakeWebSocket.instances;
        expect(ws.url).toBe('wss://relay.test/');
        expect(ws.protocols).toEqual(['wisp-v2']);
        expect(ws.binaryType).toBe('arraybuffer');
        ws.fire('open');
        const [readable, writable] = await opened;

        ws.fire('message', { data: new Uint8Array([1, 2]).buffer });
        ws.fire('message', { data: 'text' });
        const reader = readable.getReader();
        expect(Array.from((await reader.read()).value)).toEqual([1, 2]);
        expect((await reader.read()).value).toBe('text');

        const chunk = new Uint8Array([3]);
        await writable.getWriter().write(chunk);
        expect(ws.send).toHaveBeenCalledWith(chunk);
        expect(transport.sockets.has(ws)).toBe(true);
        expect(transport.down).toBe(false);
    });

    it('marks the transport down when the relay closes the websocket', async () => {
        const transport = newTransport();
        const opened = openRelaySocket(
            'wss://relay.test/',
            undefined,
            transport,
        );
        const [ws] = FakeWebSocket.instances;
        ws.fire('open');
        const [readable] = await opened;

        ws.fire('close');

        expect(transport.down).toBe(true);
        expect(transport.sockets.size).toBe(0);
        expect((await readable.getReader().read()).done).toBe(true);
    });

    it('rejects and marks the transport down when the websocket cannot open', async () => {
        const transport = newTransport();
        const opened = openRelaySocket(
            'wss://relay.test/',
            undefined,
            transport,
        );
        FakeWebSocket.instances[0].fire('error');

        await expect(opened).rejects.toBeInstanceOf(Event);
        expect(transport.down).toBe(true);
    });

    it('clears the down flag once a redial opens', async () => {
        const transport = newTransport();
        const first = openRelaySocket(
            'wss://relay.test/',
            undefined,
            transport,
        );
        FakeWebSocket.instances[0].fire('open');
        await first;
        FakeWebSocket.instances[0].fire('close');

        const second = openRelaySocket(
            'wss://relay.test/',
            undefined,
            transport,
        );
        FakeWebSocket.instances[1].fire('open');
        await second;

        expect(transport.down).toBe(false);
    });

    it('ignores a superseded websocket closing late', async () => {
        const transport = newTransport();
        const first = openRelaySocket(
            'wss://relay.test/',
            undefined,
            transport,
        );
        FakeWebSocket.instances[0].fire('open');
        await first;
        const second = openRelaySocket(
            'wss://relay.test/',
            undefined,
            transport,
        );
        FakeWebSocket.instances[1].fire('open');
        await second;

        FakeWebSocket.instances[0].fire('close');

        expect(transport.down).toBe(false);
    });

    it('refuses to dial once the transport is closed', async () => {
        const transport = { ...newTransport(), closed: true };

        await expect(
            openRelaySocket('wss://relay.test/', undefined, transport),
        ).rejects.toThrow(/closed/);
        expect(FakeWebSocket.instances).toHaveLength(0);
    });
});
