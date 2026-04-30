import { randomUUID } from 'node:crypto';
import { posix as pathPosix } from 'node:path';
import type { Cluster } from 'ioredis';

/**
 * Redis-backed WebDAV lock store.
 *
 * Two key families:
 *   `dav:lock:<token>` → JSON `{ path, lockScope, lockType }` (per-token metadata)
 *   `dav:locks:<path>` → JSON `{ <token>: { lockScope, lockType }, ... }` (per-path map)
 *
 * Both keys share the same TTL so they expire together.
 */

const DAV_LOCK_TTL_SECONDS = 30;
const LOCK_PREFIX = 'dav:lock:';
const LOCKS_PREFIX = 'dav:locks:';

export interface LockInfo {
    lockToken: string;
    lockScope: 'exclusive' | 'shared';
    lockType: 'write';
    path: string;
}

export async function createLock(
    redis: Cluster,
    filePath: string,
    lockScope: 'exclusive' | 'shared',
    lockType: 'write' = 'write',
): Promise<string> {
    const lockToken = `urn:uuid:${randomUUID()}`;
    const meta = JSON.stringify({ path: filePath, lockScope, lockType });

    // Per-token metadata
    await redis.set(
        `${LOCK_PREFIX}${lockToken}`,
        meta,
        'EX',
        DAV_LOCK_TTL_SECONDS,
    );

    // Per-path map — merge with any existing locks on this path
    const existing = await getPathLockMap(redis, filePath);
    existing[lockToken] = { lockScope, lockType };
    await redis.set(
        `${LOCKS_PREFIX}${filePath}`,
        JSON.stringify(existing),
        'EX',
        DAV_LOCK_TTL_SECONDS,
    );

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
        if (Object.keys(pathMap).length === 0) {
            await redis.del(`${LOCKS_PREFIX}${meta.path}`);
        } else {
            await redis.set(
                `${LOCKS_PREFIX}${meta.path}`,
                JSON.stringify(pathMap),
                'EX',
                DAV_LOCK_TTL_SECONDS,
            );
        }
    }
    await redis.del(`${LOCK_PREFIX}${lockToken}`);
}

export async function refreshLock(
    redis: Cluster,
    lockToken: string,
): Promise<boolean> {
    const raw = await redis.get(`${LOCK_PREFIX}${lockToken}`);
    if (!raw) return false;
    const meta = JSON.parse(raw) as { path: string };

    // Re-set with fresh TTL
    await redis.set(
        `${LOCK_PREFIX}${lockToken}`,
        raw,
        'EX',
        DAV_LOCK_TTL_SECONDS,
    );
    // Refresh the path map TTL too
    const pathRaw = await redis.get(`${LOCKS_PREFIX}${meta.path}`);
    if (pathRaw) {
        await redis.set(
            `${LOCKS_PREFIX}${meta.path}`,
            pathRaw,
            'EX',
            DAV_LOCK_TTL_SECONDS,
        );
    }
    return true;
}

/**
 * Get all active locks on a path, including inherited locks from
 * ancestor directories.
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
                lockScope: (info as { lockScope: 'exclusive' | 'shared' })
                    .lockScope,
                lockType: (info as { lockType: 'write' }).lockType,
                path: current,
            });
        }
        if (current === '/') break;
        current = pathPosix.dirname(current);
    }
    return results;
}

/**
 * Verify a lock token is still valid and return its metadata.
 */
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
 * Check whether the caller has write permission under WebDAV locking
 * rules. Returns true if the write is allowed.
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
    if (!filePath.startsWith(myLock.path) && myLock.path !== filePath) {
        return false;
    }

    // Check lock scope rules
    for (const lock of locks) {
        if (lock.lockToken === headerLockToken) continue; // skip our own lock
        if (lock.lockScope === 'exclusive') return false; // blocked by another exclusive
    }
    return true;
}

// ── Internals ───────────────────────────────────────────────────────

async function getPathLockMap(
    redis: Cluster,
    filePath: string,
): Promise<Record<string, { lockScope: string; lockType: string }>> {
    const raw = await redis.get(`${LOCKS_PREFIX}${filePath}`);
    if (!raw) return {};
    try {
        return JSON.parse(raw) as Record<
            string,
            { lockScope: string; lockType: string }
        >;
    } catch {
        return {};
    }
}

/**
 * Extract a lock token from the `If` or `Lock-Token` header.
 * Formats: `(<urn:uuid:...>)` or `<urn:uuid:...>` or just `urn:uuid:...`
 */
export function extractLockToken(header: string | undefined): string | null {
    if (!header) return null;
    const match = header.match(/<?(urn:uuid:[0-9a-fA-F-]{36})>?/);
    return match?.[1] ?? null;
}
