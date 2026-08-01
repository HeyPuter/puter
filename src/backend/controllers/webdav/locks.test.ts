/**
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

import type { Cluster } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import {
    createLock,
    deleteLock,
    extractLockToken,
    getFileLocks,
    getLockIfValid,
    hasWritePermission,
    refreshLock,
} from './locks.js';

// The WebDAV lock store runs against the real (in-memory) redis client the
// server wires up — the same object `WebDAVController` hands these helpers.

let server: PuterServer;
let redis: Cluster;

beforeAll(async () => {
    server = await setupTestServer();
    redis = server.clients.redis as unknown as Cluster;
});

afterAll(async () => {
    await server?.shutdown();
});

const uniquePath = (suffix: string) =>
    `/locks-${Math.random().toString(36).slice(2, 10)}/${suffix}`;

describe('extractLockToken', () => {
    it('returns null when the header is absent', () => {
        expect(extractLockToken(undefined)).toBeNull();
    });

    it('returns null when the header holds no urn:uuid token', () => {
        expect(extractLockToken('(<opaquelocktoken:abc>)')).toBeNull();
    });

    const token = 'urn:uuid:6f1b2c34-5d6e-4f70-8901-23456789abcd';
    it.each([
        ['bare', token],
        ['angle-bracketed', `<${token}>`],
        ['If-header form', `(<${token}>)`],
        ['tagged If-header form', `</dir/file.txt> (<${token}>)`],
    ])('parses the %s', (_label, header) => {
        expect(extractLockToken(header)).toBe(token);
    });
});

describe('createLock / getLockIfValid', () => {
    it('mints a urn:uuid token that resolves back to its path and scope', async () => {
        const path = uniquePath('a.txt');
        const token = await createLock(redis, path, 'exclusive');
        expect(token).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);

        const lock = await getLockIfValid(redis, token);
        expect(lock).toEqual({
            lockToken: token,
            path,
            lockScope: 'exclusive',
            lockType: 'write',
        });
    });

    it('returns null for a token that was never issued', async () => {
        expect(
            await getLockIfValid(
                redis,
                'urn:uuid:00000000-0000-0000-0000-000000000000',
            ),
        ).toBeNull();
    });

    it('keeps several shared locks on one path in the same map', async () => {
        const path = uniquePath('shared.txt');
        const first = await createLock(redis, path, 'shared');
        const second = await createLock(redis, path, 'shared');

        const locks = await getFileLocks(redis, path);
        const onThisPath = locks.filter((lock) => lock.path === path);
        expect(onThisPath.map((lock) => lock.lockToken).sort()).toEqual(
            [first, second].sort(),
        );
        for (const lock of onThisPath) {
            expect(lock.lockScope).toBe('shared');
            expect(lock.lockType).toBe('write');
        }
    });
});

describe('getFileLocks inheritance', () => {
    it('reports a lock held on an ancestor directory', async () => {
        const dir = uniquePath('dir');
        const token = await createLock(redis, dir, 'exclusive');
        const locks = await getFileLocks(redis, `${dir}/child/grandchild.txt`);
        expect(locks.map((lock) => lock.lockToken)).toContain(token);
        expect(locks.find((lock) => lock.lockToken === token)?.path).toBe(dir);
    });

    it('reports no locks for an untouched path', async () => {
        expect(await getFileLocks(redis, uniquePath('quiet.txt'))).toEqual([]);
    });
});

describe('deleteLock', () => {
    it('drops the token and removes it from the path map', async () => {
        const path = uniquePath('drop.txt');
        const token = await createLock(redis, path, 'exclusive');
        await deleteLock(redis, token);

        expect(await getLockIfValid(redis, token)).toBeNull();
        expect(await getFileLocks(redis, path)).toEqual([]);
    });

    it('leaves sibling locks on the same path intact', async () => {
        const path = uniquePath('siblings.txt');
        const first = await createLock(redis, path, 'shared');
        const second = await createLock(redis, path, 'shared');
        await deleteLock(redis, first);

        const remaining = (await getFileLocks(redis, path)).filter(
            (lock) => lock.path === path,
        );
        expect(remaining.map((lock) => lock.lockToken)).toEqual([second]);
    });

    it('is a no-op for an unknown token', async () => {
        await expect(
            deleteLock(redis, 'urn:uuid:11111111-1111-1111-1111-111111111111'),
        ).resolves.toBeUndefined();
    });
});

describe('refreshLock', () => {
    it('returns true and keeps the lock resolvable', async () => {
        const path = uniquePath('refresh.txt');
        const token = await createLock(redis, path, 'exclusive');
        expect(await refreshLock(redis, token)).toBe(true);
        expect((await getLockIfValid(redis, token))?.path).toBe(path);
    });

    it('returns false once the token has expired', async () => {
        const path = uniquePath('expired.txt');
        const token = await createLock(redis, path, 'exclusive');
        // Simulate the TTL elapsing on the per-token key.
        await redis.del(`dav:lock:${token}`);
        expect(await refreshLock(redis, token)).toBe(false);
    });

    it('still refreshes when only the per-path map has expired', async () => {
        const path = uniquePath('half-expired.txt');
        const token = await createLock(redis, path, 'exclusive');
        await redis.del(`dav:locks:${path}`);
        expect(await refreshLock(redis, token)).toBe(true);
    });
});

describe('hasWritePermission', () => {
    it('allows a write to an unlocked path', async () => {
        expect(
            await hasWritePermission(redis, uniquePath('free.txt'), null),
        ).toBe(true);
    });

    it('denies a write to a locked path with no token', async () => {
        const path = uniquePath('locked.txt');
        await createLock(redis, path, 'exclusive');
        expect(await hasWritePermission(redis, path, null)).toBe(false);
    });

    it('allows the lock holder through with its own token', async () => {
        const path = uniquePath('holder.txt');
        const token = await createLock(redis, path, 'exclusive');
        expect(await hasWritePermission(redis, path, token)).toBe(true);
    });

    it('denies a token that has expired', async () => {
        const path = uniquePath('stale.txt');
        const token = await createLock(redis, path, 'exclusive');
        await redis.del(`dav:lock:${token}`);
        expect(await hasWritePermission(redis, path, token)).toBe(false);
    });

    it('denies a token issued for an unrelated path', async () => {
        const locked = uniquePath('target.txt');
        await createLock(redis, locked, 'exclusive');
        const elsewhere = await createLock(
            redis,
            uniquePath('elsewhere.txt'),
            'exclusive',
        );
        expect(await hasWritePermission(redis, locked, elsewhere)).toBe(false);
    });

    it("denies when another holder's exclusive lock also covers the path", async () => {
        const dir = uniquePath('conflict');
        const filePath = `${dir}/file.txt`;
        await createLock(redis, dir, 'exclusive');
        const ownToken = await createLock(redis, filePath, 'shared');
        // The caller's own shared lock is skipped, but the ancestor's
        // exclusive lock belongs to someone else and still blocks.
        expect(await hasWritePermission(redis, filePath, ownToken)).toBe(false);
    });

    it('allows a shared-lock holder past other shared locks', async () => {
        const path = uniquePath('shared-ok.txt');
        await createLock(redis, path, 'shared');
        const mine = await createLock(redis, path, 'shared');
        expect(await hasWritePermission(redis, path, mine)).toBe(true);
    });

    it('ignores a corrupt per-path lock map instead of throwing', async () => {
        const path = uniquePath('corrupt.txt');
        await redis.set(`dav:locks:${path}`, 'not-json');
        expect(await hasWritePermission(redis, path, null)).toBe(true);
    });
});
