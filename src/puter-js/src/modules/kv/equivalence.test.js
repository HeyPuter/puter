import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import OldKV from '../KV.baseline.js';
import { KV as NewKV } from './index.js';

/**
 * One-off equivalence harness: runs the same call through the pre-restructure
 * KV module (KV.baseline.js, extracted from git) and the new kv/ module, and
 * asserts both produce byte-identical `/drivers/call` wire payloads, the same
 * resolved values, and the same client-side rejection codes.
 *
 * The two deliberate divergences (documented `list()` forms whose old runtime
 * behavior contradicted kv.d.ts and the docs) are asserted explicitly in
 * their own block.
 */

class FakeXHR {
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
        const parsed = body === null ? null : JSON.parse(body);
        const respObj = FakeXHR.respondWith
            ? FakeXHR.respondWith(parsed)
            : Array.isArray(parsed?.args?.key)
                // GUI boot-cache batch get: echo per-key values.
                ? { success: true, result: parsed.args.key.map((k) => `${k}-value`) }
                : { success: true, result: true };
        queueMicrotask(() => {
            this.responseText = JSON.stringify(respObj);
            for ( const fn of this._listeners.load ?? [] ) {
                fn.call(this, { target: this });
            }
        });
    }
}

const makeFakePuter = () => ({
    authToken: 'test-token',
    APIOrigin: 'https://api.test',
    appID: 'app-test',
    env: 'nodejs',
});

const origXHR = globalThis.XMLHttpRequest;
const origPuter = globalThis.puter;

beforeEach(() => {
    FakeXHR.requests = [];
    FakeXHR.respondWith = null;
    globalThis.XMLHttpRequest = FakeXHR;
    globalThis.puter = makeFakePuter();
});

afterEach(() => {
    globalThis.XMLHttpRequest = origXHR;
    globalThis.puter = origPuter;
});

// Runs `fn` against a fresh instance of `KVClass` and captures everything an
// app could observe client-side: wire bodies, the resolved value, and the
// rejection (if any).
const capture = async (KVClass, fn) => {
    FakeXHR.requests = [];
    const kv = new KVClass(globalThis.puter);
    let result = null;
    let rejection = null;
    try {
        result = await fn(kv);
    } catch (e) {
        rejection = e;
    }
    return {
        bodies: FakeXHR.requests.map((r) => JSON.parse(r.requestBody)),
        result,
        rejectionCode: rejection ? (rejection.code ?? String(rejection)) : null,
    };
};

const cb = () => {};

// Every documented and legacy call form. `rejects` marks forms that must
// fail client-side (both implementations, same code, no request sent).
const CASES = [
    // -- set --
    { name: "set('k', 'v')", run: (kv) => kv.set('k', 'v') },
    { name: "set('k', 'v', 1234)", run: (kv) => kv.set('k', 'v', 1234) },
    { name: "set('k', 'v', null)", run: (kv) => kv.set('k', 'v', null) },
    { name: "set('k', 'v', 1234, optConfig)", run: (kv) => kv.set('k', 'v', 1234, { appUuid: 'u' }) },
    { name: "set('k', 'v', optConfig)", run: (kv) => kv.set('k', 'v', { appUuid: 'u' }) },
    { name: 'set({ key, value, expireAt })', run: (kv) => kv.set({ key: 'k', value: 'v', expireAt: 9 }) },
    { name: 'set({ key, value, optConfig })', run: (kv) => kv.set({ key: 'k', value: 'v', optConfig: { appUuid: 'u' } }) },
    { name: 'set([items]) batch', run: (kv) => kv.set([{ key: 'a', value: 1 }, { key: 5, value: 'x', expireAt: 99 }]) },
    { name: 'set([items], optConfig)', run: (kv) => kv.set([{ key: 'a', value: 1 }], { appUuid: 'u' }) },
    { name: 'set({ items }) wrapped batch', run: (kv) => kv.set({ items: [{ key: 'a', value: 1 }] }) },
    { name: 'set with trailing callbacks', run: (kv) => kv.set('k', 'v', cb, cb) },
    { name: 'set with undefined then callback', run: (kv) => kv.set('k', 'v', undefined, cb) },
    { name: 'set(undefined, v) rejects', run: (kv) => kv.set(undefined, 'v'), rejects: 'key_undefined' },
    { name: 'set(bigKey, v) rejects', run: (kv) => kv.set('k'.repeat(1025), 'v'), rejects: 'key_too_large' },
    { name: 'set(k, bigValue) rejects', run: (kv) => kv.set('k', 'v'.repeat(399 * 1024 + 1)), rejects: 'value_too_large' },
    { name: 'set([]) rejects', run: (kv) => kv.set([]), rejects: 'items_required' },
    { name: 'set([{ value }]) rejects', run: (kv) => kv.set([{ value: 1 }]), rejects: 'invalid_item' },

    // -- get --
    { name: "get('k')", run: (kv) => kv.get('k') },
    { name: "get('k', optConfig)", run: (kv) => kv.get('k', { appUuid: 'u' }) },
    { name: 'get({ key })', run: (kv) => kv.get({ key: 'k' }) },
    { name: 'get(gui boot key) batches', run: (kv) => kv.get('sidebar_items') },
    { name: 'get(gui boot key, optConfig) bypasses cache', run: (kv) => kv.get('sidebar_items', { appUuid: 'u' }) },
    { name: 'get(bigKey) rejects', run: (kv) => kv.get('k'.repeat(1025)), rejects: 'key_too_large' },

    // -- del --
    { name: "del('k')", run: (kv) => kv.del('k') },
    { name: "del('k', optConfig)", run: (kv) => kv.del('k', { appUuid: 'u' }) },
    { name: 'del({ key })', run: (kv) => kv.del({ key: 'k' }) },
    { name: 'del(bigKey) rejects', run: (kv) => kv.del('k'.repeat(1025)), rejects: 'key_too_large' },

    // -- incr / decr --
    { name: "incr('n')", run: (kv) => kv.incr('n') },
    { name: "incr('n', 5)", run: (kv) => kv.incr('n', 5) },
    { name: "incr('n', pathMap)", run: (kv) => kv.incr('n', { 'a.b': 2 }) },
    { name: "incr('n', optConfig shorthand)", run: (kv) => kv.incr('n', { appUuid: 'u' }) },
    { name: "incr('n', 3, optConfig)", run: (kv) => kv.incr('n', 3, { appUuid: 'u' }) },
    { name: 'incr(options object)', run: (kv) => kv.incr({ key: 'n', pathAndAmountMap: { x: 3 } }) },
    { name: 'incr() rejects', run: (kv) => kv.incr(), rejects: 'arguments_required' },
    { name: 'incr(bigKey) rejects', run: (kv) => kv.incr('k'.repeat(1025)), rejects: 'key_too_large' },
    { name: "decr('n')", run: (kv) => kv.decr('n') },
    { name: "decr('n', 4)", run: (kv) => kv.decr('n', 4) },
    { name: "decr('n', optConfig shorthand)", run: (kv) => kv.decr('n', { appUuid: 'u' }) },

    // -- add --
    { name: "add('k')", run: (kv) => kv.add('k') },
    { name: "add('k', 5)", run: (kv) => kv.add('k', 5) },
    { name: "add('k', 'str')", run: (kv) => kv.add('k', 'str') },
    { name: "add('k', [1, 2])", run: (kv) => kv.add('k', [1, 2]) },
    { name: "add('k', pathMap)", run: (kv) => kv.add('k', { tags: ['b'] }) },
    { name: "add('k', optConfig shorthand)", run: (kv) => kv.add('k', { appUuid: 'u' }) },
    { name: 'add(options object)', run: (kv) => kv.add({ key: 'k', pathAndValueMap: { x: 1 } }) },
    { name: 'add() rejects', run: (kv) => kv.add(), rejects: 'arguments_required' },

    // -- remove --
    { name: "remove('k', path)", run: (kv) => kv.remove('k', 'a') },
    { name: "remove('k', paths..., optConfig)", run: (kv) => kv.remove('k', 'a', 'b', { appUuid: 'u' }) },
    { name: "remove('k') rejects", run: (kv) => kv.remove('k'), rejects: 'arguments_required' },
    { name: "remove('k', [paths]) rejects", run: (kv) => kv.remove('k', ['a', 'b']), rejects: 'paths_invalid' },
    { name: "remove('k', 42) rejects", run: (kv) => kv.remove('k', 42), rejects: 'paths_invalid' },
    { name: 'remove(undefined, path) rejects', run: (kv) => kv.remove(undefined, 'a'), rejects: 'key_undefined' },

    // -- update --
    { name: "update('k', map)", run: (kv) => kv.update('k', { a: 1 }) },
    { name: "update('k', map, ttl)", run: (kv) => kv.update('k', { a: 1 }, 3600) },
    { name: "update('k', map, ttl, optConfig)", run: (kv) => kv.update('k', { a: 1 }, 3600, { appUuid: 'u' }) },
    { name: "update('k', map, optConfig)", run: (kv) => kv.update('k', { a: 1 }, { appUuid: 'u' }) },
    { name: 'update(object with string ttl)', run: (kv) => kv.update({ key: 'k', pathAndValueMap: { a: 1 }, ttl: '60' }) },
    { name: "update('k', non-map) rejects", run: (kv) => kv.update('k', 'nope'), rejects: 'path_map_invalid' },
    { name: "update('k', {}) rejects", run: (kv) => kv.update('k', {}), rejects: 'path_map_invalid' },
    { name: 'update with NaN ttl rejects', run: (kv) => kv.update({ key: 'k', pathAndValueMap: { a: 1 }, ttl: 'soon' }), rejects: 'ttl_invalid' },

    // -- expire / expireAt --
    { name: "expire('k', 60)", run: (kv) => kv.expire('k', 60) },
    { name: "expire('k', 60, optConfig)", run: (kv) => kv.expire('k', 60, { appUuid: 'u' }) },
    { name: 'expire(bigKey) rejects', run: (kv) => kv.expire('k'.repeat(1025), 60), rejects: 'key_too_large' },
    { name: "expireAt('k', ts)", run: (kv) => kv.expireAt('k', 1234567890) },
    { name: "expireAt('k', ts, optConfig)", run: (kv) => kv.expireAt('k', 1, { appUuid: 'u' }) },

    // -- list (equivalent paginated forms; unbound forms diverge and are
    // asserted in the divergences block below) --
    { name: 'list(full options object)', run: (kv) => kv.list({ pattern: 'p*', returnValues: true, limit: 5, cursor: 'c1', offset: 2, includeTotal: true, fetchUntilFull: true, optConfig: { appUuid: 'u' } }) },
    { name: 'list({ limit })', run: (kv) => kv.list({ limit: 5 }) },

    // -- flush / clear --
    { name: 'flush()', run: (kv) => kv.flush() },
    { name: 'flush(optConfig)', run: (kv) => kv.flush({ appUuid: 'u' }) },
    { name: 'flush({ optConfig })', run: (kv) => kv.flush({ optConfig: { appUuid: 'u' } }) },
    { name: 'clear()', run: (kv) => kv.clear() },
];

describe('old vs new KV module equivalence', () => {
    for ( const c of CASES ) {
        it(c.name, async () => {
            const oldRun = await capture(OldKV, c.run);
            const newRun = await capture(NewKV, c.run);

            expect(newRun.bodies).toEqual(oldRun.bodies);
            expect(newRun.result).toEqual(oldRun.result);
            expect(newRun.rejectionCode).toEqual(oldRun.rejectionCode);
            if ( c.rejects ) {
                expect(newRun.rejectionCode).toBe(c.rejects);
                expect(newRun.bodies).toHaveLength(0);
            }
        });
    }

    it('module surface: constants and aliases match', () => {
        const oldKv = new OldKV(globalThis.puter);
        const newKv = new NewKV(globalThis.puter);
        expect(newKv.MAX_KEY_SIZE).toBe(oldKv.MAX_KEY_SIZE);
        expect(newKv.MAX_VALUE_SIZE).toBe(oldKv.MAX_VALUE_SIZE);
        expect(oldKv.clear).toBe(oldKv.flush);
        expect(newKv.clear).toBe(newKv.flush);
        for ( const name of ['set', 'get', 'del', 'incr', 'decr', 'add', 'remove', 'update', 'expire', 'expireAt', 'list', 'flush', 'clear', 'setAuthToken', 'setAPIOrigin'] ) {
            expect(typeof newKv[name], name).toBe(typeof oldKv[name]);
        }
    });
});

describe('deliberate divergences (runtime now matches kv.d.ts/docs)', () => {
    // Unbound (non-paginated) list forms now fetch pages under the hood: the
    // wire request carries the SDK's paging params, but the resolved value —
    // the full listing as a plain array — is unchanged.
    const UNBOUND_LIST_FORMS = [
        { name: 'list()', run: (kv) => kv.list() },
        { name: 'list(true)', run: (kv) => kv.list(true) },
        { name: 'list(false)', run: (kv) => kv.list(false) },
        { name: "list('abc*')", run: (kv) => kv.list('abc*') },
        { name: "list('abc')", run: (kv) => kv.list('abc') },
        { name: "list('*')", run: (kv) => kv.list('*') },
        { name: "list('k**')", run: (kv) => kv.list('k**') },
        { name: "list('  ')", run: (kv) => kv.list('  ') },
        { name: "list('abc*', true)", run: (kv) => kv.list('abc*', true) },
        { name: "list('abc*', optConfig)", run: (kv) => kv.list('abc*', { appUuid: 'u' }) },
        { name: "list('abc*', true, optConfig)", run: (kv) => kv.list('abc*', true, { appUuid: 'u' }) },
        { name: 'list(optConfig shorthand object)', run: (kv) => kv.list({ appUuid: 'u' }) },
    ];
    for ( const form of UNBOUND_LIST_FORMS ) {
        it(`${form.name}: new pages under the hood, same resolved value`, async () => {
            FakeXHR.respondWith = () => ({ success: true, result: ['k1', 'k2'] });
            const oldRun = await capture(OldKV, form.run);
            const newRun = await capture(NewKV, form.run);

            // A bare-array response ends the paging loop after one request.
            expect(newRun.bodies).toHaveLength(oldRun.bodies.length);
            expect(newRun.bodies[0].args).toEqual({
                ...oldRun.bodies[0].args,
                limit: 1000,
                fetchUntilFull: true,
                cursor: null,
            });
            expect(newRun.result).toEqual(oldRun.result);
            expect(newRun.rejectionCode).toEqual(oldRun.rejectionCode);
        });
    }

    it("list(pattern, false): old dropped the pattern, new keeps it", async () => {
        FakeXHR.respondWith = () => ({ success: true, result: [] });
        const oldRun = await capture(OldKV, (kv) => kv.list('abc*', false));
        const newRun = await capture(NewKV, (kv) => kv.list('abc*', false));
        expect(oldRun.bodies[0].args).toEqual({ as: 'keys' });
        expect(newRun.bodies[0].args).toEqual({ as: 'keys', pattern: 'abc', limit: 1000, fetchUntilFull: true, cursor: null });
    });

    it('list(true, optConfig): old returned keys, new returns pairs', async () => {
        FakeXHR.respondWith = () => ({ success: true, result: [] });
        const oldRun = await capture(OldKV, (kv) => kv.list(true, { appUuid: 'u' }));
        const newRun = await capture(NewKV, (kv) => kv.list(true, { appUuid: 'u' }));
        expect(oldRun.bodies[0].args).toEqual({ as: 'keys', optConfig: { appUuid: 'u' } });
        expect(newRun.bodies[0].args).toEqual({ optConfig: { appUuid: 'u' }, limit: 1000, fetchUntilFull: true, cursor: null });
    });

    it('destructured get: old threw (unbound method), new works', async () => {
        const oldRun = await capture(OldKV, (kv) => {
            const { get } = kv;
            return get('k');
        });
        const newRun = await capture(NewKV, (kv) => {
            const { get } = kv;
            return get('k');
        });
        // Old `get` was the one regular (non-arrow) method, so it lost `this`
        // when destructured; every other old method was already bound.
        expect(oldRun.rejectionCode).toMatch(/Cannot read properties of undefined/);
        expect(newRun.rejectionCode).toBeNull();
        expect(newRun.bodies[0].args).toEqual({ key: 'k' });
    });
});
