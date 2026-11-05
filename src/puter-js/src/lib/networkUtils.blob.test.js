import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { driverCall } from './networkUtils.js';

const SIZE = 1024 * 1024;

function installBlobXHR(blob) {
    class FakeXHR {
        _listeners = {};
        status = 0;
        readyState = 0;
        responseType = '';
        upload = { addEventListener() {} };
        open() {}
        setRequestHeader() {}
        addEventListener(type, fn) {
            (this._listeners[type] ??= []).push(fn);
        }
        getResponseHeader(name) {
            return name.toLowerCase() === 'content-type' ? 'video/mp4' : null;
        }
        abort() {}
        send() {
            queueMicrotask(() => {
                this.status = 200;
                this.response = blob;
                this.readyState = 4;
                for (const fn of this._listeners.readystatechange ?? [])
                    fn.call(this);
                for (const fn of this._listeners.load ?? []) fn.call(this);
            });
        }
    }
    globalThis.XMLHttpRequest = FakeXHR;
}

let savedXHR;
beforeEach(() => {
    savedXHR = globalThis.XMLHttpRequest;
    globalThis.puter = {
        authToken: 't',
        APIOrigin: 'https://api.test',
        env: 'nodejs',
    };
});
afterEach(() => {
    globalThis.XMLHttpRequest = savedXHR;
    delete globalThis.puter;
    vi.restoreAllMocks();
});

describe('successful blob driver call', () => {
    it('returns the blob without decoding it to text', async () => {
        const blob = new Blob([randomBytes(SIZE)], { type: 'video/mp4' });
        installBlobXHR(blob);
        const textSpy = vi.spyOn(Blob.prototype, 'text');

        const t0 = performance.now();
        const result = await driverCall(
            {
                iface: 'puter-video-generation',
                method: 'generate',
                args: {},
                puter: globalThis.puter,
            },
            { responseType: 'blob' },
        );
        const ms = performance.now() - t0;

        expect(result).toBe(blob);
        expect(textSpy).not.toHaveBeenCalled();
        process.stdout.write(
            `driverCall on a ${SIZE / 1024 / 1024} MiB blob: ${ms.toFixed(1)} ms\n`,
        );
    });
});
