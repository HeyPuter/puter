import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Load the dual-export XHR adapter natively; Vite treats its CommonJS branch as a module mutation.
const { default: XMLHttpRequestShim } = createRequire(import.meta.url)('./xhrshim.js');

// Signed storage backends answer a PUT with neither a content-type nor a body,
// shapes the shim used to throw on inside its own `then` — leaving the request
// hanging with no 'load' and no 'error'.
let respond;
let server;
let origin;

beforeEach(async () => {
    respond = (res) => { res.end('stored'); };
    server = createServer(async (req, res) => {
        for await ( const chunk of req ) void chunk;
        respond(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
});

const put = (body = 'payload') => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequestShim();
    xhr.open('PUT', `${origin}/object`);
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error('request errored'));
    xhr.send(body);
});

describe('xhrshim', () => {
    it('completes a response that declares no content-type', async () => {
        const xhr = await put();
        expect(xhr.status).toBe(200);
        expect(xhr.responseText).toBe('stored');
    });

    it('completes a response with no body', async () => {
        respond = (res) => { res.statusCode = 204; res.end(); };
        const xhr = await put();
        expect(xhr.status).toBe(204);
        expect(xhr.responseText).toBe('');
    });

    it('reads a response header regardless of the case asked for', async () => {
        respond = (res) => { res.setHeader('ETag', '"abc123"'); res.end(); };
        const xhr = await put();
        expect(xhr.getResponseHeader('etag')).toBe('"abc123"');
        expect(xhr.getResponseHeader('ETag')).toBe('"abc123"');
        expect(xhr.getResponseHeader('content-type')).toBe(null);
    });
});
