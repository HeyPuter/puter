// kv.test.ts - Tests for Puter KV module (set, get, del, incr, decr, list, flush)
import { describe, expect, it } from 'vitest';
import { puter } from './testUtils';
describe('Puter KV Module', () => {

    const TEST_KEY = 'test-key';
    it('should set a key success', async () => {
        await expect(puter.kv.set(TEST_KEY, 0)).resolves.toBe(true);
    });

    it('should get a key success', async () => {
        const getRes = await puter.kv.get(TEST_KEY);
        expect(getRes).toBe(0);
    });
    it('should get empty key', async () => {
        const emptyRes = await puter.kv.get('fake' + TEST_KEY)
        expect(emptyRes).toBeNull();
    });

    it('should increment a key success', async () => {
        await puter.kv.set(TEST_KEY, 0);
        const incrRes = await puter.kv.incr(TEST_KEY, { '': 5 });
        expect(incrRes).toBe(5);
        const finalGet = await puter.kv.get(TEST_KEY);
        expect(finalGet).toBe(5);
    });

    it('should decrement a key success', async () => {
        const getRes = await puter.kv.set(TEST_KEY, 0);
        const decrRes = await puter.kv.decr(TEST_KEY, { '': 3 });
        expect(decrRes).toBe(-3);
        const finalGet = await puter.kv.get(TEST_KEY);
        expect(finalGet).toBe(-3);
    });

    it('should increment a key with second argument', async () => {
        await puter.kv.set(TEST_KEY, 0);
        const incrRes = await puter.kv.incr(TEST_KEY);
        expect(incrRes).toBe(1);
        const finalGet = await puter.kv.get(TEST_KEY);
        expect(finalGet).toBe(1);
    })

    it('should decrement a key with second argument', async () => {
        await puter.kv.set(TEST_KEY, 0);
        const incrRes = await puter.kv.decr(TEST_KEY);
        expect(incrRes).toBe(-1);
        const finalGet = await puter.kv.get(TEST_KEY);
        expect(finalGet).toBe(-1);
    })

    it('should increment a key with second argument', async () => {
        await puter.kv.set(TEST_KEY, 0);
        const incrRes = await puter.kv.incr(TEST_KEY, 2);
        expect(incrRes).toBe(2);
        const finalGet = await puter.kv.get(TEST_KEY);
        expect(finalGet).toBe(2);
    })

    it('should decrement a key with second argument', async () => {
        await puter.kv.set(TEST_KEY, 0);
        const incrRes = await puter.kv.decr(TEST_KEY, 3);
        expect(incrRes).toBe(-3);
        const finalGet = await puter.kv.get(TEST_KEY);
        expect(finalGet).toBe(-3);
    })

    it('should increment a key with nested path', async () => {
        await puter.kv.set(TEST_KEY, { a: { b: 0 } });
        const incrRes = await puter.kv.incr(TEST_KEY, { 'a.b': 1 });
        expect(incrRes).toEqual({ a: { b: 1 } });
        const finalGet = await puter.kv.get(TEST_KEY);
        expect(finalGet).toEqual({ a: { b: 1 } });
    })

    it('should decrement a key with nested path', async () => {
        await puter.kv.set(TEST_KEY, { a: { b: 0 } });
        const incrRes = await puter.kv.decr(TEST_KEY, { 'a.b': 1 });
        expect(incrRes).toEqual({ a: { b: -1 } });
        const finalGet = await puter.kv.get(TEST_KEY);
        expect(finalGet).toEqual({ a: { b: -1 } });
    })

    it('should increment a nonexistent key with nested path', async () => {
        const incrRes = await puter.kv.incr(TEST_KEY + 1, { 'a.b': 1 });
        expect(incrRes).toEqual({ a: { b: 1 } });
        const finalGet = await puter.kv.get(TEST_KEY + 1);
        expect(finalGet).toEqual({ a: { b: 1 } });
    })

    it('should decrement a nonexistent key with nested path', async () => {
        const incrRes = await puter.kv.decr(TEST_KEY + 2, { 'a.b': 1 });
        expect(incrRes).toEqual({ a: { b: -1 } });
        const finalGet = await puter.kv.get(TEST_KEY + 2);
        expect(finalGet).toEqual({ a: { b: -1 } });
    })

    it('should list keys', async () => {
        const listRes = await puter.kv.list();
        expect(Array.isArray(listRes)).toBe(true);
        expect(listRes.length).toBeGreaterThan(0);
        expect((listRes as string[]).includes(TEST_KEY)).toBe(true);
    });
    // delete ops should go last
    it('should flush all keys', async () => {
        const flushRes = await puter.kv.flush()
        expect(flushRes).toBe(true);
        const postFlushList = await puter.kv.list();
        expect(Array.isArray(postFlushList)).toBe(true);
        expect(postFlushList.length).toBe(0);
    });
    it('should delete a key success', async () => {
        const setRes = await puter.kv.set(TEST_KEY, 'to-be-deleted');
        expect(setRes).toBe(true);
        const delRes = await puter.kv.del(TEST_KEY);
        expect(delRes).toBe(true);
        const getRes = await puter.kv.get(TEST_KEY);
        expect(getRes).toBeNull();
    });
});