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
 * Two deployments, one replicated table, and everything that has to hold
 * between them.
 *
 * Each has its own Redis — pending deliveries, leases and connection counts are
 * region-local by construction and nothing here replicates them — and shares
 * only the presence row, which is the whole of what one deployment tells
 * another. Peers are simulated the way the broadcast tests do it: the outbound
 * call is intercepted at the transport and handed straight to the other
 * instance, so both sides of every exchange are real code.
 */

import MockRedis from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { EventSubscriptionStore } from '../../stores/events/EventSubscriptionStore.js';
import { PendingDeliveryStore } from '../../stores/events/PendingDeliveryStore.js';
import {
    PresenceStore,
    presenceItemKey,
    PRESENCE_NO_APP,
} from '../../stores/events/PresenceStore.js';
import type {
    DurableSubscription,
    SubscriptionTarget,
} from '../../stores/events/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { IConfig } from '../../types.js';
import { EventForwardService } from './EventForwardService.js';
import { EventsService, type DeliveryEnvelope } from './EventsService.js';
import type { ForwardBatch, ForwardDelivery } from './forwardQueue.js';
import { fsAnchorToken } from './subjects.js';
import type {
    WorkerInvocation,
    WorkerInvocationOutcome,
} from './workerSeam.js';

// -- The replicated table --------------------------------------------
//
// One item per (pair, region) now, not one item with a `regions` map field:
// each region's own key is the only thing it ever writes, so there is
// nothing for two regions to race over. `connectedAt` doubles as that item's
// compare-and-set token — the same thing the row-wide `version` did before,
// scoped to the one region a leave or a repair ever touches.

interface StoredItem {
    connectedAt: number;
    ttl: number;
}

let table: Map<string, StoredItem>;
let tableReads: number;
let tableWrites: number;

/**
 * The reserved-item path, as the key-value store exposes it. Stubbed at the
 * store boundary so both regions share one table; the real path against the
 * real table is covered by the presence integration suite.
 */
const kvStub = () => ({
    queryReservedItems: async <T extends Record<string, unknown>>(
        prefix: string,
    ): Promise<T[]> => {
        tableReads++;
        const now = Date.now() / 1000;
        const items: T[] = [];
        for (const [key, item] of table.entries()) {
            if (!key.startsWith(prefix)) continue;
            if (item.ttl && item.ttl <= now) continue;
            items.push({ key, connectedAt: item.connectedAt } as unknown as T);
        }
        return items;
    },
    putReservedItem: async (
        key: string,
        attributes: Record<string, unknown>,
    ): Promise<void> => {
        tableWrites++;
        table.set(key, {
            connectedAt: Number(attributes.connectedAt),
            ttl: Number(attributes.ttl),
        });
    },
    retireReservedItemIf: async (
        key: string,
        _condition: string,
        conditionValues: Record<string, unknown>,
    ): Promise<boolean> => {
        tableWrites++;
        const item = table.get(key);
        if (!item || item.connectedAt !== conditionValues[':expected'])
            return false;
        // 1, not 0: a falsy ttl reads as "no expiry" everywhere else here,
        // the same convention the real store follows.
        table.set(key, { ...item, ttl: 1 });
        return true;
    },
});

// -- Regions ----------------------------------------------------------

interface Region {
    name: string;
    redis: InstanceType<typeof MockRedis.Cluster>;
    presence: PresenceStore;
    pending: PendingDeliveryStore;
    subscriptions: EventSubscriptionStore;
    forward: EventForwardService;
    events: EventsService;
    /** Every addressed POST this region made, whether or not it arrived. */
    posts: Array<{ peerId: string; batch: ForwardBatch }>;
    /** Rooms this region terminates a socket for. */
    rooms: Set<string>;
    sent: DeliveryEnvelope[];
    invoked: WorkerInvocation[];
    alarms: ReturnType<typeof vi.fn>;
    /** Peers whose POSTs never come back — a timeout, not a refusal. */
    unreachable: Set<string>;
    handlers: Map<string, (key: string, data: unknown, meta: unknown) => void>;
}

let regions: Map<string, Region>;
let seq = 0;
let userId = 0;
let rows: Map<string, DurableSubscription>;
let workerOutcome: WorkerInvocationOutcome;

const anchorUid = () => `docs-${seq}`;
const anchorPath = () => `/u${userId}/Documents`;
const ancestors = () => [{ uid: anchorUid(), path: anchorPath() }];

const entry = (over: Partial<FSEntry> = {}): FSEntry =>
    ({
        uid: `file-${seq}`,
        uuid: `file-${seq}`,
        path: `${anchorPath()}/notes.txt`,
        userId,
        isDir: false,
        ...over,
    }) as FSEntry;

const actorFor = (appUid: string | null = null): Actor =>
    ({
        user: { id: userId, uuid: `user-${userId}`, username: `u${userId}` },
        effectiveApp: appUid ? { uid: appUid } : null,
        app: appUid ? { uid: appUid } : null,
    }) as unknown as Actor;

const durableRow = (
    over: Partial<DurableSubscription> = {},
): DurableSubscription => ({
    durable: true,
    subId: `sub-${seq}-${over.subId ?? 'one'}`,
    holderUserId: userId,
    ownerUserId: userId,
    subject: `fs:${anchorPath()}`,
    token: fsAnchorToken(anchorUid()),
    anchorUid: anchorUid(),
    anchorPath: anchorPath(),
    match: null,
    op: null,
    appUid: null,
    permission: 'list',
    delivery: 'broadcast',
    targets: ['socket'] as SubscriptionTarget[],
    handlerName: null,
    context: null,
    expiresAt: null,
    suspendedAt: null,
    suspendedReason: null,
    createdAt: Math.floor(Date.now() / 1000),
    ...over,
});

const makeRegion = (
    name: string,
    peers: string[],
    config: Partial<IConfig> = {},
): Region => {
    // A keyspace per region, because that is what a region is here: leases,
    // pending queues and connection counts are local by construction, and a
    // test that quietly shared them would prove the opposite of the claim.
    const redis = new MockRedis.Cluster(['redis://localhost:6379'], {
        redisOptions: { keyPrefix: `${name}-${seq}:` },
    });
    const region: Region = {
        name,
        redis,
        posts: [],
        rooms: new Set(),
        sent: [],
        invoked: [],
        alarms: vi.fn(),
        unreachable: new Set(),
        handlers: new Map(),
    } as unknown as Region;

    const fullConfig = {
        events: { enabled: true },
        ...config,
    } as IConfig;

    const clients = {
        redis,
        alarm: { create: region.alarms },
        event: {
            on: (key: string, handler: unknown) => {
                region.handlers.set(
                    key,
                    handler as (
                        key: string,
                        data: unknown,
                        meta: unknown,
                    ) => void,
                );
            },
            // The broadcast channel, simulated: an `outer.*` emit reaches every
            // peer tagged `from_outside`, and never its own emitter.
            emit: (key: string, data: unknown, meta: object) => {
                for (const other of regions.values()) {
                    if (other === region) continue;
                    other.handlers.get(key)?.(key, data, {
                        ...meta,
                        from_outside: true,
                    });
                }
            },
        },
    } as never;

    const presence = new PresenceStore(fullConfig, clients, {
        kv: kvStub(),
    } as never);
    const pending = new PendingDeliveryStore(fullConfig, clients, {} as never);
    const subscriptions = new EventSubscriptionStore(
        fullConfig,
        clients,
        {} as never,
    );

    const socket = {
        has: (spec: { room?: string | number; socket?: string }) =>
            region.rooms.has(String(spec.room ?? spec.socket ?? '')),
        send: vi.fn(async (_spec: unknown, _key: string, data: unknown) => {
            region.sent.push(data as DeliveryEnvelope);
        }),
    };

    const broadcast = {
        get regionId() {
            return name;
        },
        get addressablePeers() {
            return peers;
        },
        postToPeer: async (peerId: string, _path: string, payload: unknown) => {
            const batch = payload as ForwardBatch;
            region.posts.push({ peerId, batch });
            if (region.unreachable.has(peerId))
                throw new Error('peer did not answer');
            const target = regions.get(peerId);
            if (!target) throw new Error(`no such peer ${peerId}`);
            return target.forward.receive(batch);
        },
    };

    const services: Record<string, unknown> = {
        broadcast,
        socket,
        fs: { getAncestorChain: async () => ancestors() },
        acl: {
            check: async () => true,
            getSafeAclError: async () => ({
                status: 404,
                message: 'Subject does not exist',
                fields: { code: 'subject_does_not_exist' },
            }),
        },
        notification: { notify: vi.fn() },
        metering: {
            bufferIncrementUsages: () => undefined,
            hasAnyUsageCached: async () => true,
        },
    };

    const stores = {
        kv: kvStub(),
        presence,
        pendingDelivery: pending,
        eventSubscription: subscriptions,
        durableSubscription: {
            warmRegion: async () => false,
            getBySubId: async (subId: string) => rows.get(subId) ?? null,
            remove: async (row: DurableSubscription) => {
                rows.delete(row.subId);
                return { userId: row.holderUserId, generation: 1 };
            },
            suspend: async () => [{ userId, generation: 1 }],
        },
        fsEntry: {
            getEntryByUuid: async (uid: string) =>
                uid === anchorUid()
                    ? entry({ uid: anchorUid(), isDir: true })
                    : null,
            getEntryByPath: async () => null,
            getEntryById: async () => null,
        },
        user: { getById: async (id: number) => ({ id, uuid: `user-${id}` }) },
        app: { getByUid: async (uid: string) => ({ uid, id: 1 }) },
        permission: { getCacheGeneration: async () => 1 },
    } as never;

    region.presence = presence;
    region.pending = pending;
    region.subscriptions = subscriptions;
    region.forward = new EventForwardService(
        fullConfig,
        clients,
        stores,
        services as never,
    );
    region.events = new EventsService(
        fullConfig,
        clients,
        stores,
        services as never,
    );
    services.eventForward = region.forward;
    services.events = region.events;

    region.events.worker = {
        invoke: async (invocation: WorkerInvocation) => {
            region.invoked.push(invocation);
            return workerOutcome;
        },
    };
    region.forward.onServerStart();
    regions.set(name, region);
    return region;
};

// -- Helpers ----------------------------------------------------------

/** Reconstructs a pair's row from its per-region items, the way `read()` does. */
const rowFor = (appUid: string = PRESENCE_NO_APP): { regions: Record<string, number> } => {
    const prefix = presenceItemKey(`user-${userId}`, appUid, '');
    const now = Date.now() / 1000;
    const regions: Record<string, number> = {};
    for (const [key, item] of table.entries()) {
        if (!key.startsWith(prefix)) continue;
        if (item.ttl && item.ttl <= now) continue;
        regions[key.slice(prefix.length)] = item.connectedAt;
    }
    return { regions };
};

const register = async (
    region: Region,
    over: Partial<DurableSubscription> = {},
): Promise<DurableSubscription> => {
    const row = durableRow(over);
    rows.set(row.subId, row);
    await region.subscriptions.cacheDurable([row]);
    region.events.invalidateUser(userId);
    return row;
};

const dispatch = (region: Region, node = entry()): Promise<void> =>
    region.events.dispatchFs('fs.write.file', node, {
        actingUserId: userId,
        ancestors: async () => ancestors(),
    });

const posted = (region: Region, count = 1): Promise<void> =>
    vi.waitFor(
        () => expect(region.posts.length).toBeGreaterThanOrEqual(count),
        {
            timeout: 3_000,
            interval: 10,
        },
    );

const arrived = (region: Region, count = 1): Promise<void> =>
    vi.waitFor(() => expect(region.sent.length).toBeGreaterThanOrEqual(count), {
        timeout: 3_000,
        interval: 10,
    });

const quiet = (ms = 150): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/** Move the clock past a lease without waiting out its window. */
const jump = (ms: number): void => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + ms);
};

const deliveriesIn = (region: Region): ForwardDelivery[] =>
    region.posts.flatMap((post) =>
        post.batch.items.filter(
            (item): item is ForwardDelivery => item.kind === 'delivery',
        ),
    );

beforeEach(() => {
    seq++;
    userId = 9000 + seq;
    table = new Map();
    tableReads = 0;
    tableWrites = 0;
    regions = new Map();
    rows = new Map();
    workerOutcome = 'deferred';
    EventForwardService.LEAVE_DELAY_MIN_MS = 60;
    EventForwardService.LEAVE_DELAY_MAX_MS = 60;
});

afterEach(async () => {
    for (const region of regions.values())
        await region.forward.onServerPrepareShutdown();
    vi.useRealTimers();
});

// -- Presence transitions ---------------------------------------------

describe('what a connection writes', () => {
    it('writes once for the first, and nothing for the reconnects after it', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);

        for (let i = 0; i < 5; i++) await west.forward.noteConnect(actorFor());

        expect(tableWrites).toBe(1);
        expect(rowFor()?.regions).toEqual({ west: expect.any(Number) });
    });

    it('writes nothing at all for a reload — a disconnect and a reconnect inside the window', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);

        await west.forward.noteConnect(actorFor());
        const afterConnect = tableWrites;

        await west.forward.noteDisconnect(actorFor());
        await west.forward.noteConnect(actorFor());
        await quiet(150);

        expect(tableWrites).toBe(afterConnect);
        expect(rowFor()?.regions).toEqual({ west: expect.any(Number) });
    });

    it('takes the region out of the row once the last connection stays gone', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);

        await west.forward.noteConnect(actorFor());
        await west.forward.noteDisconnect(actorFor());

        await vi.waitFor(() => expect(rowFor()?.regions).toEqual({}), {
            timeout: 2_000,
            interval: 10,
        });
    });

    it('holds the row while any connection remains', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);

        await west.forward.noteConnect(actorFor());
        await west.forward.noteConnect(actorFor());
        await west.forward.noteDisconnect(actorFor());
        await quiet(150);

        expect(rowFor()?.regions).toEqual({ west: expect.any(Number) });
    });

    it('never writes on a timer — a session sits connected across many windows', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);
        await west.forward.noteConnect(actorFor());
        expect(tableWrites).toBe(1);

        vi.useFakeTimers();
        // Several times over any refresh interval anyone would have chosen.
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
        vi.useRealTimers();

        expect(tableWrites).toBe(1);
        expect(rowFor()?.regions).toEqual({ west: expect.any(Number) });
    });

    it('skips the leaving write under a drain, where every socket goes at once', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);
        await west.forward.noteConnect(actorFor());

        await west.forward.onServerPrepareShutdown();
        await west.forward.noteDisconnect(actorFor());
        await quiet(150);

        expect(tableWrites).toBe(1);
        expect(rowFor()?.regions).toEqual({ west: expect.any(Number) });
    });

    it('counts each app separately, because each has its own room', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);

        await west.forward.noteConnect(actorFor('app-a'));
        await west.forward.noteConnect(actorFor('app-b'));

        expect(rowFor('app-a')?.regions).toEqual({ west: expect.any(Number) });
        expect(rowFor('app-b')?.regions).toEqual({ west: expect.any(Number) });
    });

    it('moves with the connection itself, not with what it subscribes to', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);
        const handlers = new Map<string, () => void>();
        const socket = {
            id: 'socket-1',
            on: () => undefined,
            once: (event: string, handler: () => void) =>
                handlers.set(event, handler),
        };

        west.events.attachSocket(socket, actorFor());
        await vi.waitFor(() =>
            expect(rowFor()?.regions).toEqual({ west: expect.any(Number) }),
        );

        handlers.get('disconnect')?.();
        await vi.waitFor(() => expect(rowFor()?.regions).toEqual({}), {
            timeout: 2_000,
            interval: 10,
        });
    });

    it('takes no part in presence where nothing is configured to read it', async () => {
        const alone = makeRegion('west', []);

        await alone.forward.noteConnect(actorFor());
        await alone.forward.noteDisconnect(actorFor());
        await quiet(150);

        expect(tableWrites).toBe(0);
        expect(tableReads).toBe(0);
        expect(table.size).toBe(0);
    });

    it('writes nothing where events are switched off', async () => {
        const off = makeRegion('west', ['east'], {
            events: { enabled: false },
        } as Partial<IConfig>);

        await off.forward.noteConnect(actorFor());

        expect(tableWrites).toBe(0);
    });

    it('a flapping client across two nodes in one region writes at most one join per real transition', async () => {
        // Two independent service instances answering to the same region
        // name and sharing the same Redis keyspace (same name + seq, exactly
        // as `makeRegion` sets up two peers sharing one): a process-local
        // `#leaveTimers` map cannot cancel a leave scheduled by the other
        // process, which is why the region-shared pin — not that map — is
        // what has to gate the join write.
        const nodeA = makeRegion('east', ['west']);
        const nodeB = makeRegion('east', ['west']);
        makeRegion('west', ['east']);

        tableWrites = 0;
        // Connect on A, and flap to B before A's disconnect write would ever
        // land — B has no idea A scheduled anything.
        await nodeA.forward.noteConnect(actorFor());
        await nodeA.forward.noteDisconnect(actorFor());
        await nodeB.forward.noteConnect(actorFor());
        await nodeB.forward.noteDisconnect(actorFor());
        await nodeA.forward.noteConnect(actorFor());

        expect(tableWrites).toBe(1);
        expect(rowFor().regions).toEqual({ east: expect.any(Number) });
    });
});

// -- Forwarding -------------------------------------------------------

describe('a broadcast delivery', () => {
    it('makes no cross-region traffic at all when nobody is connected anywhere', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);
        await register(west);

        await dispatch(west);
        await quiet(200);

        expect(west.posts).toEqual([]);
    });

    it('goes to the one region holding the socket, and only that one', async () => {
        const west = makeRegion('west', ['east', 'south']);
        const east = makeRegion('east', ['west', 'south']);
        makeRegion('south', ['west', 'east']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        await register(west);

        await dispatch(west);
        await posted(west);
        await arrived(east);

        expect(west.posts).toHaveLength(1);
        expect(west.posts[0].peerId).toBe('east');
        expect(east.sent[0].event).toMatchObject({ op: 'write' });
    });

    it('stays put for a subscription tied to one connection, which is here', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        // A session row is addressed at the socket that made it, so another
        // region's tabs are not among its subscribers.
        await register(west, { socketId: 'socket-here', durable: undefined });

        await dispatch(west);
        await quiet(200);

        expect(west.posts).toEqual([]);
    });

    it('reaches every region a subscriber is connected in', async () => {
        const west = makeRegion('west', ['east', 'south']);
        const east = makeRegion('east', ['west', 'south']);
        const south = makeRegion('south', ['west', 'east']);
        east.rooms.add(String(userId));
        south.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        await south.forward.noteConnect(actorFor());
        await register(west);

        await dispatch(west);
        await posted(west, 2);

        expect(west.posts.map((post) => post.peerId).sort()).toEqual([
            'east',
            'south',
        ]);
    });

    it('carries a window of events in one request, not one request each', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        await register(west);

        // Distinct nodes, so nothing is coalesced away upstream.
        for (let i = 0; i < 6; i++)
            await dispatch(
                west,
                entry({ uid: `file-${i}`, path: `${anchorPath()}/n${i}.txt` }),
            );
        await posted(west);
        await quiet(200);

        expect(west.posts).toHaveLength(1);
        expect(west.posts[0].batch.items).toHaveLength(6);
    });

    it('reads presence once and then answers from what it already knows', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        await register(west);

        tableReads = 0;
        for (let i = 0; i < 8; i++)
            await dispatch(
                west,
                entry({ uid: `file-${i}`, path: `${anchorPath()}/n${i}.txt` }),
            );
        await posted(west);
        await quiet(200);

        expect(tableReads).toBe(1);
    });
});

// -- Lazy repair ------------------------------------------------------

describe('a row naming a region that holds nothing', () => {
    it('is corrected once, on the region saying so itself', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        await east.forward.noteConnect(actorFor());
        // The socket goes without east ever reporting it — a node that died.
        east.rooms.clear();
        await east.presence.removeConnection(userId, PRESENCE_NO_APP);
        await register(west);

        tableWrites = 0;
        await dispatch(west);
        await posted(west);

        await vi.waitFor(() => expect(rowFor()?.regions).toEqual({}), {
            timeout: 2_000,
            interval: 10,
        });
        expect(tableWrites).toBe(1);
    });

    it('is left alone when the region simply did not answer', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        await east.forward.noteConnect(actorFor());
        east.rooms.clear();
        await east.presence.removeConnection(userId, PRESENCE_NO_APP);
        west.unreachable.add('east');
        await register(west);

        tableWrites = 0;
        await dispatch(west);
        await posted(west);
        await quiet(200);

        // A timeout says nothing about whether the socket is there.
        expect(tableWrites).toBe(0);
        expect(rowFor()?.regions).toEqual({ east: expect.any(Number) });
    });

    it('cannot be stormed by a busy subscription', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        await east.forward.noteConnect(actorFor());
        east.rooms.clear();
        await east.presence.removeConnection(userId, PRESENCE_NO_APP);
        await register(west);

        tableWrites = 0;
        for (let i = 0; i < 10; i++) {
            await dispatch(
                west,
                entry({ uid: `file-${i}`, path: `${anchorPath()}/n${i}.txt` }),
            );
            await quiet(60);
        }
        await quiet(200);

        expect(tableWrites).toBe(1);
    });

    it('re-joins once its pin is released — a dead node recovers on its next connect', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        await east.forward.noteConnect(actorFor());
        const original = rowFor().regions.east;
        // The socket goes without east ever reporting it — a node that died
        // holding the join pin along with the row entry.
        east.rooms.clear();
        await east.presence.removeConnection(userId, PRESENCE_NO_APP);
        await register(west);

        // West's forward comes back `noSocket`, repairs the row, and — as a
        // side effect of east answering that itself — releases east's pin.
        await dispatch(west);
        await posted(west);
        await vi.waitFor(() => expect(rowFor().regions).toEqual({}));

        // East reconnects for real. With the pin released this is a fresh
        // join, not a skip: the pair is visible again without waiting for a
        // disconnect/reconnect cycle of its own to notice.
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());

        expect(rowFor().regions.east).toEqual(expect.any(Number));
        expect(rowFor().regions.east).not.toBe(original);
    });

    it('is not repaired away while the region holding it is still inside its own disconnect window', async () => {
        EventForwardService.LEAVE_DELAY_MIN_MS = 10_000;
        EventForwardService.LEAVE_DELAY_MAX_MS = 10_000;
        try {
            const west = makeRegion('west', ['east']);
            const east = makeRegion('east', ['west']);
            east.rooms.add(String(userId));
            await east.forward.noteConnect(actorFor());
            await register(west);

            // The socket is gone and the disconnect is in flight, but still
            // inside its window: east expects the pair back, and has not
            // written itself out of the row for it.
            east.rooms.delete(String(userId));
            await east.forward.noteDisconnect(actorFor());

            tableWrites = 0;
            await dispatch(west);
            await posted(west);
            await arrived(east);

            expect(tableWrites).toBe(0);
            expect(rowFor()?.regions).toEqual({ east: expect.any(Number) });
        } finally {
            EventForwardService.LEAVE_DELAY_MIN_MS = 60;
            EventForwardService.LEAVE_DELAY_MAX_MS = 60;
        }
    });
});

// -- `single` across regions ------------------------------------------

describe('a delivery owed to exactly one consumer', () => {
    const single = (region: Region) =>
        register(region, {
            delivery: 'single',
            targets: ['socket', 'worker'] as SubscriptionTarget[],
            handlerName: 'onWrite',
        });

    it('takes the emitting region`s own socket before any other', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        west.rooms.add(String(userId));
        east.rooms.add(String(userId));
        await west.forward.noteConnect(actorFor());
        await east.forward.noteConnect(actorFor());
        await single(west);

        await dispatch(west);
        await arrived(west);

        expect(west.posts).toEqual([]);
        expect(west.sent[0]).toMatchObject({ ackRequired: true });
    });

    it('hands off to the most recently connected region when it holds none', async () => {
        const west = makeRegion('west', ['east', 'south']);
        const east = makeRegion('east', ['west', 'south']);
        const south = makeRegion('south', ['west', 'east']);
        east.rooms.add(String(userId));
        south.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        await quiet(5);
        await south.forward.noteConnect(actorFor());
        const row = await single(west);

        await dispatch(west);
        await posted(west);
        await arrived(south);

        expect(west.posts[0].peerId).toBe('south');
        const carried = deliveriesIn(west)[0];
        expect(carried).toMatchObject({
            subId: row.subId,
            ackRequired: true,
            origin: 'west',
        });
        expect(typeof carried.ackId).toBe('string');
        expect(south.sent[0]).toMatchObject({
            ackRequired: true,
            origin: 'west',
        });
    });

    it('keeps every trace of the delivery in the region that emitted it', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        const row = await single(west);

        await dispatch(west);
        await posted(west);
        await arrived(east);

        const held = async (region: Region) =>
            (await region.redis.keys('*')).filter((key: string) =>
                key.includes(row.subId),
            );
        expect((await held(west)).length).toBeGreaterThan(0);
        expect(await held(east)).toEqual([]);
    });

    it('settles on an ack the client gave to whichever region it reached', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        const row = await single(west);

        await dispatch(west);
        await posted(west);
        await arrived(east);

        const envelope = east.sent[0];
        await east.events.ackDelivery(actorFor(), {
            subId: row.subId,
            id: envelope.ackId,
            origin: envelope.origin,
        });
        // The relay rides the same addressed channel the delivery did.
        await vi.waitFor(
            async () => expect(await west.pending.depth(row.subId)).toBe(0),
            { timeout: 3_000, interval: 20 },
        );
        expect(east.posts.at(-1)?.batch.items[0]).toMatchObject({
            kind: 'ack',
            subId: row.subId,
        });
    });

    it('never settles a lease in the region the client happened to reach', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        const row = await single(west);

        await dispatch(west);
        await posted(west);
        await arrived(east);

        await east.events.ackDelivery(actorFor(), {
            subId: row.subId,
            id: east.sent[0].ackId,
            origin: 'west',
        });

        expect(await east.pending.depth(row.subId)).toBe(0);
    });

    it('gives the handler what two socket candidates could not take', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        workerOutcome = 'settled';
        const row = await single(west);

        await dispatch(west);
        await posted(west);

        // Neither candidate acked, so the leases lapse and the handler takes
        // what the sockets would not.
        for (let attempt = 0; attempt < 3; attempt++) {
            jump(61_000);
            await west.events.sweepPending();
        }

        expect(west.invoked.length).toBeGreaterThan(0);
        expect(west.invoked[0].subId).toBe(row.subId);
    });
});

// -- Overflow ---------------------------------------------------------

describe('a forward queue that cannot keep up', () => {
    it('replaces what it shed with a marker, and says so', async () => {
        EventForwardService.MAX_QUEUED = 2;
        try {
            const west = makeRegion('west', ['east']);
            const east = makeRegion('east', ['west']);
            east.rooms.add(String(userId));
            await east.forward.noteConnect(actorFor());
            const row = await register(west);

            for (let i = 0; i < 6; i++)
                west.forward.handOff('east', {
                    holderUserId: userId,
                    appUid: null,
                    subId: row.subId,
                    event: {
                        id: `ev-${i}`,
                        subject: `fs:${anchorPath()}`,
                        op: 'write',
                        uid: `file-${i}`,
                        path: `${anchorPath()}/n${i}.txt`,
                        self: true,
                        seq: 0,
                        ts: Date.now(),
                    },
                });

            await posted(west);
            await arrived(east, 2);

            expect(west.alarms).toHaveBeenCalledWith(
                'events_forward_overflow',
                expect.any(String),
                expect.objectContaining({ peerId: 'east' }),
                'warning',
                expect.anything(),
            );
            // One marker for the one subscription that lost events, with the
            // newest delivery still behind it: a shed never eats the queue.
            expect(
                east.sent.filter((envelope) => envelope.event.op === 'gap'),
            ).toHaveLength(1);
            expect(
                east.sent.some((envelope) => envelope.event.id === 'ev-5'),
            ).toBe(true);
        } finally {
            EventForwardService.MAX_QUEUED = 5_000;
        }
    });
});

// -- Generation propagation -------------------------------------------

describe('presence moving in another region', () => {
    it('invalidates what this one cached about it', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        await register(west);

        expect(await west.forward.regionsFor(userId, null)).toEqual([]);
        const reads = tableReads;

        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());

        expect(await west.forward.regionsFor(userId, null)).toEqual(['east']);
        expect(tableReads).toBeGreaterThan(reads);
    });
});

// -- Decommissioned regions --------------------------------------------

describe('a row naming a region that is not a peer', () => {
    it('never offers it as a candidate, and prunes it out of the table', async () => {
        const west = makeRegion('west', ['east']);
        makeRegion('east', ['west']);
        await register(west);

        // A region taken out of the peer list — decommissioned, or never one
        // to begin with — whose item nothing ever cleaned up.
        table.set(presenceItemKey(`user-${userId}`, PRESENCE_NO_APP, 'ghost'), {
            connectedAt: Date.now(),
            ttl: Math.floor(Date.now() / 1000) + 999,
        });

        expect(await west.forward.regionsFor(userId, null)).toEqual([]);
        await vi.waitFor(() =>
            expect(rowFor().regions.ghost).toBeUndefined(),
        );
    });

    it('still offers a peer alongside a non-peer name in the same row', async () => {
        const west = makeRegion('west', ['east']);
        const east = makeRegion('east', ['west']);
        east.rooms.add(String(userId));
        await east.forward.noteConnect(actorFor());
        await register(west);

        table.set(presenceItemKey(`user-${userId}`, PRESENCE_NO_APP, 'ghost'), {
            connectedAt: Date.now() + 1, // sorts ahead of 'east' by recency
            ttl: Math.floor(Date.now() / 1000) + 999,
        });

        expect(await west.forward.regionsFor(userId, null)).toEqual(['east']);
    });
});

// -- Bounded concurrency on the inbound side ---------------------------

describe('receiving a batch', () => {
    it('emits deliveries in the order the batch carries them', async () => {
        // A subscription's events reach its socket in the order they were
        // emitted. Applying the batch concurrently would let every later
        // event overtake one slow delivery on the way out.
        const east = makeRegion('east', ['west']);

        const delivered: string[] = [];
        vi.spyOn(east.events, 'deliverForwarded').mockImplementation(
            async (item: ForwardDelivery) => {
                if (item.subId === 'first')
                    await new Promise((resolve) => setTimeout(resolve, 50));
                delivered.push(item.subId);
            },
        );

        await east.forward.receive({
            from: 'west',
            items: ['first', 'second', 'third'].map((subId) => ({
                kind: 'delivery' as const,
                userId,
                appUid: null,
                subId,
                event: {
                    id: `e-${subId}`,
                    subject: 'fs:/u7/Documents',
                    op: 'write',
                    uid: 'node-1',
                    path: '/u7/Documents/notes.txt',
                    self: true,
                    seq: 0,
                    ts: 1,
                },
            })),
        });

        expect(delivered).toEqual(['first', 'second', 'third']);
    });

    it('does not let one slow settle stall the rest of the batch', async () => {
        const east = makeRegion('east', ['west']);

        const settled: string[] = [];
        vi.spyOn(east.events, 'settleRelayedAck').mockImplementation(
            async (_holderUserId: number, subId: string) => {
                if (subId === 'slow')
                    await new Promise((resolve) => setTimeout(resolve, 200));
                settled.push(subId);
            },
        );

        const batch: ForwardBatch = {
            from: 'west',
            items: [
                { kind: 'ack', userId, subId: 'slow', entryId: 'e-slow' },
                ...Array.from({ length: 8 }, (_, i) => ({
                    kind: 'ack' as const,
                    userId,
                    subId: `fast-${i}`,
                    entryId: `e-${i}`,
                })),
            ],
        };

        const startedAt = Date.now();
        await east.forward.receive(batch);
        const elapsedMs = Date.now() - startedAt;

        // Bounded by the one slow settle running alongside the rest, not by
        // nine settles run one after another.
        expect(elapsedMs).toBeLessThan(200 + 150);
        expect(settled.filter((id) => id !== 'slow')).toHaveLength(8);
        // The fast settles all finished while the slow one was still
        // in flight, proving they ran concurrently rather than queued
        // behind it.
        expect(settled.at(-1)).toBe('slow');
    });
});
