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

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PuterServer } from '../../server.ts';
import { setupTestServer } from '../../testUtil.ts';

describe('CacheReplicationService', () => {
    let server: PuterServer;

    beforeAll(async () => {
        server = await setupTestServer();
    });

    afterAll(async () => {
        await server?.shutdown();
    });

    const emitRemote = (cacheKey: unknown) =>
        server.clients.event.emitAndWait(
            'outer.cacheUpdate',
            { cacheKey } as { cacheKey: string[] },
            { from_outside: true },
        );

    it('drops keys a peer region invalidated', async () => {
        const key = `cacherepl-${uuidv4()}`;
        await server.clients.redis.set(key, 'stale');

        await emitRemote([key]);

        expect(await server.clients.redis.get(key)).toBeNull();
    });

    it('ignores a locally-emitted update, which already applied itself', async () => {
        const key = `cacherepl-${uuidv4()}`;
        await server.clients.redis.set(key, 'fresh');

        await server.clients.event.emitAndWait(
            'outer.cacheUpdate',
            { cacheKey: [key] },
            {},
        );

        expect(await server.clients.redis.get(key)).toBe('fresh');
    });

    it('deletes rather than adopting the sender payload', async () => {
        const key = `cacherepl-${uuidv4()}`;
        await server.clients.redis.set(key, 'ours');

        await server.clients.event.emitAndWait(
            'outer.cacheUpdate',
            { cacheKey: [key], data: 'theirs', ttlSeconds: 60 } as never,
            { from_outside: true },
        );

        // Their value came from their own replica; force a local re-read.
        expect(await server.clients.redis.get(key)).toBeNull();
    });

    it('survives a malformed payload', async () => {
        await expect(emitRemote('not-an-array')).resolves.not.toThrow();
        await expect(emitRemote([123, '', null])).resolves.not.toThrow();
        await expect(emitRemote(undefined)).resolves.not.toThrow();
    });
});
