import { afterEach, describe, expect, it, vi } from 'vitest';
import fetchUrlAsFile from './fetchUrlAsFile.js';

const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
});

const failsWith = async (promise, code) => {
    let caught;
    try {
        await promise;
    } catch ( err ) {
        caught = err;
    }
    expect(caught?.code).toBe(code);
};

const streamOf = (chunks) => new ReadableStream({
    pull (controller) {
        if ( chunks.length ) controller.enqueue(chunks.shift());
        else controller.close();
    },
}, { highWaterMark: 0 });

describe('fetchUrlAsFile', () => {
    it('downloads an https url anonymously into a named File', async () => {
        globalThis.fetch = vi.fn(async () => new Response('body bytes'));
        const file = await fetchUrlAsFile('https://example.com/a.txt', 'a.txt');

        expect(file.name).toBe('a.txt');
        expect(await file.text()).toBe('body bytes');
        expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/a.txt', expect.objectContaining({
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        }));
    });

    it.each([
        'data:text/plain,hi',
        'blob:https://example.com/0b6e7c5e-1d1f-4a4c-9d0a-1f2b3c4d5e6f',
        'javascript:alert(1)',
        'file:///etc/hosts',
        '/relative/path',
        '',
    ])('refuses %j without fetching', async (url) => {
        globalThis.fetch = vi.fn();
        await failsWith(fetchUrlAsFile(url, 'a'), 'url_save_invalid_url');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it.each([
        'http://example.com/a.txt',
        'data:text/plain,hi',
        '/relative/path',
    ])('refuses %j on an https page without fetching', async (url) => {
        vi.stubGlobal('location', { protocol: 'https:' });
        globalThis.fetch = vi.fn();
        await failsWith(fetchUrlAsFile(url, 'a'), 'url_save_https_only');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('downloads an https url on an https page', async () => {
        vi.stubGlobal('location', { protocol: 'https:' });
        globalThis.fetch = vi.fn(async () => new Response('ok'));
        const file = await fetchUrlAsFile('https://example.com/a.txt', 'a.txt');
        expect(await file.text()).toBe('ok');
    });

    it('downloads an http url on an http page', async () => {
        vi.stubGlobal('location', { protocol: 'http:' });
        globalThis.fetch = vi.fn(async () => new Response('ok'));
        const file = await fetchUrlAsFile('http://example.com/a.txt', 'a.txt');
        expect(await file.text()).toBe('ok');
    });

    it('stops the download when the signal aborts', async () => {
        globalThis.fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
        }));
        const caller = new AbortController();
        const download = fetchUrlAsFile('https://example.com/slow', 'a', { signal: caller.signal });
        caller.abort();
        await failsWith(download, 'url_save_failed');
        expect(globalThis.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('stops reading the body when the signal aborts', async () => {
        const caller = new AbortController();
        let pulls = 0;
        // Like fetch, an aborted request errors its body stream.
        globalThis.fetch = vi.fn(async (url, { signal }) => new Response(new ReadableStream({
            pull (controller) {
                if ( signal.aborted ) return controller.error(signal.reason);
                pulls++;
                controller.enqueue(new Uint8Array(1));
                if ( pulls === 2 ) caller.abort();
            },
        }, { highWaterMark: 0 })));
        await failsWith(fetchUrlAsFile('https://example.com/a', 'a', { signal: caller.signal }), 'url_save_failed');
        expect(pulls).toBe(2);
    });

    it('does not fetch when the signal has already aborted', async () => {
        globalThis.fetch = vi.fn();
        const caller = new AbortController();
        caller.abort();
        await failsWith(fetchUrlAsFile('https://example.com/a', 'a', { signal: caller.signal }), 'url_save_failed');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('fails on a non-2xx status', async () => {
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 }));
        await failsWith(fetchUrlAsFile('https://example.com/missing', 'a'), 'url_save_failed');
    });

    it('fails on a network or CORS error', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        });
        await failsWith(fetchUrlAsFile('https://example.com/a', 'a'), 'url_save_failed');
    });

    it('refuses a declared length over the cap before reading the body', async () => {
        const body = streamOf([new Uint8Array(4)]);
        globalThis.fetch = vi.fn(async () => new Response(body, { headers: { 'content-length': '11' } }));
        await failsWith(fetchUrlAsFile('https://example.com/a', 'a', { maxBytes: 10 }), 'url_save_too_large');
    });

    it('stops reading once the body passes the cap', async () => {
        const chunks = [new Uint8Array(6), new Uint8Array(6), new Uint8Array(6)];
        globalThis.fetch = vi.fn(async () => new Response(streamOf(chunks)));
        await failsWith(fetchUrlAsFile('https://example.com/a', 'a', { maxBytes: 10 }), 'url_save_too_large');
        // The third chunk was never pulled.
        expect(chunks).toHaveLength(1);
    });

    it('keeps reading while chunks arrive within the timeout', async () => {
        const chunks = ['a', 'b', 'c'].map((c) => new TextEncoder().encode(c));
        const slow = new ReadableStream({
            async pull (controller) {
                await new Promise((r) => setTimeout(r, 15));
                if ( chunks.length ) controller.enqueue(chunks.shift());
                else controller.close();
            },
        }, { highWaterMark: 0 });
        globalThis.fetch = vi.fn(async () => new Response(slow));
        const file = await fetchUrlAsFile('https://example.com/a', 'a', { timeoutMs: 30 });
        expect(await file.text()).toBe('abc');
    });

    it('gives up when nothing arrives within the timeout', async () => {
        globalThis.fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason));
        }));
        await failsWith(fetchUrlAsFile('https://example.com/slow', 'a', { timeoutMs: 10 }), 'url_save_failed');
    });
});
