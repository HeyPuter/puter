import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Load the dual-export XHR adapter natively; Vite treats its CommonJS branch as a module mutation.
const { default: XMLHttpRequestShim } = createRequire(import.meta.url)('../../../../lib/polyfills/xhrshim.js');
import upload from './index.js';
import { THUMBNAIL_UPLOAD_TIMEOUT_MS } from './constants.js';

let server;
let fs;
let thumbnailResponse;
let fileResponse;
let fileBytes;
let completion;
let requestHandle;
let thumbnailStarted;
let onThumbnailStarted;

beforeEach(async () => {
    thumbnailResponse = 200;
    fileResponse = 200;
    fileBytes = undefined;
    completion = undefined;
    thumbnailStarted = new Promise(resolve => { onThumbnailStarted = resolve; });
    server = createServer(async (req, res) => {
        const chunks = [];
        for await ( const chunk of req ) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const origin = fs.APIOrigin;
        res.setHeader('Content-Type', 'application/json');
        if ( req.url === '/fs/startBatchWrite' ) {
            res.end(JSON.stringify([{
                sessionId: 'test-upload', uploadMode: 'single', url: `${origin}/file`,
                thumbnailUploadUrl: `${origin}/thumbnail`, thumbnailUrl: `${origin}/preview.png`,
            }]));
        } else if ( req.url === '/thumbnail' ) {
            onThumbnailStarted();
            if ( thumbnailResponse === 'hang' ) return;
            if ( thumbnailResponse === 'disconnect' ) { req.socket.destroy(); return; }
            res.statusCode = thumbnailResponse;
            res.end('{}');
        } else if ( req.url === '/file' ) {
            fileBytes = body.toString();
            res.statusCode = fileResponse;
            res.end('{}');
        } else if ( req.url === '/fs/completeBatchWrite' ) {
            completion = JSON.parse(body)[0];
            res.end(JSON.stringify([{ uid: 'uploaded-file' }]));
        } else if ( req.url === '/fs/abortWrite' ) {
            res.end('{}');
        } else {
            res.statusCode = 404;
            res.end('{}');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    fs = { APIOrigin: `http://127.0.0.1:${server.address().port}`, authToken: 'test-token' };
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequestShim);
    vi.stubGlobal('puter', { env: 'gui', authToken: 'test-token', fs });
});

afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    vi.unstubAllGlobals();
});

const uploadFile = () => upload.call(fs, new File(['original PDF bytes'], 'document.pdf'), '/testuser', {
    thumbnailGenerator: async () => 'data:image/png;base64,AAAA',
    init: (_id, xhr) => { requestHandle = xhr; },
});

describe('optional thumbnail transfer over HTTP', () => {
    it('uploads the thumbnail and the original file', async () => {
        expect(await uploadFile()).toEqual({ uid: 'uploaded-file' });
        expect(fileBytes).toBe('original PDF bytes');
        expect(completion.thumbnailData).toBe(`${fs.APIOrigin}/preview.png`);
    });

    it.each([403, 500, 'disconnect'])('preserves the original when thumbnail transfer fails: %s', async (failure) => {
        thumbnailResponse = failure;
        expect(await uploadFile()).toEqual({ uid: 'uploaded-file' });
        expect(fileBytes).toBe('original PDF bytes');
        expect(completion).not.toHaveProperty('thumbnailData');
    });

    it('times out a stalled thumbnail transfer and uploads the file', async () => {
        thumbnailResponse = 'hang';
        expect(await uploadFile()).toEqual({ uid: 'uploaded-file' });
        expect(fileBytes).toBe('original PDF bytes');
        expect(completion).not.toHaveProperty('thumbnailData');
    }, THUMBNAIL_UPLOAD_TIMEOUT_MS + 3000);

    it('does not swallow cancellation during thumbnail transfer', async () => {
        thumbnailResponse = 'hang';
        const result = uploadFile();
        const rejection = expect(result).rejects.toMatchObject({ partial: true });
        await thumbnailStarted;
        requestHandle.abort();
        await rejection;
        expect(fileBytes).toBeUndefined();
        expect(completion).toBeUndefined();
    });

    it('still rejects when the original file fails to upload', async () => {
        fileResponse = 500;
        await expect(uploadFile()).rejects.toMatchObject({ partial: true });
        expect(completion).toBeUndefined();
    });
});
