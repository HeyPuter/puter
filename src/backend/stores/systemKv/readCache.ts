/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { createHash } from 'node:crypto';
import type { IConfig } from '../../types';

/**
 * Key/envelope format for the KV point-read cache.
 *
 * Bump the version segment when the envelope changes shape in a way an older
 * reader would misparse — entries written under the previous prefix become
 * unreachable and age out on their own expiry instead.
 */
const CACHE_KEY_PREFIX = 'kvc:v1';

/** An item as the KV store hands it back, which is what the cache round-trips. */
export interface KvCachedItem {
    key: string;
    value?: unknown;
    ttl?: number;
    noShare?: boolean;
}

/**
 * `miss` is a cached absence, as definitive as a hit. `absent` means nothing is
 * cached. `blocked` means a recent write left a marker: read through and don't
 * populate.
 */
export type KvCachedRead =
    | { state: 'hit'; item: KvCachedItem; readUnits: number }
    | { state: 'miss'; readUnits: number }
    | { state: 'blocked' }
    | { state: 'absent' };

/**
 * Wire envelope; single-letter fields since every byte is multiplied by entry
 * count.
 */
interface KvCacheEnvelope {
    /** 1 when the entry exists, 0 when known-absent. */
    h?: 0 | 1;
    v?: unknown;
    /** Entry expiry, epoch seconds. */
    t?: number;
    /** 1 when private to the app that wrote it. */
    p?: 1;
    /** Read units the uncached read consumed, replayed for billing. */
    u?: number;
    /** 1 on a write block marker; no other field is set. */
    b?: 1;
}

/**
 * Written over a key by every mutation instead of deleting it, so a read that
 * started before the write cannot repopulate (populates are `NX`) and peers
 * hold it across replication lag.
 */
export const KV_CACHE_BLOCK_MARKER = JSON.stringify({ b: 1 });

export interface KvCacheSettings {
    /** Off unless a config explicitly turns it on. */
    enabled: boolean;
    /** How long a cached entry is served for. */
    ttlSeconds: number;
    /** How long a cached absence is served for. */
    missTtlSeconds: number;
    /** How long after a write that key's reads bypass the cache entirely. */
    blockSeconds: number;
    /** Entries whose envelope exceeds this are read through, never cached. */
    maxEntryBytes: number;
    /**
     * How long invalidations accumulate before one cross-region broadcast
     * carries them all. 0 broadcasts each one as it happens.
     */
    broadcastCoalesceMs: number;
}

const positive = (value: unknown, fallback: number, min = 1): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.floor(parsed);
};

export const resolveKvCacheSettings = (config: IConfig): KvCacheSettings => {
    const cfg = config.kvCache ?? {};
    return {
        enabled: cfg.enabled === true,
        ttlSeconds: positive(cfg.ttlSeconds, 60),
        missTtlSeconds: positive(cfg.missTtlSeconds, 10),
        blockSeconds: positive(cfg.blockSeconds, 5),
        maxEntryBytes: positive(cfg.maxEntryBytes, 32 * 1024),
        broadcastCoalesceMs: positive(cfg.broadcastCoalesceMs, 250, 0),
    };
};

/**
 * Cache key for one entry. The caller's key is hashed rather than embedded: KV
 * keys run to 1KB of arbitrary bytes, and the digest keeps the cache key short,
 * bounded, and free of characters that would need escaping. The namespace stays
 * readable so an operator can tell whose entries they are looking at.
 */
export const kvCacheKey = (namespace: string, key: string): string => {
    const digest = createHash('sha1').update(key, 'utf8').digest('base64url');
    return `${CACHE_KEY_PREFIX}:${namespace}:${digest}`;
};

export const encodeCachedHit = (
    item: KvCachedItem,
    readUnits: number,
): string => {
    const envelope: KvCacheEnvelope = {
        h: 1,
        v: item.value ?? null,
        u: readUnits,
    };
    if (item.ttl !== undefined) envelope.t = item.ttl;
    if (item.noShare) envelope.p = 1;
    return JSON.stringify(envelope);
};

export const encodeCachedMiss = (readUnits: number): string =>
    JSON.stringify({ h: 0, u: readUnits } satisfies KvCacheEnvelope);

export const decodeCachedRead = (
    raw: string | null | undefined,
    key: string,
): KvCachedRead => {
    if (typeof raw !== 'string' || raw === '') return { state: 'absent' };

    let envelope: KvCacheEnvelope;
    try {
        envelope = JSON.parse(raw) as KvCacheEnvelope;
    } catch {
        // Someone else's key, or an entry from a format we no longer read.
        return { state: 'absent' };
    }
    if (!envelope || typeof envelope !== 'object') return { state: 'absent' };
    if (envelope.b === 1) return { state: 'blocked' };

    const readUnits = Number.isFinite(envelope.u) ? Number(envelope.u) : 0;
    if (envelope.h === 0) return { state: 'miss', readUnits };
    if (envelope.h !== 1) return { state: 'absent' };

    const item: KvCachedItem = { key, value: envelope.v ?? null };
    if (Number.isFinite(envelope.t)) item.ttl = Number(envelope.t);
    if (envelope.p === 1) item.noShare = true;
    return { state: 'hit', item, readUnits };
};

/**
 * Seconds to cache an entry for, or `null` when it shouldn't be cached at all.
 *
 * An entry with an expiry of its own never outlives it in the cache, so a `ttl`
 * shorter than the cache window still takes effect on the second.
 */
export const cacheTtlSecondsFor = (
    settings: KvCacheSettings,
    entryExpiresAt: number | undefined,
    nowSeconds: number,
): number | null => {
    if (entryExpiresAt === undefined) return settings.ttlSeconds;
    const remaining = Math.floor(entryExpiresAt - nowSeconds);
    if (remaining <= 0) return null;
    return Math.min(settings.ttlSeconds, remaining);
};
