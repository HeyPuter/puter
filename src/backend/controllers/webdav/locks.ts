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

import { randomUUID } from 'node:crypto';
import { posix as pathPosix } from 'node:path';
import type { Cluster } from 'ioredis';

/**
 * Redis-backed WebDAV lock store.
 *
 * Two key families: `dav:lock:<token>` → JSON `{ path, lockScope, lockType }`
 * (per-token metadata) `dav:locks:<path>` → JSON `{ <token>: { lockScope,
 * lockType, expiresAt }, ... }` (per-path map)
 *
 * Each token key expires with its own lock; the path map lives as long as its
 * longest-lived entry, and expired entries in it are ignored.
 */

export const MAX_LOCK_TIMEOUT_SECONDS = 3600;
const LOCK_PREFIX = 'dav:lock:';
const LOCKS_PREFIX = 'dav:locks:';

export interface LockInfo {
    lockToken: string;
    lockScope: 'exclusive' | 'shared';
    lockType: 'write';
    path: string;
}

interface PathLockEntry {
    lockScope: 'exclusive' | 'shared';
    lockType: 'write';
    /** Epoch ms. */
    expiresAt: number;
}

type PathLockMap = Record<string, PathLockEntry>;

/**
 * Lock timeout to grant for a `Timeout` request header (RFC 4918 §10.7): the
 * first `Second-N` entry, capped at the max. `Infinite` or no usable entry gets
 * the max.
 */
export function parseLockTimeout(header: string | undefined): number {
    for (const part of (header ?? '').split(',')) {
        const match = part.trim().match(/^Second-(\d+)$/i);
        if (!match) continue;
        const seconds = Number(match[1]);
        return Math.min(Math.max(seconds, 1), MAX_LOCK_TIMEOUT_SECONDS);
    }
    return MAX_LOCK_TIMEOUT_SECONDS;
}

export async function createLock(
    redis: Cluster,
    filePath: string,
    lockScope: 'exclusive' | 'shared',
    timeoutSeconds: number = MAX_LOCK_TIMEOUT_SECONDS,
): Promise<string> {
    const lockToken = `urn:uuid:${randomUUID()}`;
    const lockType = 'write';
    const meta = JSON.stringify({ path: filePath, lockScope, lockType });

    // Per-token metadata
    await redis.set(`${LOCK_PREFIX}${lockToken}`, meta, 'EX', timeoutSeconds);

    // Per-path map — merge with any existing locks on this path
    const pathMap = await getPathLockMap(redis, filePath);
    pathMap[lockToken] = {
        lockScope,
        lockType,
        expiresAt: Date.now() + timeoutSeconds * 1000,
    };
    await writePathLockMap(redis, filePath, pathMap);

    return lockToken;
}

export async function deleteLock(
    redis: Cluster,
    lockToken: string,
): Promise<void> {
    const raw = await redis.get(`${LOCK_PREFIX}${lockToken}`);
    if (raw) {
        const meta = JSON.parse(raw) as { path: string };
        const pathMap = await getPathLockMap(redis, meta.path);
        delete pathMap[lockToken];
        await writePathLockMap(redis, meta.path, pathMap);
    }
    await redis.del(`${LOCK_PREFIX}${lockToken}`);
}

export async function refreshLock(
    redis: Cluster,
    lockToken: string,
    timeoutSeconds: number = MAX_LOCK_TIMEOUT_SECONDS,
): Promise<boolean> {
    const raw = await redis.get(`${LOCK_PREFIX}${lockToken}`);
    if (!raw) return false;
    const meta = JSON.parse(raw) as {
        path: string;
        lockScope: 'exclusive' | 'shared';
        lockType: 'write';
    };

    await redis.set(`${LOCK_PREFIX}${lockToken}`, raw, 'EX', timeoutSeconds);

    // Re-add the entry even if the path map expired, so the lock keeps
    // blocking other writers.
    const pathMap = await getPathLockMap(redis, meta.path);
    pathMap[lockToken] = {
        lockScope: meta.lockScope,
        lockType: meta.lockType,
        expiresAt: Date.now() + timeoutSeconds * 1000,
    };
    await writePathLockMap(redis, meta.path, pathMap);
    return true;
}

/**
 * Get all active locks on a path, including inherited locks from ancestor
 * directories.
 */
export async function getFileLocks(
    redis: Cluster,
    filePath: string,
): Promise<LockInfo[]> {
    const results: LockInfo[] = [];
    // Walk up the path hierarchy
    let current = filePath;
    for (;;) {
        const map = await getPathLockMap(redis, current);
        for (const [token, info] of Object.entries(map)) {
            results.push({
                lockToken: token,
                lockScope: info.lockScope,
                lockType: info.lockType,
                path: current,
            });
        }
        if (current === '/') break;
        current = pathPosix.dirname(current);
    }
    return results;
}

/** Verify a lock token is still valid and return its metadata. */
export async function getLockIfValid(
    redis: Cluster,
    lockToken: string,
): Promise<LockInfo | null> {
    const raw = await redis.get(`${LOCK_PREFIX}${lockToken}`);
    if (!raw) return null;
    const meta = JSON.parse(raw) as {
        path: string;
        lockScope: 'exclusive' | 'shared';
        lockType: 'write';
    };
    return { lockToken, ...meta };
}

/**
 * Check whether the caller has write permission under WebDAV locking rules.
 * Returns true if the write is allowed.
 */
export async function hasWritePermission(
    redis: Cluster,
    filePath: string,
    headerLockToken: string | null,
): Promise<boolean> {
    const locks = await getFileLocks(redis, filePath);
    if (locks.length === 0) return true; // no locks → allowed
    if (!headerLockToken) return false; // locks exist but no token → denied

    // Verify the provided token
    const myLock = await getLockIfValid(redis, headerLockToken);
    if (!myLock) return false; // token expired or invalid

    // Token's path must match or be an ancestor of the target
    if (!isSameOrDescendant(filePath, myLock.path)) return false;

    // Check lock scope rules
    for (const lock of locks) {
        if (lock.lockToken === headerLockToken) continue; // skip our own lock
        if (lock.lockScope === 'exclusive') return false; // blocked by another exclusive
    }
    return true;
}

// -- Internals -------------------------------------------------------

function isSameOrDescendant(filePath: string, ancestor: string): boolean {
    if (filePath === ancestor) return true;
    const prefix = ancestor.endsWith('/') ? ancestor : `${ancestor}/`;
    return filePath.startsWith(prefix);
}

/** The path's lock map with already-expired entries dropped. */
async function getPathLockMap(
    redis: Cluster,
    filePath: string,
): Promise<PathLockMap> {
    const raw = await redis.get(`${LOCKS_PREFIX}${filePath}`);
    if (!raw) return {};
    let map: PathLockMap;
    try {
        map = JSON.parse(raw) as PathLockMap;
    } catch {
        return {};
    }
    const now = Date.now();
    for (const [token, entry] of Object.entries(map)) {
        // Entries without expiresAt predate per-entry expiry; refreshLock
        // re-adds live ones.
        if (!(entry.expiresAt > now)) {
            delete map[token];
        }
    }
    return map;
}

/** Store the map with a TTL covering its longest-lived entry, or drop it. */
async function writePathLockMap(
    redis: Cluster,
    filePath: string,
    map: PathLockMap,
): Promise<void> {
    const key = `${LOCKS_PREFIX}${filePath}`;
    if (Object.keys(map).length === 0) {
        await redis.del(key);
        return;
    }
    const now = Date.now();
    const latest = Math.max(...Object.values(map).map((e) => e.expiresAt));
    const ttlSeconds = Math.max(1, Math.ceil((latest - now) / 1000));
    await redis.set(key, JSON.stringify(map), 'EX', ttlSeconds);
}

/**
 * Extract a lock token from the `If` or `Lock-Token` header. Formats:
 * `(<urn:uuid:...>)` or `<urn:uuid:...>` or just `urn:uuid:...`
 */
export function extractLockToken(header: string | undefined): string | null {
    if (!header) return null;
    const match = header.match(/<?(urn:uuid:[0-9a-fA-F-]{36})>?/);
    return match?.[1] ?? null;
}
