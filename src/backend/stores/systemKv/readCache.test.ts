import { describe, expect, it } from 'vitest';
import type { IConfig } from '../../types.ts';
import {
    cacheTtlSecondsFor,
    decodeCachedRead,
    encodeCachedHit,
    encodeCachedMiss,
    kvCacheKey,
    KV_CACHE_BLOCK_MARKER,
    resolveKvCacheSettings,
} from './readCache.ts';

const settings = (overrides: Partial<IConfig['kvCache']> = {}) =>
    resolveKvCacheSettings({
        kvCache: { enabled: true, ...overrides },
    } as IConfig);

describe('kv readCache', () => {
    describe('resolveKvCacheSettings', () => {
        it('is off when no config is present', () => {
            const resolved = resolveKvCacheSettings({} as IConfig);
            expect(resolved.enabled).toBe(false);
        });

        it('is off unless `enabled` is exactly true', () => {
            const resolved = resolveKvCacheSettings({
                kvCache: { enabled: 1 as unknown as boolean },
            } as IConfig);
            expect(resolved.enabled).toBe(false);
        });

        it('falls back to defaults for nonsense values', () => {
            const resolved = settings({
                ttlSeconds: -5,
                missTtlSeconds: 0,
                maxEntryBytes: Number.NaN,
            });
            expect(resolved.ttlSeconds).toBe(60);
            expect(resolved.missTtlSeconds).toBe(10);
            expect(resolved.maxEntryBytes).toBe(32 * 1024);
        });

        it('keeps a zero coalescing window, which means broadcast immediately', () => {
            expect(
                settings({ broadcastCoalesceMs: 0 }).broadcastCoalesceMs,
            ).toBe(0);
        });
    });

    describe('kvCacheKey', () => {
        it('keeps the namespace readable and hashes the caller key', () => {
            const key = kvCacheKey('v1:user-1:app-1', 'some/entry');
            expect(key.startsWith('kvc:v1:v1:user-1:app-1:')).toBe(true);
            expect(key).not.toContain('some/entry');
        });

        it('is stable for the same pair and distinct across keys', () => {
            expect(kvCacheKey('ns', 'a')).toBe(kvCacheKey('ns', 'a'));
            expect(kvCacheKey('ns', 'a')).not.toBe(kvCacheKey('ns', 'b'));
            expect(kvCacheKey('ns', 'a')).not.toBe(kvCacheKey('other', 'a'));
        });

        it('stays short for a key at the KV size limit', () => {
            const key = kvCacheKey('v1:user-1:app-1', 'k'.repeat(1024));
            expect(key.length).toBeLessThan(128);
        });
    });

    describe('envelopes', () => {
        it('round-trips a value', () => {
            const raw = encodeCachedHit(
                { key: 'k', value: { nested: [1, 2] } },
                0.5,
            );
            expect(decodeCachedRead(raw, 'k')).toEqual({
                state: 'hit',
                item: { key: 'k', value: { nested: [1, 2] } },
                readUnits: 0.5,
            });
        });

        it('round-trips the expiry and the private flag', () => {
            const raw = encodeCachedHit(
                { key: 'k', value: 'v', ttl: 1234, noShare: true },
                1,
            );
            expect(decodeCachedRead(raw, 'k')).toEqual({
                state: 'hit',
                item: { key: 'k', value: 'v', ttl: 1234, noShare: true },
                readUnits: 1,
            });
        });

        it('keeps a stored null distinguishable from a cached absence', () => {
            const hit = decodeCachedRead(
                encodeCachedHit({ key: 'k', value: null }, 0.5),
                'k',
            );
            const miss = decodeCachedRead(encodeCachedMiss(0.5), 'k');
            expect(hit).toMatchObject({ state: 'hit' });
            expect(miss).toMatchObject({ state: 'miss', readUnits: 0.5 });
        });

        it('reads the block marker as blocked', () => {
            expect(decodeCachedRead(KV_CACHE_BLOCK_MARKER, 'k')).toEqual({
                state: 'blocked',
            });
        });

        it('treats nothing cached, junk, and a foreign shape alike', () => {
            for (const raw of [
                null,
                undefined,
                '',
                'not json',
                '[]',
                '{"z":1}',
            ]) {
                expect(decodeCachedRead(raw, 'k')).toEqual({ state: 'absent' });
            }
        });
    });

    describe('cacheTtlSecondsFor', () => {
        const now = 1_000_000;

        it('uses the cache window for an entry with no expiry', () => {
            expect(cacheTtlSecondsFor(settings(), undefined, now)).toBe(60);
        });

        it('never outlives the entry it caches', () => {
            expect(cacheTtlSecondsFor(settings(), now + 5, now)).toBe(5);
        });

        it('keeps the cache window when the entry outlives it', () => {
            expect(cacheTtlSecondsFor(settings(), now + 3600, now)).toBe(60);
        });

        it('refuses to cache an entry that has already lapsed', () => {
            expect(cacheTtlSecondsFor(settings(), now - 1, now)).toBeNull();
            expect(cacheTtlSecondsFor(settings(), now, now)).toBeNull();
        });
    });
});
