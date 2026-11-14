import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Load the dual-export XHR adapter natively; Vite treats its CommonJS branch as a module mutation.
const { default: XMLHttpRequestShim } = createRequire(import.meta.url)('../../../../lib/polyfills/xhrshim.js');
import upload from './index.js';
import { postJson, toErrorMessage, uploadBlobToSignedUrl } from './requests.js';
import { toSignedRequestPath } from './signedBatchUpload.js';

const HANG = Symbol('hang');
const DISCONNECT = Symbol('disconnect');

let server;
let origin;
let fs;
/** URL path -> handler returning `{ status?, body?, headers?, text? }`, HANG or DISCONNECT. */
let routes;
/** Every request the backend received, in order. */
let requests;
let operationId;
let requestHandle;

beforeEach(async () => {
    routes = {};
    requests = [];
    server = createServer(async (req, res) => {
        const chunks = [];
        for await ( const chunk of req ) chunks.push(chunk);
        const request = { method: req.method, url: req.url, headers: req.headers, raw: Buffer.concat(chunks) };
        requests.push(request);
        const route = routes[req.url];
        // An endpoint this backend does not have.
        if ( ! route ) {
            res.statusCode = 404;
            res.end('');
            return;
        }
        const reply = await route(request);
        if ( reply === HANG ) return;
        if ( reply === DISCONNECT ) {
            req.socket.destroy();
            return;
        }
        res.statusCode = reply?.status ?? 200;
        for ( const [name, value] of Object.entries(reply?.headers ?? {}) ) res.setHeader(name, value);
        if ( reply?.text !== undefined ) {
            res.end(reply.text);
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(reply?.body ?? {}));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    fs = { APIOrigin: origin, authToken: 'test-token' };
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequestShim);
    vi.stubGlobal('puter', { env: 'gui', authToken: 'test-token', fs });
});

afterEach(async () => {
    vi.useRealTimers();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    vi.unstubAllGlobals();
});

const sent = url => requests.filter(request => request.url === url);
const jsonSent = url => sent(url).map(request => JSON.parse(request.raw.toString()));
const textSent = url => sent(url).map(request => request.raw.toString());
const formSent = async (url) => {
    const [request] = sent(url);
    return await new Response(request.raw, { headers: { 'content-type': request.headers['content-type'] } }).formData();
};
const operationsIn = form => form.getAll('operation').map(value => JSON.parse(value));

/** Polls until `check` holds. */
const until = async (check) => {
    for ( let i = 0; i < 500; i++ ) {
        if ( check() ) return;
        await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error('the expected state was never reached');
};

const fileOf = (content, name, type = 'text/plain') => new File([content], name, { type });

const uploadTo = (items, options = {}) => upload.call(fs, items, '/alice/docs', {
    init: (id, xhr) => {
        operationId = id;
        requestHandle = xhr;
    },
    ...options,
});

/** The upload's rejection, or a failure if it resolved. */
const rejectionOf = async (uploading) => {
    try {
        await uploading;
    } catch (e) {
        return e;
    }
    throw new Error('the upload resolved');
};

/** A backend with signed writes: one single-shot session per file, stored at `/store/<n>`. */
const signedBackend = () => {
    routes['/fs/startBatchWrite'] = ({ raw }) => ({
        body: JSON.parse(raw.toString()).map((_item, index) => {
            routes[`/store/${index}`] = () => ({});
            return { sessionId: `session-${index}`, uploadMode: 'single', url: `${origin}/store/${index}` };
        }),
    });
    routes['/fs/completeBatchWrite'] = ({ raw }) => ({
        body: JSON.parse(raw.toString()).map(item => ({ fsEntry: { uid: `entry-of-${item.uploadId}` } })),
    });
    routes['/fs/abortWrite'] = () => ({});
};

describe('signed upload in parts', () => {
    const multipartBackend = ({ partUrls, signed }) => {
        routes['/fs/startBatchWrite'] = () => ({
            body: [{
                sessionId: 'session-big',
                uploadMode: 'multipart',
                multipartPartSize: 4,
                multipartPartCount: 3,
                multipartPartUrls: partUrls.map(partNumber => ({ partNumber, url: `${origin}/part/${partNumber}` })),
            }],
        });
        routes['/fs/signMultipartParts'] = () => ({ body: signed });
        for ( const partNumber of [1, 2, 3] ) {
            routes[`/part/${partNumber}`] = () => ({ headers: { ETag: `"etag-${partNumber}"` } });
        }
        routes['/fs/completeBatchWrite'] = () => ({ body: [{ fsEntry: { uid: 'big-file' } }] });
        routes['/fs/abortWrite'] = () => ({});
    };

    it('asks for the part URLs the backend did not hand out, then uploads every part', async () => {
        multipartBackend({
            partUrls: [1],
            signed: {
                multipartPartUrls: [
                    { partNumber: 2, url: `${origin}/part/2` },
                    { partNumber: 3, url: `${origin}/part/3` },
                    { partNumber: 4 },
                ],
            },
        });
        const progress = vi.fn();
        const result = await uploadTo(fileOf('aaaabbbbcc', 'big.bin', 'application/octet-stream'), { progress });

        expect(result).toEqual({ uid: 'big-file' });
        expect(jsonSent('/fs/signMultipartParts')).toEqual([{ uploadId: 'session-big', partNumbers: [2, 3] }]);
        expect([1, 2, 3].map(partNumber => textSent(`/part/${partNumber}`))).toEqual([['aaaa'], ['bbbb'], ['cc']]);
        expect(jsonSent('/fs/completeBatchWrite')).toEqual([[
            expect.objectContaining({
                uploadId: 'session-big',
                parts: [
                    { partNumber: 1, etag: '"etag-1"' },
                    { partNumber: 2, etag: '"etag-2"' },
                    { partNumber: 3, etag: '"etag-3"' },
                ],
            }),
        ]]);
        expect(progress.mock.calls.every(([id]) => id === operationId)).toBe(true);
        expect(Number(progress.mock.calls.at(-1)[1])).toBe(100);
    });

    it('fails the file and aborts its session when a part comes back without an ETag', async () => {
        multipartBackend({ partUrls: [1, 2, 3], signed: {} });
        routes['/part/2'] = () => ({});
        const failure = await rejectionOf(uploadTo(fileOf('aaaabbbbcc', 'big.bin')));

        expect(failure).toMatchObject({
            partial: true,
            completedItemCount: 0,
            totalItemCount: 1,
            failedPaths: ['/alice/docs/big.bin'],
            failedItems: [{
                stage: 'upload',
                uploadId: 'session-big',
                path: '/alice/docs/big.bin',
                name: 'big.bin',
                message: 'Missing ETag for multipart part 2',
            }],
        });
        expect(jsonSent('/fs/abortWrite')).toEqual([{ uploadId: 'session-big' }]);
        expect(sent('/fs/completeBatchWrite')).toEqual([]);
    });

    it('fails the file when the backend signs no URL for a missing part', async () => {
        multipartBackend({ partUrls: [1, 3], signed: {} });
        const failure = await rejectionOf(uploadTo(fileOf('aaaabbbbcc', 'big.bin')));
        expect(failure.failedItems).toMatchObject([{ message: 'Missing signed multipart URL for part 2' }]);
        expect(sent('/part/2')).toEqual([]);
    });
});

describe('signed upload answers the SDK cannot use', () => {
    it('fails the file when its session carries no upload URL', async () => {
        signedBackend();
        routes['/fs/startBatchWrite'] = () => ({ body: [{ sessionId: 'session-0', uploadMode: 'single' }] });
        const failure = await rejectionOf(uploadTo(fileOf('hello', 'notes.txt')));
        expect(failure).toMatchObject({
            partial: true,
            failedItems: [{ stage: 'upload', message: 'Signed upload URL is missing' }],
        });
        expect(jsonSent('/fs/abortWrite')).toEqual([{ uploadId: 'session-0' }]);
    });

    it.each([
        ['fewer sessions than files', [], 'Signed batch start response count mismatch'],
        ['an empty slot for a file', [null], 'Missing batch signed upload metadata'],
        ['a session without an id', [{ uploadMode: 'single' }], 'Signed batch response missing sessionId'],
    ])('rejects the upload when the backend answers with %s', async (_name, body, message) => {
        signedBackend();
        routes['/fs/startBatchWrite'] = () => ({ body });
        routes['/batch'] = () => ({ body: { results: [{ uid: 'legacy' }] } });
        const onError = vi.fn();
        const failure = await rejectionOf(uploadTo(fileOf('hello', 'notes.txt'), { error: onError }));
        expect(failure.message).toBe(message);
        expect(onError).toHaveBeenCalledWith(failure);
        // A malformed answer is an error, not a backend without signed writes.
        expect(sent('/batch')).toEqual([]);
    });

    it('passes a thumbnail that is already a URL through to completion', async () => {
        signedBackend();
        await uploadTo(fileOf('hello', 'notes.txt'), { thumbnail: 'https://cdn.example.com/thumb.png' });
        expect(jsonSent('/fs/startBatchWrite')[0][0]).not.toHaveProperty('thumbnailMetadata');
        expect(jsonSent('/fs/completeBatchWrite')[0][0]).toMatchObject({
            uploadId: 'session-0',
            thumbnailData: 'https://cdn.example.com/thumb.png',
        });
    });
});

describe('signed upload completion', () => {
    const twoFiles = () => [fileOf('a', 'a.txt'), fileOf('bb', 'b.txt')];

    it.each([
        ['an error', () => ({ status: 500, body: { message: 'batch completion failed' } })],
        ['something other than a list', () => ({ body: { ok: true } })],
        ['fewer entries than files', () => ({ body: [] })],
    ])('completes each file on its own when the batch completion answers with %s', async (_name, completeBatch) => {
        signedBackend();
        routes['/fs/completeBatchWrite'] = completeBatch;
        routes['/fs/completeWrite'] = ({ raw }) => ({ body: { uid: `single-${JSON.parse(raw.toString()).uploadId}` } });

        expect(await uploadTo(twoFiles())).toEqual([{ uid: 'single-session-0' }, { uid: 'single-session-1' }]);
        expect(jsonSent('/fs/completeWrite').map(item => item.uploadId).sort()).toEqual(['session-0', 'session-1']);
        expect(sent('/fs/abortWrite')).toEqual([]);
    });

    it('reports the files that still fail to complete, and aborts only those', async () => {
        signedBackend();
        routes['/fs/completeBatchWrite'] = () => ({ status: 500, body: { message: 'batch completion failed' } });
        routes['/fs/completeWrite'] = ({ raw }) => (JSON.parse(raw.toString()).uploadId === 'session-0'
            ? { body: { fsEntry: { uid: 'entry-a' } } }
            : { status: 409, body: { code: 'item_with_same_name_exists', message: 'b.txt already exists' } });
        const onError = vi.fn();
        const failure = await rejectionOf(uploadTo(twoFiles(), { error: onError }));

        expect(failure).toMatchObject({
            partial: true,
            code: 'item_with_same_name_exists',
            status: 409,
            completedItemCount: 1,
            totalItemCount: 2,
            failedPaths: ['/alice/docs/b.txt'],
            failedItems: [{
                requestIndex: 1,
                stage: 'complete',
                uploadId: 'session-1',
                name: 'b.txt',
                message: 'b.txt already exists',
                code: 'item_with_same_name_exists',
                status: 409,
            }],
        });
        expect(onError).toHaveBeenCalledWith(failure);
        expect(jsonSent('/fs/abortWrite')).toEqual([{ uploadId: 'session-1' }]);
    });
});

describe('cancelling a signed upload', () => {
    it('stops before the files not yet started and aborts every session', async () => {
        signedBackend();
        // More files than upload at once; the first group never finishes.
        const files = Array.from({ length: 9 }, (_unused, index) => fileOf(`content-${index}`, `file-${index}.txt`));
        routes['/fs/startBatchWrite'] = ({ raw }) => ({
            body: JSON.parse(raw.toString()).map((_item, index) => {
                routes[`/store/${index}`] = () => HANG;
                return { sessionId: `session-${index}`, uploadMode: 'single', url: `${origin}/store/${index}` };
            }),
        });
        const onAbort = vi.fn();
        const uploading = uploadTo(files, { abort: onAbort });
        const stored = () => requests.filter(request => request.url.startsWith('/store/'));
        await until(() => stored().length === 8);

        requestHandle.abort();
        expect(await rejectionOf(uploading)).toMatchObject({ aborted: true, message: 'Signed upload aborted' });
        // The caller hears of the abort once every session has been released.
        await until(() => onAbort.mock.calls.length === 1);
        expect(jsonSent('/fs/abortWrite').map(item => item.uploadId).sort())
            .toEqual(files.map((_file, index) => `session-${index}`));
        expect(onAbort).toHaveBeenCalledWith(operationId);
        expect(stored()).toHaveLength(8);
        expect(sent('/fs/completeBatchWrite')).toEqual([]);
    });
});

describe('a backend without signed writes', () => {
    it('falls back to the legacy upload, and stops asking for signed writes', async () => {
        routes['/batch'] = () => ({ body: { results: [{ uid: 'legacy-file' }] } });
        const onStart = vi.fn();
        expect(await uploadTo(fileOf('hello', 'notes.txt'), { start: onStart })).toEqual({ uid: 'legacy-file' });
        expect(await uploadTo(fileOf('again', 'more.txt'))).toEqual({ uid: 'legacy-file' });

        expect(sent('/fs/startBatchWrite')).toHaveLength(1);
        expect(sent('/batch')).toHaveLength(2);
        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('falls back when the start endpoint answers with something other than a list', async () => {
        routes['/fs/startBatchWrite'] = () => ({ body: { ok: true } });
        routes['/batch'] = () => ({ body: { results: [{ uid: 'legacy-file' }] } });
        expect(await uploadTo(fileOf('hello', 'notes.txt'))).toEqual({ uid: 'legacy-file' });
        expect(fs.signedBatchWriteSupported).toBe(false);
    });
});

describe('legacy upload', () => {
    beforeEach(() => {
        fs.signedBatchWriteSupported = false;
    });

    it('sends the file and its write operation in one request', async () => {
        routes['/batch'] = () => ({ body: { results: [{ uid: 'notes' }] } });
        const onStart = vi.fn();
        const onSuccess = vi.fn();
        const result = await uploadTo(fileOf('hello', 'notes.txt'), { start: onStart, success: onSuccess, appUID: 'app-1' });

        expect(result).toEqual({ uid: 'notes' });
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledWith({ uid: 'notes' });
        expect(sent('/batch')[0].headers.authorization).toBe('Bearer test-token');
        const form = await formSent('/batch');
        expect(form.get('operation_id')).toBe(operationId);
        expect(form.has('socket_id')).toBe(false);
        expect(JSON.parse(form.get('fileinfo'))).toEqual({ name: 'notes.txt', type: 'text/plain', size: 5 });
        expect(operationsIn(form)).toEqual([{
            op: 'write',
            dedupe_name: true,
            overwrite: false,
            operation_id: operationId,
            path: '/alice/docs',
            name: 'notes.txt',
            item_upload_id: 0,
            app_uid: 'app-1',
        }]);
        expect(await form.get('file').text()).toBe('hello');
    });

    it('resolves a list when the request wrote several items', async () => {
        routes['/batch'] = () => ({ body: { results: [{ uid: 'a' }, { uid: 'b' }] } });
        expect(await uploadTo([fileOf('a', 'a.txt'), fileOf('bb', 'b.txt')])).toEqual([{ uid: 'a' }, { uid: 'b' }]);
    });

    it('creates folders parent first and writes files into the folder created for them', async () => {
        routes['/batch'] = () => ({ body: { results: [{ uid: 'photos' }, { uid: '2024' }, { uid: 'a' }] } });
        const entries = [
            { isDirectory: true, fullPath: '/photos' },
            { isDirectory: true, fullPath: '/photos/2024' },
            Object.assign(fileOf('x', 'a.txt'), { filepath: 'photos/2024/a.txt' }),
        ];
        await uploadTo(entries, { parsedDataTransferItems: true });

        expect(operationsIn(await formSent('/batch'))).toMatchObject([
            { op: 'mkdir', parent: '/alice/docs', path: '/photos', as: 'dir_1', create_missing_ancestors: true },
            { op: 'mkdir', parent: '$dir_1', path: '/2024', as: 'dir_0' },
            { op: 'write', path: '$dir_0', name: 'a.txt' },
        ]);
    });

    it('sends a thumbnail with the file it belongs to', async () => {
        routes['/batch'] = () => ({ body: { results: [{ uid: 'notes' }] } });
        const thumbnail = 'data:image/png;base64,AAAA';
        await uploadTo(fileOf('hello', 'notes.txt'), { thumbnail });
        const form = await formSent('/batch');
        expect(JSON.parse(form.get('fileinfo')).thumbnail).toBe(thumbnail);
        expect(operationsIn(form)[0].thumbnail).toBe(thumbnail);
    });

    it('creates a shortcut without sending the file', async () => {
        routes['/batch'] = () => ({ body: { results: [{ uid: 'shortcut' }] } });
        await uploadTo(fileOf('hello', 'notes.txt'), { shortcutTo: 'target-uid' });
        const form = await formSent('/batch');
        expect(operationsIn(form)).toMatchObject([{
            op: 'shortcut',
            name: 'notes.txt',
            shortcut_to: 'target-uid',
            shortcut_to_uid: 'target-uid',
        }]);
        expect(form.has('fileinfo')).toBe(false);
        expect(form.has('file')).toBe(false);
    });

    it('reports progress as the server relays the bytes to storage', async () => {
        let release;
        routes['/batch'] = async () => {
            await new Promise((resolve) => {
                release = resolve;
            });
            return { body: { results: [{ uid: 'notes' }] } };
        };
        const listeners = {};
        fs.socket = {
            id: 'socket-1',
            on: (name, handler) => {
                listeners[name] = handler;
            },
            off: vi.fn(),
        };
        const progress = vi.fn();
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const uploading = uploadTo(fileOf('hello', 'notes.txt'), { progress });
        await until(() => sent('/batch').length === 1);

        // Half of the work is the server's own relay of the 5 bytes.
        listeners['upload.progress']({ operation_id: 'another-upload', loaded_diff: 5 });
        listeners['upload.progress']({ operation_id: operationId, loaded_diff: 5 });
        vi.advanceTimersByTime(100);
        expect(progress).toHaveBeenLastCalledWith(operationId, '50.00');

        release();
        await uploading;
        expect(fs.socket.off).toHaveBeenCalledWith('upload.progress', listeners['upload.progress']);
        const form = await formSent('/batch');
        expect([form.get('socket_id'), form.get('original_client_socket_id')]).toEqual(['socket-1', 'socket-1']);
        progress.mockClear();
        vi.advanceTimersByTime(1000);
        expect(progress).not.toHaveBeenCalled();
    });

    it('rejects with the server\'s own body when the request is refused', async () => {
        routes['/batch'] = () => ({ status: 403, body: { code: 'forbidden', message: 'Not allowed here' } });
        expect(await rejectionOf(uploadTo(fileOf('hello', 'notes.txt'))))
            .toEqual({ code: 'forbidden', message: 'Not allowed here' });
    });

    it('summarizes a batch in which some operations failed', async () => {
        const failed = { error: true, status: 409, code: 'item_with_same_name_exists', message: 'b.txt already exists' };
        routes['/batch'] = () => ({ status: 218, body: { results: [{ uid: 'a' }, failed] } });
        expect(await rejectionOf(uploadTo([fileOf('a', 'a.txt'), fileOf('bb', 'b.txt')]))).toEqual({
            message: 'Upload partially failed: 1 of 2 operations failed (b.txt already exists)',
            code: 'batch_upload_partially_failed',
            status: 218,
            results: [{ uid: 'a' }, failed],
            failedItems: [failed],
            failedCount: 1,
            totalCount: 2,
        });
    });

    it('reports a failed batch even when no operation is marked as failed', async () => {
        routes['/batch'] = () => ({ status: 218, body: { results: [{ uid: 'a' }] } });
        expect(await rejectionOf(uploadTo(fileOf('a', 'a.txt')))).toMatchObject({
            message: 'Upload partially failed: the server reported a failed operation.',
            code: 'batch_upload_partially_failed',
            failedCount: 0,
            totalCount: 1,
        });
    });

    it('rejects with the failed operation itself in strict mode', async () => {
        const failed = { error: true, status: 409, code: 'item_with_same_name_exists', message: 'notes.txt already exists' };
        routes['/batch'] = () => ({ status: 218, body: { results: [failed] } });
        expect(await rejectionOf(uploadTo(fileOf('hello', 'notes.txt'), { strict: true }))).toEqual(failed);

        // With nothing marked as failed, the first operation stands in for it.
        routes['/batch'] = () => ({ status: 218, body: { results: [{ uid: 'a' }] } });
        expect(await rejectionOf(uploadTo(fileOf('hello', 'notes.txt'), { strict: true }))).toEqual({ uid: 'a' });
    });

    it('rejects when the server reports no results at all', async () => {
        routes['/batch'] = () => ({ body: { results: [] } });
        expect(await rejectionOf(uploadTo(fileOf('hello', 'notes.txt')))).toMatchObject({
            code: 'batch_upload_no_results',
            status: 200,
            totalCount: 0,
        });
    });

    it('tells the caller when the upload is cancelled', async () => {
        routes['/batch'] = () => HANG;
        fs.socket = { id: 'socket-1', on: vi.fn(), off: vi.fn() };
        const onAbort = vi.fn();
        const uploading = uploadTo(fileOf('hello', 'notes.txt'), { abort: onAbort });
        await until(() => sent('/batch').length === 1);

        requestHandle.abort();
        await rejectionOf(uploading);
        expect(onAbort).toHaveBeenCalledWith(operationId);
        expect(fs.socket.off).toHaveBeenCalledWith('upload.progress', fs.socket.on.mock.calls[0][1]);
    });
});

describe('toSignedRequestPath', () => {
    it('names where a batch item was going', () => {
        expect(toSignedRequestPath('/alice/docs', { type: 'directory', directoryPath: '/alice/docs/photos' }))
            .toBe('/alice/docs/photos');
        expect(toSignedRequestPath('/alice/docs', { type: 'file', file: { puter_full_path: '/alice/other/a.txt' } }))
            .toBe('/alice/other/a.txt');
        expect(toSignedRequestPath('/alice/docs', { type: 'file', file: { filepath: 'photos/a.txt', name: 'a.txt' } }))
            .toBe('/alice/docs/photos/a.txt');
        expect(toSignedRequestPath('/alice/docs', { type: 'file', file: { name: 'a.txt' } })).toBe('/alice/docs/a.txt');
    });

    it('has no path for something that is not a batch item', () => {
        expect(toSignedRequestPath('/alice/docs', null)).toBeUndefined();
        expect(toSignedRequestPath('/alice/docs', 'a.txt')).toBeUndefined();
        expect(toSignedRequestPath('/alice/docs', { type: 'file' })).toBeUndefined();
        expect(toSignedRequestPath('/alice/docs', { type: 'symlink', file: { name: 'a.txt' } })).toBeUndefined();
    });
});

describe('postJson', () => {
    const post = payload => postJson(origin, 'test-token', '/fs/endpoint', payload);
    const failureOf = async (reply) => {
        routes['/fs/endpoint'] = () => reply;
        try {
            await post({});
        } catch (e) {
            return e;
        }
        throw new Error('the request succeeded');
    };

    it('posts JSON with the bearer token and returns the parsed body', async () => {
        routes['/fs/endpoint'] = () => ({ body: { uid: 'entry' } });
        expect(await post({ uploadId: 'session-0' })).toEqual({ uid: 'entry' });
        const [request] = sent('/fs/endpoint');
        expect(request.method).toBe('POST');
        expect(request.headers.authorization).toBe('Bearer test-token');
        expect(request.headers['content-type']).toBe('application/json');
        expect(JSON.parse(request.raw.toString())).toEqual({ uploadId: 'session-0' });
    });

    it('returns null for an empty body and the text of a body that is not JSON', async () => {
        routes['/fs/endpoint'] = () => ({ text: '' });
        expect(await post({})).toBeNull();
        routes['/fs/endpoint'] = () => ({ text: 'accepted' });
        expect(await post({})).toBe('accepted');
    });

    it.each([
        ['message', { message: 'No such session', code: 'upload_not_found' }, 'No such session', 'upload_not_found'],
        ['error string', { error: 'Session expired', errorCode: 'upload_expired' }, 'Session expired', 'upload_expired'],
        ['nested error', { error: { message: 'Quota check failed' } }, 'Quota check failed', undefined],
        ['bare object', {}, 'Failed request to /fs/endpoint', undefined],
    ])('throws the %s of a failed request, with its status, body and code', async (_name, body, message, code) => {
        const failure = await failureOf({ status: 500, body });
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toBe(message);
        expect(failure.status).toBe(500);
        expect(failure.body).toEqual(body);
        expect(failure.code).toBe(code);
    });

    it('throws the text of a failed request that is not JSON', async () => {
        const failure = await failureOf({ status: 500, text: 'upstream timed out' });
        expect(failure).toMatchObject({ message: 'upstream timed out', status: 500, body: 'upstream timed out' });
    });
});

describe('toErrorMessage', () => {
    it('finds the most specific message an error carries', () => {
        expect(toErrorMessage(new Error('Disk full'))).toBe('Disk full');
        expect(toErrorMessage({ body: 'plain text body' })).toBe('plain text body');
        expect(toErrorMessage({ message: '', body: { message: 'From the body' } })).toBe('From the body');
        expect(toErrorMessage({ body: { error: { message: 'Nested in the body' } } })).toBe('Nested in the body');
        expect(toErrorMessage('just a string')).toBe('just a string');
        expect(toErrorMessage({ body: { error: 'no message here' } })).toBe('[object Object]');
        expect(toErrorMessage(undefined)).toBe('undefined');
    });
});

describe('uploadBlobToSignedUrl', () => {
    const put = (extra = {}) => uploadBlobToSignedUrl({ url: `${origin}/store/blob`, blob: new Blob(['hello']), ...extra });
    const failureOf = async (uploading) => {
        try {
            await uploading;
        } catch (e) {
            return e;
        }
        throw new Error('the upload succeeded');
    };

    it('puts the bytes, reports them as progress, and returns the ETag', async () => {
        routes['/store/blob'] = () => ({ headers: { ETag: '"etag-blob"' } });
        const onProgress = vi.fn();
        const created = [];
        const completed = [];
        const result = await put({
            contentType: 'text/plain',
            onProgress,
            onRequestCreated: request => created.push(request),
            onRequestCompleted: request => completed.push(request),
        });

        expect(result).toEqual({ etag: '"etag-blob"' });
        const [request] = sent('/store/blob');
        expect([request.method, request.headers['content-type'], request.raw.toString()])
            .toEqual(['PUT', 'text/plain', 'hello']);
        expect(onProgress.mock.calls.reduce((total, [delta]) => total + delta, 0)).toBe(5);
        expect(created).toHaveLength(1);
        expect(completed).toEqual(created);
    });

    it('resolves without an ETag when storage sends none', async () => {
        routes['/store/blob'] = () => ({});
        expect(await put()).toEqual({ etag: null });
    });

    it('rejects with the status storage refused the upload with', async () => {
        routes['/store/blob'] = () => ({ status: 403 });
        const completed = vi.fn();
        const failure = await failureOf(put({ onRequestCompleted: completed }));
        expect(failure).toMatchObject({ message: 'Signed upload failed with status 403', status: 403 });
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it('rejects when the connection drops', async () => {
        routes['/store/blob'] = () => DISCONNECT;
        const completed = vi.fn();
        const failure = await failureOf(put({ onRequestCompleted: completed }));
        expect(failure.message).toBe('Network error during signed upload');
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it('rejects as aborted when the request is cancelled', async () => {
        routes['/store/blob'] = () => HANG;
        const completed = vi.fn();
        let request;
        const uploading = put({
            onRequestCreated: (created) => {
                request = created;
            },
            onRequestCompleted: completed,
        });
        await until(() => sent('/store/blob').length === 1);
        request.abort();
        expect(await failureOf(uploading)).toMatchObject({ message: 'Signed upload aborted', aborted: true });
        expect(completed).toHaveBeenCalledTimes(1);
    });

    it('rejects when storage does not answer within the timeout', async () => {
        routes['/store/blob'] = () => HANG;
        const completed = vi.fn();
        const failure = await failureOf(put({ timeoutMs: 5, onRequestCompleted: completed }));
        expect(failure.message).toBe('Signed upload timed out');
        expect(completed).toHaveBeenCalledTimes(1);
    });
});
