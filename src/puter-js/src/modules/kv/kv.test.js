import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KV } from './index.js';

/**
 * Pins the exact `/drivers/call` wire payload every `puter.kv.*` call style
 * produces, by faking the network boundary (XMLHttpRequest). Every documented
 * and legacy argument shape is covered so the module can be restructured
 * without changing what apps observe on the wire.
 */

class FakeXHR {
    // Set per test: (parsedRequestBody) => driver-layer response object.
    static respondWith = null;
    static requests = [];

    _listeners = {};
    responseType = '';
    status = 200;

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

    getResponseHeader () {
        return null;
    }

    send (body) {
        FakeXHR.requests.push(this);
        this.requestBody = body;
        const respObj = FakeXHR.respondWith
            ? FakeXHR.respondWith(body === null ? null : JSON.parse(body))
            : { success: true, result: true };
        queueMicrotask(() => {
            this.responseText = JSON.stringify(respObj);
            for ( const fn of this._listeners.load ?? [] ) {
                fn.call(this, { target: this });
            }
        });
    }
}

const lastBody = () => JSON.parse(FakeXHR.requests.at(-1).requestBody);

const makeFakePuter = () => ({
    authToken: 'test-token',
    APIOrigin: 'https://api.test',
    appID: 'app-test',
    env: 'nodejs',
});

const origXHR = globalThis.XMLHttpRequest;
const origPuter = globalThis.puter;

let kv;
let fakePuter;
let warnSpy;

beforeEach(() => {
    FakeXHR.requests = [];
    FakeXHR.respondWith = null;
    globalThis.XMLHttpRequest = FakeXHR;
    fakePuter = makeFakePuter();
    globalThis.puter = fakePuter;
    kv = new KV(fakePuter);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    globalThis.XMLHttpRequest = origXHR;
    globalThis.puter = origPuter;
    warnSpy.mockRestore();
});

describe('kv.set driver payloads', () => {
    it('set(key, value) sends a bare set call', async () => {
        await expect(kv.set('k', 'v')).resolves.toBe(true);
        const body = lastBody();
        expect(body.interface).toBe('puter-kvstore');
        expect(body.method).toBe('set');
        expect(body.args).toEqual({ key: 'k', value: 'v' });
        expect(body.auth_token).toBe('test-token');
        expect(FakeXHR.requests.at(-1).url).toBe('https://api.test/drivers/call');
    });

    it('set(key, value, expireAt) includes expireAt', async () => {
        await kv.set('k', 'v', 1234);
        expect(lastBody().args).toEqual({ key: 'k', value: 'v', expireAt: 1234 });
    });

    it('set(key, value, null) sends a null expireAt', async () => {
        await kv.set('k', 'v', null);
        expect(lastBody().args).toEqual({ key: 'k', value: 'v', expireAt: null });
    });

    it('set(key, value, expireAt, optConfig) includes optConfig', async () => {
        await kv.set('k', 'v', 1234, { appUuid: 'u' });
        expect(lastBody().args).toEqual({ key: 'k', value: 'v', expireAt: 1234, optConfig: { appUuid: 'u' } });
    });

    it('set(key, value, optConfig) skips expireAt', async () => {
        await kv.set('k', 'v', { appUuid: 'u' });
        expect(lastBody().args).toEqual({ key: 'k', value: 'v', optConfig: { appUuid: 'u' } });
    });

    it('set({ key, value, expireAt }) object form maps through', async () => {
        await kv.set({ key: 'k', value: 'v', expireAt: 9 });
        const body = lastBody();
        expect(body.method).toBe('set');
        expect(body.args).toEqual({ key: 'k', value: 'v', expireAt: 9 });
    });

    it('set(key, value, callback) consumes trailing callbacks', async () => {
        await kv.set('k', 'v', () => {}, () => {});
        expect(lastBody().args).toEqual({ key: 'k', value: 'v' });
    });

    it('set([items]) becomes a batchPut with normalized items', async () => {
        await kv.set([
            { key: 'a', value: 1 },
            { key: 5, value: 'x', expireAt: 99 },
        ]);
        const body = lastBody();
        expect(body.method).toBe('batchPut');
        expect(body.args).toEqual({
            items: [
                { key: 'a', value: 1 },
                { key: '5', value: 'x', expireAt: 99 },
            ],
        });
    });

    it('set([items], optConfig) includes optConfig', async () => {
        await kv.set([{ key: 'a', value: 1 }], { appUuid: 'u' });
        expect(lastBody().args).toEqual({
            items: [{ key: 'a', value: 1 }],
            optConfig: { appUuid: 'u' },
        });
    });

    it('set({ items }) wrapped batch form becomes a batchPut', async () => {
        await kv.set({ items: [{ key: 'a', value: 1 }] });
        const body = lastBody();
        expect(body.method).toBe('batchPut');
        expect(body.args).toEqual({ items: [{ key: 'a', value: 1 }] });
    });

    it('rejects an undefined key without a request', async () => {
        await expect(kv.set(undefined, 'v')).rejects.toMatchObject({ code: 'key_undefined' });
        expect(FakeXHR.requests).toHaveLength(0);
    });

    it('rejects an oversized key without a request', async () => {
        await expect(kv.set('k'.repeat(1025), 'v')).rejects.toMatchObject({ code: 'key_too_large' });
        expect(FakeXHR.requests).toHaveLength(0);
    });

    it('rejects an oversized value without a request', async () => {
        await expect(kv.set('k', 'v'.repeat(399 * 1024 + 1))).rejects.toMatchObject({ code: 'value_too_large' });
        expect(FakeXHR.requests).toHaveLength(0);
    });

    it('rejects an empty batch', async () => {
        await expect(kv.set([])).rejects.toMatchObject({ code: 'items_required' });
    });

    it('rejects a batch item without a key', async () => {
        await expect(kv.set([{ value: 1 }])).rejects.toMatchObject({ code: 'invalid_item' });
    });
});

describe('kv.get driver payloads', () => {
    it('get(key) sends a bare get call', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: 'stored' });
        await expect(kv.get('k')).resolves.toBe('stored');
        const body = lastBody();
        expect(body.method).toBe('get');
        expect(body.args).toEqual({ key: 'k' });
    });

    it('get(key, optConfig) includes optConfig', async () => {
        await kv.get('k', { appUuid: 'u' });
        expect(lastBody().args).toEqual({ key: 'k', optConfig: { appUuid: 'u' } });
    });

    it('get({ key }) object form maps through', async () => {
        await kv.get({ key: 'k' });
        expect(lastBody().args).toEqual({ key: 'k' });
    });

    it('rejects an oversized key without a request', async () => {
        await expect(kv.get('k'.repeat(1025))).rejects.toMatchObject({ code: 'key_too_large' });
        expect(FakeXHR.requests).toHaveLength(0);
    });
});

describe('kv.get GUI boot cache', () => {
    it('serves boot keys from one batched request', async () => {
        FakeXHR.respondWith = (body) => ({
            success: true,
            result: body.args.key.map((key) => `${key}-value`),
        });
        await expect(kv.get('sidebar_items')).resolves.toBe('sidebar_items-value');
        await expect(kv.get('menubar_style')).resolves.toBe('menubar_style-value');
        expect(FakeXHR.requests).toHaveLength(1);
        const body = lastBody();
        expect(body.method).toBe('get');
        expect(Array.isArray(body.args.key)).toBe(true);
        expect(body.args.key).toContain('sidebar_items');
    });

    it('resolves undefined for boot keys when the batch result is not an array', async () => {
        FakeXHR.respondWith = () => ({ success: false });
        await expect(kv.get('sidebar_items')).resolves.toBeUndefined();
    });

    it('bypasses the cache when optConfig is passed', async () => {
        await kv.get('sidebar_items', { appUuid: 'u' });
        expect(lastBody().args).toEqual({ key: 'sidebar_items', optConfig: { appUuid: 'u' } });
    });

    it('bypasses the cache for non-boot keys', async () => {
        await kv.get('ordinary-key');
        expect(lastBody().args).toEqual({ key: 'ordinary-key' });
    });
});

describe('kv.incr / kv.decr driver payloads', () => {
    it('incr(key) defaults the amount to 1 at the root path', async () => {
        await kv.incr('n');
        const body = lastBody();
        expect(body.method).toBe('incr');
        expect(body.args).toEqual({ key: 'n', pathAndAmountMap: { '': 1 } });
    });

    it('incr(key, amount) maps the amount to the root path', async () => {
        await kv.incr('n', 5);
        expect(lastBody().args).toEqual({ key: 'n', pathAndAmountMap: { '': 5 } });
    });

    it('incr(key, pathAndAmountMap) passes the map through', async () => {
        await kv.incr('n', { 'user.score': 2 });
        expect(lastBody().args).toEqual({ key: 'n', pathAndAmountMap: { 'user.score': 2 } });
    });

    it('incr(key, optConfig) treats an appUuid object as optConfig shorthand', async () => {
        await kv.incr('n', { appUuid: 'u' });
        expect(lastBody().args).toEqual({
            key: 'n',
            pathAndAmountMap: { '': 1 },
            optConfig: { appUuid: 'u' },
        });
    });

    it('incr(key, amount, optConfig) sends both', async () => {
        await kv.incr('n', 3, { appUuid: 'u' });
        expect(lastBody().args).toEqual({
            key: 'n',
            pathAndAmountMap: { '': 3 },
            optConfig: { appUuid: 'u' },
        });
    });

    it('incr(options) passes the object through as-is', async () => {
        await kv.incr({ key: 'n', pathAndAmountMap: { x: 3 } });
        expect(lastBody().args).toEqual({ key: 'n', pathAndAmountMap: { x: 3 } });
    });

    it('incr() rejects without arguments', async () => {
        await expect(kv.incr()).rejects.toMatchObject({ code: 'arguments_required' });
    });

    it('rejects an oversized key without a request', async () => {
        await expect(kv.incr('k'.repeat(1025))).rejects.toMatchObject({ code: 'key_too_large' });
        expect(FakeXHR.requests).toHaveLength(0);
    });

    it('decr(key) uses the decr driver method', async () => {
        await kv.decr('n');
        const body = lastBody();
        expect(body.method).toBe('decr');
        expect(body.args).toEqual({ key: 'n', pathAndAmountMap: { '': 1 } });
    });

    it('decr(key, amount) maps the amount to the root path', async () => {
        await kv.decr('n', 4);
        expect(lastBody().args).toEqual({ key: 'n', pathAndAmountMap: { '': 4 } });
    });
});

describe('kv.add driver payloads', () => {
    it('add(key) defaults the value to 1 at the root path', async () => {
        await kv.add('k');
        const body = lastBody();
        expect(body.method).toBe('add');
        expect(body.args).toEqual({ key: 'k', pathAndValueMap: { '': 1 } });
    });

    it('add(key, scalar) maps the value to the root path', async () => {
        await kv.add('k', 5);
        expect(lastBody().args).toEqual({ key: 'k', pathAndValueMap: { '': 5 } });
    });

    it('add(key, array) maps the array to the root path', async () => {
        await kv.add('k', [1, 2]);
        expect(lastBody().args).toEqual({ key: 'k', pathAndValueMap: { '': [1, 2] } });
    });

    it('add(key, pathAndValueMap) passes the map through', async () => {
        await kv.add('k', { tags: ['beta'] });
        expect(lastBody().args).toEqual({ key: 'k', pathAndValueMap: { tags: ['beta'] } });
    });

    it('add(key, optConfig) treats an appUuid object as optConfig shorthand', async () => {
        await kv.add('k', { appUuid: 'u' });
        expect(lastBody().args).toEqual({
            key: 'k',
            pathAndValueMap: { '': 1 },
            optConfig: { appUuid: 'u' },
        });
    });

    it('add(options) passes the object through as-is', async () => {
        await kv.add({ key: 'k', pathAndValueMap: { x: 1 } });
        expect(lastBody().args).toEqual({ key: 'k', pathAndValueMap: { x: 1 } });
    });

    it('add() rejects without arguments', async () => {
        await expect(kv.add()).rejects.toMatchObject({ code: 'arguments_required' });
    });
});

describe('kv.remove driver payloads', () => {
    it('remove(key, path) sends the paths array', async () => {
        await kv.remove('k', 'profile.bio');
        const body = lastBody();
        expect(body.method).toBe('remove');
        expect(body.args).toEqual({ key: 'k', paths: ['profile.bio'] });
    });

    it('remove(key, ...paths, optConfig) pops the trailing optConfig', async () => {
        await kv.remove('k', 'a', 'b', { appUuid: 'u' });
        expect(lastBody().args).toEqual({ key: 'k', paths: ['a', 'b'], optConfig: { appUuid: 'u' } });
    });

    it('remove(key) rejects without paths', async () => {
        await expect(kv.remove('k')).rejects.toMatchObject({ code: 'arguments_required' });
    });

    it('remove(key, [paths]) rejects an array of paths', async () => {
        await expect(kv.remove('k', ['a', 'b'])).rejects.toMatchObject({ code: 'paths_invalid' });
    });

    it('remove(key, nonString) rejects non-string paths', async () => {
        await expect(kv.remove('k', 42)).rejects.toMatchObject({ code: 'paths_invalid' });
    });

    it('remove(undefined, path) rejects a missing key', async () => {
        await expect(kv.remove(undefined, 'a')).rejects.toMatchObject({ code: 'key_undefined' });
    });
});

describe('kv.update driver payloads', () => {
    it('update(key, pathAndValueMap) sends the map', async () => {
        await kv.update('k', { 'profile.color': 'blue' });
        const body = lastBody();
        expect(body.method).toBe('update');
        expect(body.args).toEqual({ key: 'k', pathAndValueMap: { 'profile.color': 'blue' } });
    });

    it('update(key, pathAndValueMap, ttl) includes ttl', async () => {
        await kv.update('k', { a: 1 }, 3600);
        expect(lastBody().args).toEqual({ key: 'k', pathAndValueMap: { a: 1 }, ttl: 3600 });
    });

    it('update(key, pathAndValueMap, ttl, optConfig) includes both', async () => {
        await kv.update('k', { a: 1 }, 3600, { appUuid: 'u' });
        expect(lastBody().args).toEqual({
            key: 'k',
            pathAndValueMap: { a: 1 },
            ttl: 3600,
            optConfig: { appUuid: 'u' },
        });
    });

    it('update(key, pathAndValueMap, optConfig) skips ttl', async () => {
        await kv.update('k', { a: 1 }, { appUuid: 'u' });
        expect(lastBody().args).toEqual({
            key: 'k',
            pathAndValueMap: { a: 1 },
            optConfig: { appUuid: 'u' },
        });
    });

    it('update(object) coerces a numeric-string ttl', async () => {
        await kv.update({ key: 'k', pathAndValueMap: { a: 1 }, ttl: '60' });
        expect(lastBody().args).toEqual({ key: 'k', pathAndValueMap: { a: 1 }, ttl: 60 });
    });

    it('rejects a non-object pathAndValueMap', async () => {
        await expect(kv.update('k', 'nope')).rejects.toMatchObject({ code: 'path_map_invalid' });
    });

    it('rejects an empty pathAndValueMap', async () => {
        await expect(kv.update('k', {})).rejects.toMatchObject({ code: 'path_map_invalid' });
    });

    it('rejects a non-numeric ttl', async () => {
        await expect(kv.update({ key: 'k', pathAndValueMap: { a: 1 }, ttl: 'soon' }))
            .rejects.toMatchObject({ code: 'ttl_invalid' });
    });
});

describe('kv.expire / kv.expireAt driver payloads', () => {
    it('expire(key, ttl) sends the ttl', async () => {
        await kv.expire('k', 60);
        const body = lastBody();
        expect(body.method).toBe('expire');
        expect(body.args).toEqual({ key: 'k', ttl: 60 });
    });

    it('expire(key, ttl, optConfig) includes optConfig', async () => {
        await kv.expire('k', 60, { appUuid: 'u' });
        expect(lastBody().args).toEqual({ key: 'k', ttl: 60, optConfig: { appUuid: 'u' } });
    });

    it('expireAt(key, timestamp) sends the timestamp', async () => {
        await kv.expireAt('k', 1234567890);
        const body = lastBody();
        expect(body.method).toBe('expireAt');
        expect(body.args).toEqual({ key: 'k', timestamp: 1234567890 });
    });

    it('both reject an oversized key without a request', async () => {
        const bigKey = 'k'.repeat(1025);
        await expect(kv.expire(bigKey, 60)).rejects.toMatchObject({ code: 'key_too_large' });
        await expect(kv.expireAt(bigKey, 1)).rejects.toMatchObject({ code: 'key_too_large' });
        expect(FakeXHR.requests).toHaveLength(0);
    });
});

describe('kv.del driver payloads', () => {
    it('del(key) sends a bare del call', async () => {
        await kv.del('k');
        const body = lastBody();
        expect(body.method).toBe('del');
        expect(body.args).toEqual({ key: 'k' });
    });

    it('del(key, optConfig) includes optConfig', async () => {
        await kv.del('k', { appUuid: 'u' });
        expect(lastBody().args).toEqual({ key: 'k', optConfig: { appUuid: 'u' } });
    });

    it('del({ key }) object form maps through', async () => {
        await kv.del({ key: 'k' });
        expect(lastBody().args).toEqual({ key: 'k' });
    });

    it('rejects an oversized key without a request', async () => {
        await expect(kv.del('k'.repeat(1025))).rejects.toMatchObject({ code: 'key_too_large' });
        expect(FakeXHR.requests).toHaveLength(0);
    });
});

describe('kv.list driver payloads', () => {
    // Unbound (non-paginated) forms fetch pages on the caller's behalf, so
    // their wire args carry the SDK's paging params on top of the base args.
    const SDK_PAGING_ARGS = { limit: 1000, fetchUntilFull: true, cursor: null };

    beforeEach(() => {
        FakeXHR.respondWith = () => ({ success: true, result: [] });
    });

    it('list() asks for keys only', async () => {
        await kv.list();
        const body = lastBody();
        expect(body.method).toBe('list');
        expect(body.args).toEqual({ as: 'keys', ...SDK_PAGING_ARGS });
    });

    it('list(true) asks for key-value pairs', async () => {
        await kv.list(true);
        expect(lastBody().args).toEqual({ ...SDK_PAGING_ARGS });
    });

    it('list(pattern) strips a trailing wildcard', async () => {
        await kv.list('abc*');
        expect(lastBody().args).toEqual({ as: 'keys', pattern: 'abc', ...SDK_PAGING_ARGS });
    });

    it('list(pattern) keeps a bare prefix as-is', async () => {
        await kv.list('abc');
        expect(lastBody().args).toEqual({ as: 'keys', pattern: 'abc', ...SDK_PAGING_ARGS });
    });

    it('list("*") matches everything, so no pattern is sent', async () => {
        await kv.list('*');
        expect(lastBody().args).toEqual({ as: 'keys', ...SDK_PAGING_ARGS });
    });

    it('list(pattern) keeps an inner literal * in the prefix', async () => {
        await kv.list('k**');
        expect(lastBody().args).toEqual({ as: 'keys', pattern: 'k*', ...SDK_PAGING_ARGS });
    });

    it('list(pattern, true) asks for pairs matching the pattern', async () => {
        await kv.list('abc*', true);
        expect(lastBody().args).toEqual({ pattern: 'abc', ...SDK_PAGING_ARGS });
    });

    it('list(pattern, false) keeps the pattern', async () => {
        await kv.list('abc*', false);
        expect(lastBody().args).toEqual({ as: 'keys', pattern: 'abc', ...SDK_PAGING_ARGS });
    });

    it('list(true, optConfig) asks for pairs with optConfig', async () => {
        await kv.list(true, { appUuid: 'u' });
        expect(lastBody().args).toEqual({ optConfig: { appUuid: 'u' }, ...SDK_PAGING_ARGS });
    });

    it('list(pattern, optConfig) includes optConfig', async () => {
        await kv.list('abc*', { appUuid: 'u' });
        expect(lastBody().args).toEqual({ as: 'keys', pattern: 'abc', optConfig: { appUuid: 'u' }, ...SDK_PAGING_ARGS });
    });

    it('list(pattern, true, optConfig) sends all three', async () => {
        await kv.list('abc*', true, { appUuid: 'u' });
        expect(lastBody().args).toEqual({ pattern: 'abc', optConfig: { appUuid: 'u' }, ...SDK_PAGING_ARGS });
    });

    it('list() follows cursors and concatenates the full listing', async () => {
        FakeXHR.respondWith = (body) =>
            body.args.cursor === null
                ? { success: true, result: { items: ['a', 'b'], cursor: 'c2' } }
                : { success: true, result: { items: ['c'] } };
        await expect(kv.list()).resolves.toEqual(['a', 'b', 'c']);
        expect(FakeXHR.requests).toHaveLength(2);
        expect(JSON.parse(FakeXHR.requests[0].requestBody).args.cursor).toBe(null);
        expect(JSON.parse(FakeXHR.requests[1].requestBody).args.cursor).toBe('c2');
    });

    it('list() treats a bare-array response as the complete listing', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: ['a', 'b'] });
        await expect(kv.list()).resolves.toEqual(['a', 'b']);
        expect(FakeXHR.requests).toHaveLength(1);
    });

    it('warns once when a full listing spans multiple pages', async () => {
        FakeXHR.respondWith = (body) =>
            body.args.cursor === null
                ? { success: true, result: { items: ['a'], cursor: 'c2' } }
                : { success: true, result: { items: ['b'] } };
        await kv.list();
        await kv.list();
        const scanWarnings = warnSpy.mock.calls
            .filter(([msg]) => String(msg).includes('spanned multiple pages'));
        expect(scanWarnings).toHaveLength(1);
    });

    it('does not warn when the full listing fits in one page', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: { items: ['a'] } });
        await kv.list();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns once when includeTotal is requested', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: { items: [], total: 0 } });
        await kv.list({ limit: 1, includeTotal: true });
        await kv.list({ limit: 1, includeTotal: true });
        const totalWarnings = warnSpy.mock.calls
            .filter(([msg]) => String(msg).includes('includeTotal'));
        expect(totalWarnings).toHaveLength(1);
    });

    it('list({ stream: true }) yields envelope pages and follows cursors', async () => {
        FakeXHR.respondWith = (body) =>
            body.args.cursor === null
                ? { success: true, result: { items: ['a'], cursor: 'c2', total: 2 } }
                : { success: true, result: { items: ['b'] } };
        const pages = [];
        for await ( const page of kv.list({ stream: true, includeTotal: true }) ) {
            pages.push(page);
        }
        expect(pages).toEqual([
            { items: ['a'], cursor: 'c2', total: 2 },
            { items: ['b'] },
        ]);
        // `includeTotal` rides the first request only.
        expect(JSON.parse(FakeXHR.requests[0].requestBody).args)
            .toEqual({ as: 'keys', limit: 1000, fetchUntilFull: true, cursor: null, includeTotal: true });
        expect(JSON.parse(FakeXHR.requests[1].requestBody).args)
            .toEqual({ as: 'keys', limit: 1000, fetchUntilFull: true, cursor: 'c2' });
    });

    it('list({ stream: true, limit }) keeps the caller\'s page size', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: { items: ['a'] } });
        for await ( const page of kv.list({ stream: true, limit: 2, returnValues: true }) ) {
            expect(page).toEqual({ items: ['a'] });
        }
        expect(lastBody().args).toEqual({ limit: 2, cursor: null });
    });

    it('list({ stream: true, cursor }) resumes from the cursor', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: { items: [] } });
        for await ( const page of kv.list({ stream: true, cursor: 'c9' }) ) {
            expect(page).toEqual({ items: [] });
        }
        expect(lastBody().args).toEqual({ as: 'keys', limit: 1000, fetchUntilFull: true, cursor: 'c9' });
    });

    it('list({ stream: true, offset }) rejects client-side', () => {
        let err;
        try {
            kv.list({ stream: true, offset: 1 });
        } catch (e) {
            err = e;
        }
        expect(err).toMatchObject({ code: 'invalid_request' });
        expect(FakeXHR.requests).toHaveLength(0);
    });

    it('list(options) copies every pagination option', async () => {
        await kv.list({
            pattern: 'p*',
            returnValues: true,
            limit: 5,
            cursor: 'c1',
            offset: 2,
            includeTotal: true,
            fetchUntilFull: true,
            optConfig: { appUuid: 'u' },
        });
        expect(lastBody().args).toEqual({
            pattern: 'p',
            limit: 5,
            cursor: 'c1',
            offset: 2,
            includeTotal: true,
            fetchUntilFull: true,
            optConfig: { appUuid: 'u' },
        });
    });

    it('list(options) with returnValues false asks for keys', async () => {
        await kv.list({ limit: 5 });
        expect(lastBody().args).toEqual({ as: 'keys', limit: 5 });
    });

    it('list(optConfig) treats an appUuid object as optConfig shorthand', async () => {
        await kv.list({ appUuid: 'u' });
        expect(lastBody().args).toEqual({ as: 'keys', optConfig: { appUuid: 'u' }, ...SDK_PAGING_ARGS });
    });

    it('list({ appUuid, stream }) strips stream from the optConfig shorthand', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: { items: [] } });
        for await ( const page of kv.list({ appUuid: 'u', stream: true }) ) {
            expect(page).toEqual({ items: [] });
        }
        expect(lastBody().args).toEqual({ as: 'keys', optConfig: { appUuid: 'u' }, ...SDK_PAGING_ARGS });
    });
});

describe('kv.flush driver payloads', () => {
    it('flush() sends an empty args object', async () => {
        await kv.flush();
        const body = lastBody();
        expect(body.method).toBe('flush');
        expect(body.args).toEqual({});
    });

    it('flush(optConfig) wraps a bare optConfig', async () => {
        await kv.flush({ appUuid: 'u' });
        expect(lastBody().args).toEqual({ optConfig: { appUuid: 'u' } });
    });

    it('flush({ optConfig }) passes the object through', async () => {
        await kv.flush({ optConfig: { appUuid: 'u' } });
        expect(lastBody().args).toEqual({ optConfig: { appUuid: 'u' } });
    });

    it('clear is the same bound function as flush', async () => {
        expect(kv.clear).toBe(kv.flush);
        await kv.clear();
        expect(lastBody().method).toBe('flush');
    });
});

describe('module surface', () => {
    it('exposes the documented size limits', () => {
        expect(kv.MAX_KEY_SIZE).toBe(1024);
        expect(kv.MAX_VALUE_SIZE).toBe(399 * 1024);
    });

    it('methods keep working when destructured', async () => {
        const { set, get } = kv;
        await set('k', 'v');
        expect(lastBody().method).toBe('set');
        await get('k');
        expect(lastBody().method).toBe('get');
    });

    it('reads auth state live from the Puter instance', async () => {
        fakePuter.authToken = 'rotated-token';
        fakePuter.APIOrigin = 'https://api.rotated';
        await kv.set('k', 'v');
        expect(lastBody().auth_token).toBe('rotated-token');
        expect(FakeXHR.requests.at(-1).url).toBe('https://api.rotated/drivers/call');
    });
});
