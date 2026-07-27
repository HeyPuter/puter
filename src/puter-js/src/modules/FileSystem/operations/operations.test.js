import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import copy from './copy.js';
import deleteFSEntry from './deleteFSEntry.js';
import getReadURL from './getReadUrl.js';
import mkdir from './mkdir.js';
import move from './move.js';
import read from './read.js';
import readdir from './readdir.js';
import readdirSubdomains from './readdirSubdomains.js';
import rename from './rename.js';
import revokeReadURL from './revokeReadUrl.js';
import sign from './sign.js';
import space from './space.js';
import stat from './stat.js';
import write from './write.js';

/**
 * Pins the request every `puter.fs.*` call style produces, by faking the
 * network boundary (XMLHttpRequest). Every documented and legacy argument
 * shape is covered so the operations can be restructured without changing
 * what apps observe on the wire.
 */

class FakeXHR {
    // Set per test: (parsedRequestBody, xhr) => response object, or a Blob.
    static respondWith = null;
    static status = 200;
    static requests = [];

    _listeners = {};
    responseType = '';

    open (method, url) {
        this.method = method;
        this.url = url;
    }

    setRequestHeader (name, value) {
        (this.requestHeaders ??= {})[name] = value;
    }

    addEventListener (type, fn) {
        (this._listeners[type] ??= []).push(fn);
    }

    getResponseHeader (name) {
        if ( name === 'content-type' ) {
            return this.responseType === 'blob' ? 'application/octet-stream' : 'application/json';
        }
        return null;
    }

    send (body) {
        FakeXHR.requests.push(this);
        this.requestBody = body ?? null;
        this.status = FakeXHR.status;
        const payload = FakeXHR.respondWith
            ? FakeXHR.respondWith(body ? JSON.parse(body) : null, this)
            : { success: true };
        queueMicrotask(() => {
            if ( this.responseType === 'blob' ) {
                this.response = payload;
            } else {
                this.responseText = JSON.stringify(payload);
            }
            for ( const fn of this._listeners.load ?? [] ) {
                fn.call(this, { target: this });
            }
        });
    }
}

const lastRequest = () => FakeXHR.requests.at(-1);
const lastBody = () => JSON.parse(lastRequest().requestBody);

// A stand-in for the FileSystem module: the operations only ever reach for
// the API origin, the auth token and the socket id.
const makeFS = () => ({
    APIOrigin: 'https://api.test',
    authToken: 'test-token',
    socket: { id: 'socket-1' },
    // write delegates to upload, which has its own tests.
    upload: vi.fn(async () => ({ uid: 'written' })),
    copy, delete: deleteFSEntry, getReadURL, mkdir, move, read, readdir,
    readdirSubdomains, rename, revokeReadURL, sign, space, stat, write,
});

const makeCache = () => {
    const store = new Map();
    return {
        get: vi.fn(async key => store.get(key)),
        set: vi.fn((key, value) => store.set(key, value)),
        del: vi.fn(key => store.delete(key)),
        flushall: vi.fn(() => store.clear()),
    };
};

const origXHR = globalThis.XMLHttpRequest;
const origPuter = globalThis.puter;

let fs;

beforeEach(() => {
    FakeXHR.requests = [];
    FakeXHR.respondWith = null;
    FakeXHR.status = 200;
    globalThis.XMLHttpRequest = FakeXHR;
    fs = makeFS();
    globalThis.puter = {
        authToken: 'test-token',
        APIOrigin: 'https://api.test',
        env: 'nodejs',
        appID: undefined,
        _cache: makeCache(),
        fs,
    };
});

afterEach(() => {
    globalThis.XMLHttpRequest = origXHR;
    globalThis.puter = origPuter;
});

describe('copy', () => {
    it('copy(source, destination) sends both paths', async () => {
        await fs.copy('/a/file.txt', '/b');
        expect(lastRequest().url).toBe('https://api.test/copy');
        expect(lastBody()).toMatchObject({
            source: '/a/file.txt',
            destination: '/b',
            original_client_socket_id: 'socket-1',
            socket_id: 'socket-1',
        });
    });

    it('copy(source, destination, options) applies the options', async () => {
        await fs.copy('/a/file.txt', '/b', { overwrite: true, newName: 'other.txt', dedupeName: true });
        expect(lastBody()).toMatchObject({
            overwrite: true,
            new_name: 'other.txt',
            dedupe_name: true,
        });
    });

    it('copy(options) is equivalent to the positional form', async () => {
        await fs.copy({ source: '/a/file.txt', destination: '/b', newName: 'other.txt' });
        expect(lastBody()).toMatchObject({
            source: '/a/file.txt',
            destination: '/b',
            new_name: 'other.txt',
        });
    });

    it('accepts the legacy snake_case option names', async () => {
        await fs.copy('/a/file.txt', '/b', { new_name: 'other.txt', dedupe_name: true });
        expect(lastBody()).toMatchObject({ new_name: 'other.txt', dedupe_name: true });
    });

    it('does not mutate the caller options object', async () => {
        const options = { source: 'file.txt', destination: 'dir' };
        await fs.copy(options);
        expect(options).toEqual({ source: 'file.txt', destination: 'dir' });
    });

    it('calls the trailing success callback with the response', async () => {
        FakeXHR.respondWith = () => ({ uid: 'copied' });
        const success = vi.fn();
        await fs.copy('/a/file.txt', '/b', undefined, success);
        expect(success).toHaveBeenCalledWith({ uid: 'copied' });
    });
});

describe('move', () => {
    it('moves into the destination when it is a directory', async () => {
        FakeXHR.respondWith = body => (body.path === '/b' ? { is_dir: true } : { success: true });
        await fs.move('/a/file.txt', '/b');
        expect(lastBody()).toMatchObject({ source: '/a/file.txt', destination: '/b' });
        expect(lastBody().new_name).toBeUndefined();
    });

    it('treats a non-directory destination as the new path', async () => {
        FakeXHR.respondWith = (body, xhr) => {
            if ( xhr.url.endsWith('/stat') ) return { is_dir: false };
            return { success: true };
        };
        await fs.move('/a/file.txt', '/b/renamed.txt');
        expect(lastBody()).toMatchObject({
            destination: '/b',
            new_name: 'renamed.txt',
        });
    });

    it('skips the destination lookup when newName is given', async () => {
        await fs.move('/a/file.txt', '/b', { newName: 'other.txt', createMissingParents: true });
        expect(FakeXHR.requests).toHaveLength(1);
        expect(lastBody()).toMatchObject({
            destination: '/b',
            new_name: 'other.txt',
            create_missing_parents: true,
        });
    });
});

describe('mkdir', () => {
    it('splits the path into parent and name', async () => {
        await fs.mkdir('/a/b/c');
        expect(lastRequest().url).toBe('https://api.test/mkdir');
        expect(lastBody()).toMatchObject({
            parent: '/a/b',
            path: 'c',
            overwrite: false,
            dedupe_name: false,
            create_missing_parents: false,
            original_client_socket_id: 'socket-1',
        });
    });

    it('mkdir(path, options) applies the options', async () => {
        await fs.mkdir('/a/b', { dedupeName: true, createMissingParents: true });
        expect(lastBody()).toMatchObject({ dedupe_name: true, create_missing_parents: true });
    });

    it('accepts the `rename` and `recursive` aliases', async () => {
        await fs.mkdir('/a/b', { rename: true, recursive: true });
        expect(lastBody()).toMatchObject({ dedupe_name: true, create_missing_parents: true });
    });

    it('mkdir(path, success) still takes a bare callback', async () => {
        const success = vi.fn();
        await fs.mkdir('/a/b', success);
        expect(success).toHaveBeenCalledTimes(1);
        expect(lastBody()).toMatchObject({ parent: '/a', path: 'b' });
    });
});

describe('delete', () => {
    it('wraps a single path in an array', async () => {
        await fs.delete('/a/file.txt');
        expect(lastRequest().url).toBe('https://api.test/delete');
        expect(lastBody()).toEqual({
            paths: ['/a/file.txt'],
            descendants_only: false,
            recursive: true,
        });
    });

    it('accepts an array of paths', async () => {
        await fs.delete(['/a/one.txt', '/a/two.txt']);
        expect(lastBody().paths).toEqual(['/a/one.txt', '/a/two.txt']);
    });

    it('delete(paths, options) applies the options', async () => {
        await fs.delete('/a/dir', { recursive: false, descendantsOnly: true });
        expect(lastBody()).toMatchObject({ recursive: false, descendants_only: true });
    });

    it('delete(options) is equivalent to the positional form', async () => {
        await fs.delete({ paths: '/a/dir', recursive: false });
        expect(lastBody()).toMatchObject({ paths: ['/a/dir'], recursive: false });
    });
});

describe('read', () => {
    beforeEach(() => {
        FakeXHR.respondWith = () => new Blob(['contents']);
    });

    it('requests the file as a blob and defeats the HTTP cache', async () => {
        const blob = await fs.read('/a/file.txt');
        expect(await blob.text()).toBe('contents');
        expect(lastRequest().url).toBe('https://api.test/read?file=%2Fa%2Ffile.txt');
        expect(lastRequest().method).toBe('get');
        expect(lastRequest().requestHeaders['Cache-Control']).toBe('no-cache');
    });

    it('read(path, options) forwards the byte range', async () => {
        await fs.read('/a/file.txt', { offset: 4, byte_count: 8 });
        expect(lastRequest().url).toBe('https://api.test/read?file=%2Fa%2Ffile.txt&offset=4&byte_count=8');
    });

    it('opts back into HTTP caching with { cache: true }', async () => {
        await fs.read('/a/file.txt', { cache: true });
        expect(lastRequest().requestHeaders?.['Cache-Control']).toBeUndefined();
    });

    it('read(path, success) still takes a bare callback', async () => {
        const success = vi.fn();
        await fs.read('/a/file.txt', success);
        expect(success).toHaveBeenCalledTimes(1);
    });
});

describe('rename', () => {
    it('rename(path, newName) addresses the item by path', async () => {
        await fs.rename('/a/file.txt', 'renamed.txt');
        expect(lastRequest().url).toBe('https://api.test/rename');
        expect(lastBody()).toMatchObject({ path: '/a/file.txt', new_name: 'renamed.txt' });
    });

    it('rename({ uid, newName }) addresses the item by uid', async () => {
        await fs.rename({ uid: 'abc', newName: 'renamed.txt' });
        expect(lastBody()).toMatchObject({ uid: 'abc', new_name: 'renamed.txt' });
        expect(lastBody().path).toBeUndefined();
    });
});

describe('space', () => {
    it('reads storage usage', async () => {
        FakeXHR.respondWith = () => ({ capacity: 10, used: 4 });
        await expect(fs.space()).resolves.toEqual({ capacity: 10, used: 4 });
        expect(lastRequest().url).toBe('https://api.test/df');
        expect(lastRequest().requestBody).toBeNull();
    });

    it('space(success) still takes a bare callback', async () => {
        const success = vi.fn();
        await fs.space(success);
        expect(success).toHaveBeenCalledTimes(1);
    });
});

describe('sign', () => {
    beforeEach(() => {
        FakeXHR.respondWith = body => ({
            token: 'tok',
            signatures: body.items.map((item, index) => ({ uid: item.uid, index })),
        });
    });

    it('returns a single object when one item is signed', async () => {
        const result = await fs.sign('app-1', { uid: 'one' });
        expect(lastBody()).toEqual({ app_uid: 'app-1', items: [{ uid: 'one' }] });
        expect(result).toEqual({ token: 'tok', items: { uid: 'one', index: 0 } });
    });

    it('returns an array when several items are signed', async () => {
        const result = await fs.sign('app-1', [{ uid: 'one' }, { uid: 'two' }]);
        expect(result.items).toEqual([
            { uid: 'one', index: 0 },
            { uid: 'two', index: 1 },
        ]);
    });

    it('passes the signed result to the success callback', async () => {
        const success = vi.fn();
        await fs.sign('app-1', { uid: 'one' }, success);
        expect(success).toHaveBeenCalledWith({ token: 'tok', items: { uid: 'one', index: 0 } });
    });
});

describe('stat', () => {
    it('sends the path and the token in the payload', async () => {
        FakeXHR.respondWith = () => ({ uid: 'u1', is_dir: false });
        await fs.stat('/a/file.txt');
        expect(lastRequest().url).toBe('https://api.test/stat');
        expect(lastBody()).toMatchObject({ path: '/a/file.txt', auth_token: 'test-token' });
    });

    it('stat(path, options) forwards the return_* flags', async () => {
        await fs.stat('/a/file.txt', { returnSize: true, returnPermissions: true });
        expect(lastBody()).toMatchObject({ return_size: true, return_permissions: true });
    });

    it('stat(path, options, success) still takes trailing callbacks', async () => {
        const success = vi.fn();
        await fs.stat('/a/file.txt', { returnSize: true }, success);
        expect(success).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent identical requests into one call', async () => {
        const [ first, second ] = await Promise.all([
            fs.stat('/a/file.txt'),
            fs.stat('/a/file.txt'),
        ]);
        expect(FakeXHR.requests).toHaveLength(1);
        expect(first).toEqual(second);
    });

    it('serves an eventually-consistent read from the cache', async () => {
        await fs.stat('/a/file.txt');
        FakeXHR.requests = [];
        await fs.stat({ path: '/a/file.txt', consistency: 'eventual' });
        expect(FakeXHR.requests).toHaveLength(0);
    });
});

describe('readdir', () => {
    beforeEach(() => {
        FakeXHR.respondWith = () => [{ uuid: 'u1', name: 'file.txt', path: '/a/file.txt', isDir: false }];
    });

    it('lists a directory and normalizes entries to the v1 shape', async () => {
        const entries = await fs.readdir('/a');
        expect(lastRequest().url).toBe('https://api.test/fs/readdir');
        expect(lastBody()).toMatchObject({ path: '/a', auth_token: 'test-token' });
        expect(entries[0]).toMatchObject({ name: 'file.txt', is_dir: false, uid: 'u1' });
    });

    it('readdir(path, options) applies the options', async () => {
        await fs.readdir('/a', { limit: 5, sortBy: 'modified', sortOrder: 'desc' });
        expect(lastBody()).toMatchObject({ limit: 5, sortBy: 'modified', sortOrder: 'desc' });
    });

    it('readdir(path, options) honours an eventually-consistent read', async () => {
        await fs.readdir('/a');
        FakeXHR.requests = [];
        await fs.readdir('/a', { consistency: 'eventual' });
        expect(FakeXHR.requests).toHaveLength(0);
    });

    it('readdir(path, success) still takes a bare callback', async () => {
        const success = vi.fn();
        await fs.readdir('/a', success);
        expect(success).toHaveBeenCalledTimes(1);
    });

    it('rejects instead of hanging when neither path nor uid is given', async () => {
        await expect(fs.readdir({})).rejects.toMatchObject({ code: 'NO_PATH_OR_UID' });
        expect(FakeXHR.requests).toHaveLength(0);
    });
});

describe('getReadURL / revokeReadURL', () => {
    it('builds a token URL for a file', async () => {
        FakeXHR.respondWith = (body, xhr) =>
            (xhr.url.endsWith('/stat') ? { uid: 'u1', is_dir: false } : { token: 'tok' });
        const url = await fs.getReadURL('/a/file.txt', '1h');
        expect(lastBody()).toEqual({ expiresIn: '1h', permissions: ['fs:u1:read'] });
        expect(url).toBe('https://api.test/token-read?uid=u1&token=tok');
    });

    it('defaults the expiry to 24h', async () => {
        FakeXHR.respondWith = (body, xhr) =>
            (xhr.url.endsWith('/stat') ? { uid: 'u1', is_dir: false } : { token: 'tok' });
        await fs.getReadURL('/a/file.txt');
        expect(lastBody().expiresIn).toBe('24h');
    });

    it('refuses to sign a directory', async () => {
        FakeXHR.respondWith = () => ({ uid: 'u1', is_dir: true });
        await expect(fs.getReadURL('/a')).rejects.toBe('Cannot create readUrl for directory');
        expect(FakeXHR.requests).toHaveLength(1);
    });

    it('revokes by URL, token or uuid', async () => {
        await expect(fs.revokeReadURL('  tok  ')).resolves.toBeUndefined();
        expect(lastRequest().url).toBe('https://api.test/auth/revoke-access-token');
        expect(lastBody()).toEqual({ tokenOrUuid: 'tok' });
    });
});

describe('write', () => {
    it('turns a string into a File under the target name', async () => {
        await fs.write('/a/notes.txt', 'hello');
        const [ file, parent, options ] = fs.upload.mock.calls[0];
        expect(file).toBeInstanceOf(File);
        expect(file.name).toBe('notes.txt');
        expect(await file.text()).toBe('hello');
        expect(parent).toBe('/a');
        expect(options).toMatchObject({ overwrite: true, dedupeName: false, strict: true });
    });

    it('names the file after itself, in the app root, when only a File is given', async () => {
        await fs.write(new File(['x'], 'photo.png'));
        const [ file, parent ] = fs.upload.mock.calls[0];
        expect(file.name).toBe('photo.png');
        expect(parent).toBe('~');
    });

    it('creates an empty file when no data is given', async () => {
        await fs.write('/a/empty.txt');
        const [ file ] = fs.upload.mock.calls[0];
        expect(await file.text()).toBe('');
    });

    it('leaves dedupeName unset when the caller opts out of overwriting', async () => {
        await fs.write('/a/notes.txt', 'hello', { overwrite: false });
        expect(fs.upload.mock.calls[0][2]).toMatchObject({ overwrite: false, dedupeName: undefined });
    });

    // These used to be built with `new Error(...)` around the object, which
    // reduced every one of them to the message "[object Object]".
    it('reports a readable message when no target path is given', async () => {
        await expect(fs.write()).rejects.toMatchObject({
            code: 'NO_TARGET_PATH',
            message: 'No target path provided.',
        });
        expect(fs.upload).not.toHaveBeenCalled();
    });

    it('reports a readable message when the data is an unsupported type', async () => {
        await expect(fs.write('/a/notes.txt', 42)).rejects.toMatchObject({
            code: 'field_invalid',
            message: 'write() data parameter is an invalid type',
        });
        expect(fs.upload).not.toHaveBeenCalled();
    });

    it('reports a readable message when readdir has nothing to address', async () => {
        await expect(fs.readdir({})).rejects.toMatchObject({
            code: 'NO_PATH_OR_UID',
            message: 'Either path or uid must be provided.',
        });
    });
});

describe('authentication gate', () => {
    beforeEach(() => {
        globalThis.puter.authToken = undefined;
        globalThis.puter.env = 'web';
        globalThis.puter.ui = { authenticateWithPuter: vi.fn(async () => { throw new Error('nope'); }) };
    });

    // Each operation used to reject and then fire its request anyway.
    const operations = {
        copy: () => fs.copy('/a', '/b'),
        delete: () => fs.delete('/a'),
        getReadURL: () => fs.getReadURL('/a/file.txt'),
        mkdir: () => fs.mkdir('/a'),
        move: () => fs.move('/a', '/b'),
        read: () => fs.read('/a'),
        readdir: () => fs.readdir('/a'),
        readdirSubdomains: () => fs.readdirSubdomains({ directory_ids: [1] }),
        rename: () => fs.rename('/a', 'b'),
        sign: () => fs.sign('app-1', { uid: 'one' }),
        space: () => fs.space(),
        stat: () => fs.stat('/a'),
        revokeReadURL: () => fs.revokeReadURL('tok'),
    };

    for ( const [ name, call ] of Object.entries(operations) ) {
        it(`${name} rejects without sending a request`, async () => {
            await expect(call()).rejects.toBe('Authentication failed.');
            expect(FakeXHR.requests).toHaveLength(0);
        });
    }

    it('proceeds once authentication succeeds', async () => {
        globalThis.puter.ui.authenticateWithPuter = vi.fn(async () => {
            globalThis.puter.authToken = 'fresh-token';
        });
        await fs.space();
        expect(FakeXHR.requests).toHaveLength(1);
    });
});
