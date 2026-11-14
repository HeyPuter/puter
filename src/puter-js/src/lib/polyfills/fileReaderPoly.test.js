import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileReaderPoly } from './fileReaderPoly.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Reads `source` and resolves with the events the reader fired, in order. */
const read = source => new Promise((resolve) => {
    const reader = new FileReaderPoly();
    const events = [];
    reader.onload = event => events.push(['load', event.target]);
    reader.onerror = error => events.push(['error', error]);
    reader.onloadend = () => resolve({ reader, events });
    reader.readAsDataURL(source);
});

describe('FileReaderPoly.readAsDataURL', () => {
    it('reads a blob as a data URL of its own type, firing load then loadend', async () => {
        const { reader, events } = await read(new Blob(['hello'], { type: 'text/plain' }));
        expect(reader.result).toBe('data:text/plain;base64,aGVsbG8=');
        expect(reader.error).toBeNull();
        expect(events).toEqual([['load', reader]]);
    });

    it('reads raw bytes as an octet stream', async () => {
        const bytes = new TextEncoder().encode('hello');
        expect((await read(bytes.buffer)).reader.result).toBe('data:application/octet-stream;base64,aGVsbG8=');
        expect((await read(bytes)).reader.result).toBe('data:application/octet-stream;base64,aGVsbG8=');
    });

    it('reads only the bytes a view covers, not its whole backing buffer', async () => {
        const bytes = new TextEncoder().encode('say hello there');
        expect((await read(bytes.subarray(4, 9))).reader.result).toBe('data:application/octet-stream;base64,aGVsbG8=');
        expect((await read(new DataView(bytes.buffer, 4, 5))).reader.result).toBe('data:application/octet-stream;base64,aGVsbG8=');
        // Wider elements are read as their bytes.
        const wide = new Uint16Array(new Uint8Array([0, 0, 104, 105, 33, 63]).buffer, 2, 2);
        expect((await read(wide)).reader.result).toBe('data:application/octet-stream;base64,aGkhPw==');
    });

    it('reads bytes outside ASCII', async () => {
        const { reader } = await read(new Uint8Array([0, 255, 128]).buffer);
        expect(reader.result).toBe('data:application/octet-stream;base64,AP+A');
    });

    it('reads nothing as an empty data URL', async () => {
        const { reader, events } = await read(undefined);
        expect(reader.result).toBe('data:application/octet-stream;base64,');
        expect(events).toEqual([['load', reader]]);
    });

    it('fires error then loadend, and no load, when the blob cannot be read', async () => {
        const failure = new Error('blob was revoked');
        const { reader, events } = await read({ type: 'text/plain', arrayBuffer: async () => {
            throw failure;
        } });
        expect(events).toEqual([['error', failure]]);
        expect(reader.error).toBe(failure);
        expect(reader.result).toBeNull();
    });

    it('encodes without btoa where the runtime has none', async () => {
        vi.stubGlobal('btoa', undefined);
        const { reader } = await read(new Blob(['hello'], { type: 'text/plain' }));
        expect(reader.result).toBe('data:text/plain;base64,aGVsbG8=');
    });

    it('needs no listeners to finish a read', async () => {
        const reader = new FileReaderPoly();
        reader.readAsDataURL(new Blob(['hi']));
        await vi.waitFor(() => expect(reader.result).toBe('data:application/octet-stream;base64,aGk='));
    });
});
