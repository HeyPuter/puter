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

/**
 * Presence rows against the real table.
 *
 * Two things are on the hook. The first is that these rows go in through the
 * direct item path and nothing else: they are not a user's data, so nothing
 * about them may be metered, listed, cached, invalidated, or announced as a
 * key-value change — a subscription firing on a presence write would be a
 * feedback loop. The second is that the version really is a compare-and-set:
 * every write but the first depends on it, and that is the whole of what keeps
 * a reconnect from being erased by a repair that read the row before it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestServer } from '../../testUtil.js';
import type { PuterServer } from '../../server.js';
import type { IConfig } from '../../types.js';
import { presenceItemKey } from './PresenceStore.js';

const BOOT_TIMEOUT_MS = 120_000;

let server: PuterServer;
let emitted: string[];
let seq = 0;

const presence = () => server.stores.presence;
const userUuid = () => `presence-user-${seq}`;
const appUid = () => `presence-app-${seq}`;

beforeAll(async () => {
    server = await setupTestServer({ events: { enabled: true } } as IConfig);
}, BOOT_TIMEOUT_MS);

beforeEach(() => {
    seq++;
    emitted = [];
    vi.spyOn(server.clients.event, 'emit').mockImplementation(((
        key: string,
        ...rest: unknown[]
    ) => {
        emitted.push(key);
        return (
            server.clients.event.constructor.prototype.emit as never
        ) as never;
    }) as never);
});

afterAll(async () => {
    vi.restoreAllMocks();
    await server?.shutdown();
});

describe('a presence row', () => {
    it('is created by the first region to claim it, and read back whole', async () => {
        const version = await presence().join(userUuid(), appUid(), 'west', 11);

        expect(version).toBe(1);
        expect(await presence().read(userUuid(), appUid())).toEqual({
            regions: { west: 11 },
            version: 1,
        });
    });

    it('reads as empty when nobody has ever claimed it', async () => {
        expect(await presence().read(userUuid(), appUid())).toEqual({
            regions: {},
            version: 0,
        });
    });

    it('keeps both regions when two claim it, and moves the version each time', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        await presence().join(userUuid(), appUid(), 'east', 22);

        expect(await presence().read(userUuid(), appUid())).toEqual({
            regions: { west: 11, east: 22 },
            version: 2,
        });
    });

    it('takes one region out and leaves the other where it was', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        await presence().join(userUuid(), appUid(), 'east', 22);
        const row = await presence().read(userUuid(), appUid());

        expect(
            await presence().leave(userUuid(), appUid(), 'east', row.version),
        ).toBe(true);
        expect(await presence().read(userUuid(), appUid())).toEqual({
            regions: { west: 11 },
            version: 3,
        });
    });

    it('refuses a removal that read the row before it moved', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        const stale = await presence().read(userUuid(), appUid());
        // The socket comes back in that region while the removal is deciding.
        await presence().join(userUuid(), appUid(), 'west', 33);

        expect(
            await presence().leave(userUuid(), appUid(), 'west', stale.version),
        ).toBe(false);
        expect(
            (await presence().read(userUuid(), appUid())).regions,
        ).toEqual({ west: 33 });
    });

    it('refuses a removal against a row that does not exist', async () => {
        expect(
            await presence().leave(userUuid(), appUid(), 'west', 0),
        ).toBe(false);
    });

    it('says nothing on the event bus — not a mutation, not an invalidation', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        const row = await presence().read(userUuid(), appUid());
        await presence().leave(userUuid(), appUid(), 'west', row.version);

        expect(emitted).not.toContain('kv.mutated');
        expect(emitted).not.toContain('kv.flushed');
        expect(emitted).not.toContain('outer.kv.cacheInvalidated');
    });

    it('cannot be reached through the key-value surface', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        const actor = {
            user: { id: 1, uuid: userUuid(), username: 'presence' },
            app: { uid: appUid() },
            effectiveApp: { uid: appUid() },
        };

        const read = await server.stores.kv.get(
            { key: presenceItemKey(userUuid(), appUid()) },
            { actor: actor as never },
        );
        expect(read.res).toBeNull();

        const listed = await server.stores.kv.list(
            {},
            { actor: actor as never },
        );
        expect(JSON.stringify(listed.res)).not.toContain('pr#');
    });
});

describe('this region`s connection count', () => {
    it('crosses zero once, however many connections come and go', async () => {
        const store = presence();
        expect(await store.addConnection(seq, appUid())).toBe(1);
        expect(await store.addConnection(seq, appUid())).toBe(2);
        expect(await store.addConnection(seq, appUid())).toBe(3);

        expect(await store.removeConnection(seq, appUid())).toBe(2);
        expect(await store.removeConnection(seq, appUid())).toBe(1);
        expect(await store.removeConnection(seq, appUid())).toBe(0);
    });

    it('keeps nothing behind once the last connection goes', async () => {
        const store = presence();
        await store.addConnection(seq, appUid());
        await store.removeConnection(seq, appUid());

        expect(await store.holdsConnection(seq, appUid())).toBe(false);
        // A double reap must not drive it below zero and hide the next connect.
        expect(await store.removeConnection(seq, appUid())).toBe(0);
        expect(await store.addConnection(seq, appUid())).toBe(1);
    });

    it('counts each app of one user separately', async () => {
        const store = presence();
        await store.addConnection(seq, appUid());

        expect(await store.holdsConnection(seq, `${appUid()}-other`)).toBe(
            false,
        );
        expect(await store.holdsConnection(seq, appUid())).toBe(true);
    });
});

describe('the presence generation', () => {
    it('moves on every transition, so nothing cached under the old one is used', async () => {
        const first = await presence().bumpGeneration(seq);
        const second = await presence().bumpGeneration(seq);

        expect(second).toBeGreaterThan(first);
    });
});
