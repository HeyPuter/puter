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
 * feedback loop. The second is that a leave really is a compare-and-set
 * against the region's own item: every removal depends on the `connectedAt`
 * that was read, and that is the whole of what keeps a reconnect from being
 * erased by a repair that read the row before it.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
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
    it('is created by the first region to claim it', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);

        expect(await presence().read(userUuid(), appUid())).toEqual({
            regions: { west: 11 },
        });
    });

    it('reads as empty when nobody has ever claimed it', async () => {
        expect(await presence().read(userUuid(), appUid())).toEqual({
            regions: {},
        });
    });

    it('keeps both regions when two claim it — each writes only its own item', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        await presence().join(userUuid(), appUid(), 'east', 22);

        expect(await presence().read(userUuid(), appUid())).toEqual({
            regions: { west: 11, east: 22 },
        });
    });

    it('takes one region out and leaves the other where it was', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        await presence().join(userUuid(), appUid(), 'east', 22);

        expect(
            await presence().leave(userUuid(), appUid(), 'east', 22),
        ).toBe(true);
        expect(await presence().read(userUuid(), appUid())).toEqual({
            regions: { west: 11 },
        });
    });

    it('refuses a removal that read the region before it moved', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        // The socket comes back in that region while the removal is deciding
        // — a fresh item with a new `connectedAt`.
        await presence().join(userUuid(), appUid(), 'west', 33);

        expect(
            await presence().leave(userUuid(), appUid(), 'west', 11),
        ).toBe(false);
        expect(
            (await presence().read(userUuid(), appUid())).regions,
        ).toEqual({ west: 33 });
    });

    it('does not count a retired region while its item is still in the table', async () => {
        // A leave rolls the item's `ttl` into the past rather than deleting
        // it, so the row has to exclude it itself — the table's own sweep runs
        // on nobody's schedule.
        await presence().join(userUuid(), appUid(), 'west', 11);
        await presence().leave(userUuid(), appUid(), 'west', 11);

        expect((await presence().read(userUuid(), appUid())).regions).toEqual(
            {},
        );
        // And the region comes back cleanly on top of the retired item.
        await presence().join(userUuid(), appUid(), 'west', 44);
        expect((await presence().read(userUuid(), appUid())).regions).toEqual({
            west: 44,
        });
    });

    it('keeps one app`s regions out of another whose uid it prefixes', async () => {
        // The prefix a read queries ends in the same separator the key does,
        // so `app-1` cannot pick up `app-10`.
        const shorter = `${appUid()}-1`;
        const longer = `${appUid()}-10`;
        await presence().join(userUuid(), shorter, 'west', 11);
        await presence().join(userUuid(), longer, 'east', 22);

        expect((await presence().read(userUuid(), shorter)).regions).toEqual({
            west: 11,
        });
        expect((await presence().read(userUuid(), longer)).regions).toEqual({
            east: 22,
        });
    });

    it('refuses a removal against an item that does not exist', async () => {
        expect(
            await presence().leave(userUuid(), appUid(), 'west', 0),
        ).toBe(false);
    });

    it('says nothing on the event bus — not a mutation, not an invalidation', async () => {
        await presence().join(userUuid(), appUid(), 'west', 11);
        await presence().leave(userUuid(), appUid(), 'west', 11);

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
            { key: presenceItemKey(userUuid(), appUid(), 'west') },
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

describe('the join pin', () => {
    it('is claimed once and refused on a second attempt', async () => {
        expect(
            await presence().acquireJoinPin(seq, appUid()),
        ).toBe(true);
        expect(
            await presence().acquireJoinPin(seq, appUid()),
        ).toBe(false);
    });

    it('is claimable again once released', async () => {
        await presence().acquireJoinPin(seq, appUid());
        await presence().releaseJoinPin(seq, appUid());

        expect(
            await presence().acquireJoinPin(seq, appUid()),
        ).toBe(true);
    });

    it('keeps each (user, app) pair on its own pin', async () => {
        await presence().acquireJoinPin(seq, appUid());

        expect(
            await presence().acquireJoinPin(seq, `${appUid()}-other`),
        ).toBe(true);
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

    it('survives a touch, which only ever refreshes an existing count', async () => {
        const store = presence();
        await store.addConnection(seq, appUid());

        await store.touchConnection(seq, appUid());

        expect(await store.holdsConnection(seq, appUid())).toBe(true);
    });

    it('does nothing when there is nothing to touch', async () => {
        // Self-hosted and no-peer deployments never write the counter at all;
        // touching one that was never created must not create it.
        const store = presence();
        await store.touchConnection(seq, appUid());

        expect(await store.holdsConnection(seq, appUid())).toBe(false);
    });
});

describe('the presence generation', () => {
    it('moves on every transition, so nothing cached under the old one is used', async () => {
        const first = await presence().bumpGeneration(seq);
        const second = await presence().bumpGeneration(seq);

        expect(second).toBeGreaterThan(first);
    });
});

describe('a touch`s item refresh', () => {
    // `vi.spyOn` reuses one mock across repeated calls on the same method,
    // so a spy created in an earlier test would otherwise keep counting calls
    // made by tests after it.
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not write the table on a touch that loses the refresh claim', async () => {
        const store = presence();
        const uuid = userUuid();
        const app = appUid();
        await store.join(uuid, app, 'west', 11);
        // First touch in the window wins the claim and writes.
        await store.touchConnection(seq, app, { userUuid: uuid, region: 'west' });

        const spy = vi.spyOn(server.stores.kv, 'refreshReservedItem');
        // Same window, same pair-region — the claim is already spent.
        await store.touchConnection(seq, app, { userUuid: uuid, region: 'west' });

        expect(spy).not.toHaveBeenCalled();
    });

    it('writes once and extends ttl on the first touch to win the claim', async () => {
        const store = presence();
        const uuid = userUuid();
        const app = appUid();
        const key = presenceItemKey(uuid, app, 'west');
        // An item close to aging out, standing in for one the claim window
        // last renewed a long time ago.
        await server.stores.kv.putReservedItem(key, {
            connectedAt: 11,
            ttl: Math.floor(Date.now() / 1000) + 60,
        });

        const spy = vi.spyOn(server.stores.kv, 'refreshReservedItem');
        await store.touchConnection(seq, app, { userUuid: uuid, region: 'west' });

        expect(spy).toHaveBeenCalledTimes(1);
        const item = await server.stores.kv.getReservedItem<{ ttl: number }>(
            key,
        );
        expect(item!.ttl).toBeGreaterThan(
            Math.floor(Date.now() / 1000) + 60 * 60,
        );
    });

    it('brings a retired item back into the row', async () => {
        const store = presence();
        const uuid = userUuid();
        const app = appUid();
        await store.join(uuid, app, 'west', 11);
        // Rolls `ttl` into the past — the same state the non-peer prune and a
        // stale `leave` both leave behind on a socket that never disconnected.
        await store.leave(uuid, app, 'west', 11);

        await store.touchConnection(seq, app, { userUuid: uuid, region: 'west' });

        expect((await store.read(uuid, app)).regions.west).toBeDefined();
    });

    it('creates the item from nothing, stamped with a fresh connectedAt', async () => {
        const store = presence();
        const uuid = userUuid();
        const app = appUid();
        // No join at all — the same state a real TTL sweep eventually leaves.

        const before = Date.now();
        await store.touchConnection(seq, app, { userUuid: uuid, region: 'west' });
        const after = Date.now();

        const item = await server.stores.kv.getReservedItem<{
            connectedAt: number;
        }>(presenceItemKey(uuid, app, 'west'));
        expect(item!.connectedAt).toBeGreaterThanOrEqual(before);
        expect(item!.connectedAt).toBeLessThanOrEqual(after);
    });

    it('preserves a live item`s connectedAt', async () => {
        const store = presence();
        const uuid = userUuid();
        const app = appUid();
        await store.join(uuid, app, 'west', 11);

        await store.touchConnection(seq, app, { userUuid: uuid, region: 'west' });

        expect((await store.read(uuid, app)).regions).toEqual({ west: 11 });
    });

    it('hands the claim back when the write fails, so the next touch retries', async () => {
        // Otherwise one failed write costs the whole refresh window, and a
        // persistent failure costs every window the item has left.
        const store = presence();
        const uuid = userUuid();
        const app = appUid();
        await store.join(uuid, app, 'west', 11);

        const failing = vi
            .spyOn(server.stores.kv, 'refreshReservedItem')
            .mockRejectedValueOnce(new Error('table refused the write'));
        await expect(
            store.touchConnection(seq, app, { userUuid: uuid, region: 'west' }),
        ).rejects.toThrow('table refused the write');
        failing.mockRestore();

        const retry = vi.spyOn(server.stores.kv, 'refreshReservedItem');
        await store.touchConnection(seq, app, { userUuid: uuid, region: 'west' });

        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there is no claim to try — the two-arg form', async () => {
        // The socket renew timer's own call site: no peer regions configured,
        // so nothing here should ever ask for the item refresh.
        const store = presence();
        const spy = vi.spyOn(server.stores.kv, 'refreshReservedItem');

        await store.touchConnection(seq, appUid());

        expect(spy).not.toHaveBeenCalled();
    });
});
