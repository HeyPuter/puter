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

import MockRedis from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    EVENTS_BROADCAST_DELIVERY_LIMIT,
    EVENTS_COALESCE_WINDOW_MS,
    EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT,
    EVENTS_SUBSCRIBE_LIMIT,
} from '../../controllers/events/limits.js';
import type { Actor } from '../../core/actor.js';
import { isHttpError } from '../../core/http/HttpError.js';
import {
    EventSubscriptionStore,
    type DurableSubscription,
} from '../../stores/events/EventSubscriptionStore.js';
import type { KvShareHandle } from '../../stores/events/KvShareHandleStore.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { UsageInput } from '../metering/types.js';
import type { IConfig } from '../../types.js';
import { EVENTS_COSTS } from './costs.js';
import {
    EventsService,
    EVENTS_ACK_VERB,
    EVENTS_DELIVERY_CHANNEL,
    EVENTS_SUBSCRIBE_VERB,
    EVENTS_UNSUBSCRIBE_VERB,
    type DeliveryEnvelope,
    type EventSocket,
} from './EventsService.js';
import { kvSharePermission } from './kvShares.js';
import { FILTER_EVALUATIONS_PER_EVENT } from './matcher.js';
import { SUBSCRIPTION_CACHE_TTL_MS } from './subscriptionCache.js';
import { kvAnchorToken } from './subjects.js';

/**
 * The hot path is a cost claim before it is a behaviour claim, so the Redis
 * client is counted rather than replaced: these tests assert how many commands
 * a dispatch spends, which a stubbed store could not tell us.
 */

// ioredis-mock keeps one keyspace per process, and the imperative rate-limit
// counters are process-global too — so identity is what isolates tests here.
let seq = 0;
let userId = 0;
let socketId = '';

let redis: InstanceType<typeof MockRedis.Cluster>;
let commands: string[];
let store: EventSubscriptionStore;
let service: EventsService;
let sent: Array<{ socket?: string; envelope: DeliveryEnvelope }>;
let delivered: DeliveryEnvelope[];
let metered: MeteredLine[];
let entries: Map<string, FSEntry>;
let eventBus: { on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };

/** The listener `onServerStart` registered for remote generation bumps. */
type GenerationBumpHandler = (
    key: string,
    data: unknown,
    meta: unknown,
) => void;
const remoteGenerationBumpHandler = (): GenerationBumpHandler | undefined =>
    eventBus.on.mock.calls.find(
        ([key]: [string]) => key === 'outer.pubsub.events.generationBumped',
    )?.[1] as GenerationBumpHandler | undefined;

const COUNTED = new Set([
    'exists',
    'smismember',
    'scard',
    'smembers',
    'sadd',
    'srem',
    'hset',
    'hdel',
    'hlen',
    'hvals',
    'incr',
    'expire',
    'get',
    'del',
    'pipeline',
]);

/** Count what actually crosses the client boundary, pipelines included. */
const countingRedis = (
    inner: InstanceType<typeof MockRedis.Cluster>,
): InstanceType<typeof MockRedis.Cluster> =>
    new Proxy(inner, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof property !== 'string' || typeof value !== 'function')
                return value;
            if (!COUNTED.has(property)) return value;

            if (property === 'pipeline')
                return (...args: unknown[]) => {
                    const pipeline = (
                        value as (...a: unknown[]) => Record<string, unknown>
                    ).apply(target, args);
                    const exec = pipeline.exec as () => Promise<unknown>;
                    pipeline.exec = () => {
                        commands.push('pipeline');
                        return exec.call(pipeline);
                    };
                    return pipeline;
                };

            return (...args: unknown[]) => {
                commands.push(property);
                return (value as (...a: unknown[]) => unknown).apply(
                    target,
                    args,
                );
            };
        },
    }) as InstanceType<typeof MockRedis.Cluster>;

const entry = (over: Partial<FSEntry> = {}): FSEntry =>
    ({
        uid: 'file-uid',
        uuid: 'file-uid',
        path: `/u${userId}/Documents/notes.txt`,
        userId,
        isDir: false,
        ...over,
    }) as FSEntry;

const actorFor = (id = userId): Actor =>
    ({
        user: { id, uuid: `user-${id}`, username: `u${id}` },
        effectiveApp: null,
    }) as unknown as Actor;

/** The same account, acting as an app — what a `puter.js` call inside one is. */
const appActorFor = (appUid: string, id = userId): Actor =>
    ({
        user: { id, uuid: `user-${id}`, username: `u${id}` },
        app: { uid: appUid, id: 1 },
        effectiveApp: { uid: appUid, id: 1 },
    }) as unknown as Actor;

/**
 * Paths the ACL says no to, and how loudly. The real check is exercised against
 * real grants in the integration suite; here access is data, so a test can say
 * "this went away" without staging a share.
 */
let denied: Map<string, 'hidden' | 'forbidden'>;

/** Holders a grant was revoked from, regardless of which node they ask about. */
let deniedHolders: Set<number>;

const aclService = () => ({
    check: async (actor: Actor, resource: { path: string }) =>
        !denied.has(resource.path) && !deniedHolders.has(actor.user?.id ?? -1),
    getSafeAclError: async (_actor: Actor, resource: { path: string }) =>
        denied.get(resource.path) === 'forbidden'
            ? { status: 403, message: 'Forbidden', fields: { code: 'forbidden' } }
            : {
                  status: 404,
                  message: 'Subject does not exist',
                  fields: { code: 'subject_does_not_exist' },
              },
});

const userStore = {
    getById: async (id: number) => ({
        id,
        uuid: `user-${id}`,
        username: `u${id}`,
    }),
};

/** Share handles the kv resolver can be asked to resolve. */
let handles: Map<string, KvShareHandle>;

const kvShareHandleStore = {
    getByHandle: async (handle: string) => handles.get(handle) ?? null,
};

/** Apps the cross-app gate can be asked about, and what they share. */
let apps: Map<string, { uid: string; id: number; metadata?: unknown } | null>;

const appStore = {
    getByUid: async (uid: string) =>
        apps.has(uid) ? apps.get(uid) : { uid, id: 1, metadata: null },
};

/** Cross-app grants the holder has, as permission strings. */
let grants: Set<string>;
let permissionChecks: string[];

const permissionService = () => ({
    check: async (_actor: Actor, permission: string) => {
        permissionChecks.push(permission);
        return grants.has(permission);
    },
    registerImplicator: () => undefined,
});

/**
 * The counter delivery decisions are cached under. Held here so a test can move
 * it and watch the re-check happen again; what bumps it in production is any
 * grant or revoke.
 */
let permissionGeneration: number;

const permissionStore = {
    getCacheGeneration: async () => permissionGeneration,
};

/**
 * This suite is about session rows and what a dispatch spends on them, so the
 * region is already warm and holds no durable rows — the table and its cache
 * are covered against a real database in the durable suites.
 */
const durableSubscriptionStore = {
    warmRegion: async () => false,
    getBySubId: async () => null,
};

/** One buffered usage line, with the identity it was written as. */
interface MeteredLine {
    userUuid: string | undefined;
    appUid: string | null;
    usageType: string;
    usageAmount: number;
    costOverride?: number;
}

/** Whether the account being delivered to still has budget. */
let hasCredits: boolean;

/**
 * Each service gets its own outbox. A delivery still in flight when a test
 * ends must land in that test's record, not in the next one's.
 */
const buildService = (
    config: IConfig,
): {
    service: EventsService;
    sent: Array<{ socket?: string; envelope: DeliveryEnvelope }>;
    delivered: DeliveryEnvelope[];
    metered: MeteredLine[];
    eventBus: { on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
} => {
    const outbox: Array<{ socket?: string; envelope: DeliveryEnvelope }> = [];
    const counted: DeliveryEnvelope[] = [];
    const lines: MeteredLine[] = [];
    const bus = { on: vi.fn(), emit: vi.fn() };
    const built = new EventsService(
        config,
        {
            redis,
            event: bus,
        } as never,
        {
            eventSubscription: store,
            durableSubscription: durableSubscriptionStore,
            fsEntry: fsEntryStore,
            user: userStore,
            app: appStore,
            permission: permissionStore,
            kvShareHandle: kvShareHandleStore,
        } as never,
        {
            eventForward: {
                // A deployment with no peers has nowhere to forward to, which
                // is what every test here is.
                region: 'local',
                isPeer: () => false,
                noteConnect: async () => undefined,
                noteDisconnect: async () => undefined,
                candidateRegion: async () => null,
                fanOut: async () => undefined,
                handOff: () => undefined,
                relayAck: () => undefined,
            },
            socket: {
                send: vi.fn(async (spec: { socket?: string }, _key, data) => {
                    outbox.push({
                        socket: spec.socket,
                        envelope: data as DeliveryEnvelope,
                    });
                }),
            },
            fs: {
                getAncestorChain: vi.fn(async (path: string) =>
                    ancestorChain(path),
                ),
            },
            acl: aclService(),
            permission: permissionService(),
            metering: {
                bufferIncrementUsages: (
                    actor: Actor,
                    usages: UsageInput[],
                ) => {
                    for (const usage of usages)
                        lines.push({
                            userUuid: actor.user?.uuid,
                            appUid: actor.app?.uid ?? null,
                            ...usage,
                        });
                },
                hasAnyUsageCached: async () => hasCredits,
            },
        } as never,
    );
    built.onDelivered = (envelope) => counted.push(envelope);
    built.onServerStart();
    return {
        service: built,
        sent: outbox,
        delivered: counted,
        metered: lines,
        eventBus: bus,
    };
};

const fsEntryStore = {
    getEntryByUuid: async (uid: string) => entries.get(`uid:${uid}`) ?? null,
    getEntryByPath: async (path: string) => entries.get(`path:${path}`) ?? null,
    getEntryById: async () => null,
};

const register = (node: FSEntry): FSEntry => {
    entries.set(`uid:${node.uid}`, node);
    entries.set(`path:${node.path}`, node);
    return node;
};

/** Existing ancestors of a path, deepest first — what `FSService` returns. */
const ancestorChain = (path: string): Array<{ uid: string; path: string }> => {
    const chain: Array<{ uid: string; path: string }> = [];
    let cursor = path;
    while (cursor.lastIndexOf('/') > 0) {
        cursor = cursor.slice(0, cursor.lastIndexOf('/'));
        const found = entries.get(`path:${cursor}`);
        if (found) chain.push({ uid: found.uid, path: found.path });
    }
    return chain;
};

/** Anchor the tests subscribe against, and the tree above the written file. */
const seedTree = (): { home: FSEntry; documents: FSEntry; file: FSEntry } => {
    const home = register(
        entry({ uid: `home-${seq}`, path: `/u${userId}`, isDir: true }),
    );
    const documents = register(
        entry({
            uid: `docs-${seq}`,
            path: `/u${userId}/Documents`,
            isDir: true,
        }),
    );
    const file = register(entry({ uid: `file-${seq}` }));
    return { home, documents, file };
};

const subscribe = async (subject: string, socket = socketId) =>
    (await service.subscribe(actorFor(), socket, { subject })).sub;

/**
 * Register rows straight into the store. The fan-out and filter caps need
 * hundreds of subscriptions, which is far past the per-minute budget on the
 * verb — and the verb is not what those tests are about.
 */
const seedSubscriptions = async (
    count: number,
    row: {
        token: string;
        anchorUid: string;
        anchorPath: string;
        match: string | null;
    },
): Promise<void> => {
    for (let i = 0; i < count; i++)
        await store.add({
            subId: `seed-${seq}-${i}`,
            socketId: `socket-${seq}-${i}`,
            holderUserId: userId,
            ownerUserId: userId,
            subject: 'fs:seeded',
            op: null,
            appUid: null,
            permission: 'list',
            ...row,
        });
};

/** Dispatch as the FS write path does, with the ancestor walk as a thunk. */
const dispatch = async (node: FSEntry, key = 'fs.write.file' as const) =>
    service.dispatchFs(key, node, {
        actingUserId: userId,
        ancestors: async () => ancestorChain(node.path),
    });

/** Dispatch as the KV store's bus announcement does. */
const dispatchKv = async (
    keys: string[],
    options: { appUid?: string; op?: 'set' | 'del' | 'expire' } = {},
    on: EventsService = service,
) =>
    on.dispatchKv({
        userId,
        namespace: `v1:user-${userId}:${options.appUid ?? OWN_APP}`,
        keys,
        op: options.op ?? 'set',
    });

/** The app the KV tests act as, so "own namespace" has something to be. */
const OWN_APP = 'app-own';
const OTHER_APP = 'app-other';

const subscribeKv = async (subject: string, actor = appActorFor(OWN_APP)) =>
    (await service.subscribe(actor, socketId, { subject })).sub;

beforeEach(() => {
    seq++;
    userId = 1000 + seq;
    socketId = `socket-${seq}`;
    commands = [];
    entries = new Map();
    denied = new Map();
    deniedHolders = new Set();
    apps = new Map();
    grants = new Set();
    handles = new Map();
    permissionChecks = [];
    permissionGeneration = 1;
    hasCredits = true;
    redis = countingRedis(new MockRedis.Cluster(['redis://localhost:7001']));
    store = new EventSubscriptionStore(
        {} as IConfig,
        { redis } as never,
        {} as never,
    );
    ({ service, sent, delivered, metered, eventBus } = buildService({
        events: { enabled: true },
    } as IConfig));
});

afterEach(() => {
    vi.useRealTimers();
});

// -- The switch ------------------------------------------------------

describe('the feature switch', () => {
    it('is off when the config says nothing', () => {
        expect(buildService({} as IConfig).service.enabled).toBe(false);
    });

    it('refuses to subscribe with a stable code when off', async () => {
        const { service: off } = buildService({
            events: { enabled: false },
        } as IConfig);

        await expect(
            off.subscribe(actorFor(), socketId, { subject: 'fs:/u/x' }),
        ).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) && err.legacyCode === 'events_disabled',
        );
    });

    it('spends nothing at all on a dispatch when off', async () => {
        const { service: off } = buildService({
            events: { enabled: false },
        } as IConfig);
        const { file } = seedTree();

        await off.dispatchFs('fs.write.file', file, {
            ancestors: async () => {
                throw new Error('the tree must not be walked');
            },
        });

        expect(commands).toEqual([]);
    });
});

// -- Subscribing -----------------------------------------------------

describe('subscribing', () => {
    it('anchors on the node and reports where it landed', async () => {
        const { documents } = seedTree();

        const sub = await subscribe(`fs:/u${userId}/Documents`);

        expect(sub).toMatchObject({
            anchor: { uid: documents.uid, path: documents.path },
            match: null,
            op: null,
            // The connection is the only thing a session row can be delivered
            // to, so it is the only transport it can ask for.
            targets: ['socket'],
        });
    });

    it('refuses a session subscription a connection could not carry', async () => {
        seedTree();

        for (const targets of [['worker'], ['socket', 'push']])
            await expect(
                service.subscribe(actorFor(), socketId, {
                    subject: `fs:/u${userId}/Documents`,
                    targets,
                }),
            ).rejects.toSatisfy(
                (err: unknown) =>
                    isHttpError(err) && err.legacyCode === 'invalid_targets',
            );
    });

    it('rejects a subject that resolves to nothing', async () => {
        await expect(subscribe('fs:/nowhere/at/all')).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 404 &&
                err.legacyCode === 'subject_does_not_exist',
        );
    });

    it('answers a node the caller cannot see as absent, not as refused', async () => {
        const { documents } = seedTree();
        denied.set(documents.path, 'hidden');

        await expect(subscribe(`fs:${documents.uid}`)).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 404 &&
                err.legacyCode === 'subject_does_not_exist',
        );
    });

    it('refuses a node the caller can see but not list', async () => {
        const { documents } = seedTree();
        denied.set(documents.path, 'forbidden');

        await expect(subscribe(`fs:${documents.uid}`)).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 403 &&
                err.legacyCode === 'forbidden',
        );
    });

    it('stores the anchor`s owner, not the subscriber, as the keyspace', async () => {
        const { documents } = seedTree();
        const owner = userId + 500;
        register({ ...documents, userId: owner } as FSEntry);

        await subscribe(`fs:${documents.uid}`);

        await expect(store.userHasAny(owner)).resolves.toBe(true);
        await expect(store.userHasAny(userId)).resolves.toBe(false);
    });

    it('files the missing remainder as the filter', async () => {
        const { documents } = seedTree();

        const sub = await subscribe(`fs:/u${userId}/Documents/reports/*.csv`);

        expect(sub).toMatchObject({
            anchor: { uid: documents.uid },
            match: 'reports/*.csv',
        });
    });
});

describe('unsubscribing', () => {
    it('stops delivery', async () => {
        const { documents, file } = seedTree();
        const sub = await subscribe(`fs:${documents.uid}`);

        await service.unsubscribe(actorFor(), socketId, { subId: sub.subId });
        await dispatch(file);

        expect(sent).toEqual([]);
    });

    it('reports an id this socket never held as absent', async () => {
        seedTree();

        await expect(
            service.unsubscribe(actorFor(), socketId, { subId: 'not-mine' }),
        ).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 404 &&
                err.legacyCode === 'subscription_does_not_exist',
        );
    });
});

// -- What a dispatch costs -------------------------------------------

describe('what a dispatch costs', () => {
    it('spends no redis command for a user with nothing subscribed', async () => {
        const { file } = seedTree();

        // First dispatch warms the answer; it is the ones after that the
        // product actually pays for.
        await dispatch(file);
        commands = [];

        for (let i = 0; i < 5; i++) await dispatch(file);

        expect(commands).toEqual([]);
    });

    it('spends one command, and no store read, on an unwatched token', async () => {
        const { documents } = seedTree();
        await subscribe(`fs:${documents.uid}`);
        const elsewhere = register(
            entry({ uid: `other-${seq}`, path: `/u${userId}/Other/file.txt` }),
        );
        await dispatch(elsewhere);
        commands = [];

        await dispatch(elsewhere);

        expect(commands).toEqual(['smismember']);
        expect(sent).toEqual([]);
    });

    it('reads subscriptions only for the tokens that are watched', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);
        await dispatch(file);
        commands = [];

        await dispatch(file);

        // The membership test, then one pipelined read of the one hit.
        expect(commands).toEqual(['smismember', 'pipeline']);
    });

    it('walks the tree only for a user who has subscriptions', async () => {
        const { file } = seedTree();
        const walk = vi.fn(async () => [{ uid: 'docs', path: '/docs' }]);

        await service.dispatchFs('fs.write.file', file, {
            ancestors: walk,
        });
        await service.dispatchFs('fs.write.file', file, {
            ancestors: walk,
        });

        expect(walk).not.toHaveBeenCalled();
    });

    it('notices a new subscription without being told to look again', async () => {
        vi.useFakeTimers();
        const { documents, file } = seedTree();
        await dispatch(file);

        await subscribe(`fs:${documents.uid}`);
        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
    });
});

describe('cross-process invalidation', () => {
    it('flips a cached "nothing subscribed" answer on a remote bump, no timer involved', async () => {
        vi.useFakeTimers();
        const { documents, file } = seedTree();
        await dispatch(file); // warms this process's cache to "nothing subscribed"

        // A subscription made on another process: the row lands straight in
        // the shared store, never through this process's `subscribe()` —
        // which is the only other thing that updates the local cache.
        await store.add({
            subId: 'remote-sub',
            socketId: 'remote-socket',
            holderUserId: userId,
            ownerUserId: userId,
            subject: `fs:${documents.uid}`,
            token: `f#${documents.uid}`,
            anchorUid: documents.uid,
            anchorPath: documents.path,
            match: null,
            op: null,
            appUid: null,
            permission: 'list',
        });
        const generation = await store.getGeneration(userId);

        const handler = remoteGenerationBumpHandler();
        expect(handler).toBeDefined();
        handler?.(
            'outer.pubsub.events.generationBumped',
            { userId, generation },
            { from_outside: true },
        );

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
    });

    it('ignores its own emit rather than re-checking what it already applied', async () => {
        const { file } = seedTree();
        await dispatch(file); // warms the cache to "nothing subscribed"
        commands = [];

        // No `from_outside`: this is what the local half of our own emit
        // looks like, and it must not force a redundant re-check.
        remoteGenerationBumpHandler()?.(
            'outer.pubsub.events.generationBumped',
            { userId, generation: 1 },
            {},
        );
        await dispatch(file);

        expect(commands).toEqual([]);
    });

    it('re-reads the table for a peer`s durable bump, but not for a session one', async () => {
        const cold = vi.spyOn(store, 'markRegionCold');
        const handler = remoteGenerationBumpHandler();

        handler?.(
            'outer.pubsub.events.generationBumped',
            { userId, generation: 1, durable: false },
            { from_outside: true },
        );
        expect(cold).not.toHaveBeenCalled();

        handler?.(
            'outer.pubsub.events.generationBumped',
            { userId, generation: 2, durable: true },
            { from_outside: true },
        );
        expect(cold).toHaveBeenCalledWith(userId);
    });

    it('invalidates on a remote bump regardless of the number it carries', async () => {
        vi.useFakeTimers();
        // `ev:g` is a region-local INCR: a peer's own counter can legitimately
        // sit behind whatever this process has already recorded (it is
        // counting something else entirely) — comparing the two would let a
        // real remote invalidation be ignored as "already applied". So a
        // `from_outside` bump forgets unconditionally instead; there is
        // nothing to order it against. Push this process's own recorded
        // generation ahead first, via genuine local activity, so a
        // number-comparing implementation would wrongly ignore the bump below.
        const { documents, file } = seedTree();
        for (let i = 0; i < 3; i++) {
            const sub = await subscribe(`fs:${documents.uid}`, `local-${i}`);
            await service.unsubscribe(actorFor(), `local-${i}`, {
                subId: sub.subId,
            });
        }

        await dispatch(file); // caches "nothing subscribed" at the higher generation

        await store.add({
            subId: 'behind-sub',
            socketId: 'behind-socket',
            holderUserId: userId,
            ownerUserId: userId,
            subject: `fs:${documents.uid}`,
            token: `f#${documents.uid}`,
            anchorUid: documents.uid,
            anchorPath: documents.path,
            match: null,
            op: null,
            appUid: null,
            permission: 'list',
        });

        remoteGenerationBumpHandler()?.(
            'outer.pubsub.events.generationBumped',
            { userId, generation: 1 }, // behind this process's own recorded generation
            { from_outside: true },
        );

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
    });

    it('self-heals on the TTL alone when no bump ever arrives', async () => {
        vi.useFakeTimers();
        // The backstop for a broadcast that never lands at all: nothing
        // invalidates this process's cache, so only the read-side TTL can
        // force it to look again.
        const { documents, file } = seedTree();
        await dispatch(file); // warms this process's cache to "nothing subscribed"

        await store.add({
            subId: 'unseen-sub',
            socketId: 'unseen-socket',
            holderUserId: userId,
            ownerUserId: userId,
            subject: `fs:${documents.uid}`,
            token: `f#${documents.uid}`,
            anchorUid: documents.uid,
            anchorPath: documents.path,
            match: null,
            op: null,
            appUid: null,
            permission: 'list',
        });

        await dispatch(file);
        expect(sent).toEqual([]); // no bump landed, so still cached stale

        vi.advanceTimersByTime(SUBSCRIPTION_CACHE_TTL_MS + 1);
        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
    });
});

describe('cold-region rebuild concurrency', () => {
    it('collapses concurrent misses on a cold region into one rebuild', async () => {
        const { file } = seedTree();
        let calls = 0;
        const warm = vi
            .spyOn(durableSubscriptionStore, 'warmRegion')
            .mockImplementation(async () => {
                calls++;
                await Promise.resolve();
                return false;
            });
        try {
            await Promise.all([dispatch(file), dispatch(file)]);
            expect(calls).toBe(1);
        } finally {
            warm.mockRestore();
        }
    });

    it('does not wedge future dispatches when a rebuild throws', async () => {
        vi.useFakeTimers();
        const { documents, file } = seedTree();
        const warm = vi
            .spyOn(durableSubscriptionStore, 'warmRegion')
            .mockRejectedValueOnce(new Error('boom'));
        try {
            // Not being able to tell must resolve as "nothing subscribed"
            // rather than hang, and must not leave the in-flight lookup
            // wedged for every dispatch after it.
            await expect(dispatch(file)).resolves.toBeUndefined();

            await subscribe(`fs:${documents.uid}`);
            await dispatch(file);
            await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

            expect(sent).toHaveLength(1);
        } finally {
            warm.mockRestore();
        }
    });
});

// -- Matching --------------------------------------------------------

describe('matching', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    const flush = () =>
        vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

    it('delivers a deep write to a subscription on the folder', async () => {
        const { documents, file } = seedTree();
        const sub = await subscribe(`fs:${documents.uid}`);

        await dispatch(file);
        await flush();

        expect(sent).toHaveLength(1);
        expect(sent[0].socket).toBe(socketId);
        expect(sent[0].envelope.subId).toBe(sub.subId);
        expect(sent[0].envelope.event).toMatchObject({
            op: 'write',
            uid: file.uid,
            path: file.path,
            self: true,
        });
    });

    it('drops an event whose op the subscription did not ask for', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}:remove`);

        await dispatch(file);
        await flush();

        expect(sent).toEqual([]);
    });

    it('stops delivering to a durable row the moment it expires', async () => {
        const { documents, file } = seedTree();
        const now = Math.floor(Date.now() / 1000);
        const row = (over: Partial<DurableSubscription>): DurableSubscription => ({
            subId: `durable-${seq}-${over.expiresAt}`,
            token: `f#${documents.uid}`,
            ownerUserId: userId,
            holderUserId: userId,
            subject: `fs:${documents.uid}`,
            anchorUid: documents.uid,
            anchorPath: documents.path,
            match: null,
            op: null,
            appUid: null,
            permission: 'list',
            durable: true,
            delivery: 'broadcast',
            targets: ['socket'],
            handlerName: null,
            context: null,
            expiresAt: null,
            suspendedAt: null,
            suspendedReason: null,
            createdAt: now,
            ...over,
        });
        // Straight into the region cache, as a cold rebuild would leave them:
        // one still good for an hour, one that lapsed a minute ago and has not
        // been swept yet.
        await store.rebuildDurable(userId, [
            row({ expiresAt: now + 3600 }),
            row({ expiresAt: now - 60 }),
        ]);

        await dispatch(file);
        await flush();

        expect(sent.map((s) => s.envelope.subId)).toEqual([
            `durable-${seq}-${now + 3600}`,
        ]);
    });

    it('drops an event the match filter excludes', async () => {
        const { documents } = seedTree();
        await subscribe(`fs:/u${userId}/Documents/reports/*.csv`);
        const wrong = register(
            entry({
                uid: `wrong-${seq}`,
                path: `${documents.path}/reports/summary.txt`,
            }),
        );

        await dispatch(wrong);
        await flush();

        expect(sent).toEqual([]);
    });

    it('delivers what the match filter includes', async () => {
        const { documents } = seedTree();
        await subscribe(`fs:/u${userId}/Documents/reports/*.csv`);
        const right = register(
            entry({
                uid: `right-${seq}`,
                path: `${documents.path}/reports/summary.csv`,
            }),
        );

        await dispatch(right);
        await flush();

        expect(sent).toHaveLength(1);
    });

    it('marks a write by someone else as not the holder`s own', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);

        await service.dispatchFs('fs.write.file', file, {
            actingUserId: userId + 900,
            ancestors: async () => [
                { uid: documents.uid, path: documents.path },
            ],
        });
        await flush();

        expect(sent[0].envelope.event).toMatchObject({ self: false });
        // The subscription's holder is billed for their own delivery — never
        // the actor whose write happened to trigger it.
        expect(metered).toMatchObject([{ userUuid: `user-${userId}` }]);
    });

    it('stops delivering the moment the holder`s access goes', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);

        // The row is still there and still matches; only the answer to "may
        // this holder list the node" changed.
        denied.set(file.path, 'hidden');
        await dispatch(file);
        await flush();

        expect(sent).toEqual([]);
    });

    it('holds its answer across events, and re-asks when the generation moves', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);

        await dispatch(file);
        await flush();
        expect(sent).toHaveLength(1);

        // Access changing with nothing to announce it leaves the cached answer
        // standing, which is the trade a generation-keyed cache makes.
        denied.set(file.path, 'hidden');
        sent.length = 0;
        await dispatch(file);
        await flush();
        expect(sent).toHaveLength(1);

        // Any grant or revoke moves the counter, and the question is asked
        // again — with nothing delivered and nothing metered when it now fails.
        permissionGeneration++;
        sent.length = 0;
        delivered.length = 0;
        await dispatch(file);
        await flush();
        expect(sent).toEqual([]);
        expect(delivered).toEqual([]);
    });

    it('re-checks the node the event is about, not the anchor', async () => {
        const { documents } = seedTree();
        await subscribe(`fs:/u${userId}/Documents/**`);
        const reachable = register(
            entry({
                uid: `open-${seq}`,
                path: `${documents.path}/open/notes.txt`,
            }),
        );
        const closed = register(
            entry({
                uid: `closed-${seq}`,
                path: `${documents.path}/closed/secret.txt`,
            }),
        );
        denied.set(closed.path, 'hidden');

        await dispatch(reachable);
        await dispatch(closed);
        await flush();

        expect(sent.map((s) => (s.envelope.event as { uid: string }).uid)).toEqual([
            reachable.uid,
        ]);
    });

    it('publishes nothing for an event with no registry entry', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);
        commands = [];

        await service.dispatchFs('fs.copy.node', file, {
            ancestors: async () => [
                { uid: documents.uid, path: documents.path },
            ],
        });
        await flush();

        expect(commands).toEqual([]);
        expect(sent).toEqual([]);
    });
});

// -- Coalescing ------------------------------------------------------

describe('coalescing', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('turns a burst of writes to one file into one delivery', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);

        for (let i = 0; i < 12; i++) await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
    });

    it('keeps two files apart', async () => {
        const { documents, file } = seedTree();
        const second = register(
            entry({
                uid: `second-${seq}`,
                path: `${documents.path}/other.txt`,
            }),
        );
        await subscribe(`fs:${documents.uid}`);

        for (let i = 0; i < 6; i++) {
            await dispatch(file);
            await dispatch(second);
        }
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(2);
        expect(sent.map((s) => (s.envelope.event as { uid: string }).uid).sort())
            .toEqual([file.uid, second.uid].sort());
    });

    it('counts exactly what it delivered', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);

        for (let i = 0; i < 9; i++) await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(delivered).toHaveLength(sent.length);
        expect(delivered).toHaveLength(1);
        // Nine writes, one delivery, one line: what the coalescer collapses is
        // never billed for.
        expect(metered).toEqual([
            {
                userUuid: `user-${userId}`,
                appUid: null,
                usageType: 'events:delivery:broadcast',
                usageAmount: 1,
                costOverride: EVENTS_COSTS['events:delivery:broadcast'],
            },
        ]);
    });

    it('bills a filtered-out event to nobody', async () => {
        const { file } = seedTree();
        await subscribe(`fs:/u${userId}/Documents/*.md`);

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(delivered).toEqual([]);
        expect(metered).toEqual([]);
    });

    it('bills a session subscription at the broadcast rate, to its holder', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(metered).toMatchObject([
            {
                userUuid: `user-${userId}`,
                usageType: 'events:delivery:broadcast',
            },
        ]);
    });

    it('does not bill a gap marker, which is a notice rather than a delivery', async () => {
        const { documents, file } = seedTree();
        await seedSubscriptions(EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT + 5, {
            token: `f#${documents.uid}`,
            anchorUid: documents.uid,
            anchorPath: documents.path,
            match: null,
        });

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        const gaps = sent.filter((s) => s.envelope.event.op === 'gap');
        expect(gaps).toHaveLength(5);
        expect(metered).toHaveLength(EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT);
    });

    it('coalesces repeated gap markers into one per window', async () => {
        vi.useFakeTimers();
        const { documents } = seedTree();
        await seedSubscriptions(EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT + 1, {
            token: `f#${documents.uid}`,
            anchorUid: documents.uid,
            anchorPath: documents.path,
            match: null,
        });

        // Three separate over-cap writes in the same window — coalesced,
        // this is one marker per subscription, not one per event.
        for (let i = 0; i < 3; i++) {
            const file = register(
                entry({
                    uid: `over-${seq}-${i}`,
                    path: `${documents.path}/n${i}.txt`,
                }),
            );
            await dispatch(file);
        }
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent.filter((s) => s.envelope.event.op === 'gap')).toHaveLength(
            1,
        );
    });

    it('stops delivering to a holder with nothing left to spend', async () => {
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);
        hasCredits = false;

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toEqual([]);
        expect(delivered).toEqual([]);
        expect(metered).toEqual([]);
    });
});

// -- Limits ----------------------------------------------------------

describe('limits', () => {
    it('refuses subscription changes past the per-minute budget', async () => {
        const { documents } = seedTree();

        for (let i = 0; i < EVENTS_SUBSCRIBE_LIMIT.limit; i++)
            await service
                .unsubscribe(actorFor(), socketId, { subId: 'nope' })
                .catch(() => {});

        await expect(subscribe(`fs:${documents.uid}`)).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 429 &&
                err.legacyCode === 'too_many_requests',
        );
    });

    it('delivers to the fan-out cap and then says there was more', async () => {
        vi.useFakeTimers();
        const { documents, file } = seedTree();
        await seedSubscriptions(EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT + 5, {
            token: `f#${documents.uid}`,
            anchorUid: documents.uid,
            anchorPath: documents.path,
            match: null,
        });

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        // Fifty were delivered; the five that were cut are the five told so.
        const ops = sent.map((s) => s.envelope.event.op);
        expect(ops.filter((op) => op === 'write')).toHaveLength(
            EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT,
        );
        expect(ops.filter((op) => op === 'gap')).toHaveLength(5);
        expect(
            sent.find((s) => s.envelope.event.op === 'gap')?.envelope.event,
        ).toMatchObject({ reason: 'matched_subscription_limit' });

        const gapped = new Set(
            sent
                .filter((s) => s.envelope.event.op === 'gap')
                .map((s) => s.envelope.subId),
        );
        const written = new Set(
            sent
                .filter((s) => s.envelope.event.op === 'write')
                .map((s) => s.envelope.subId),
        );
        expect([...gapped].some((id) => written.has(id))).toBe(false);
    });

    it('never gaps a row whose grant was revoked', async () => {
        vi.useFakeTimers();
        const { documents, file } = seedTree();
        const revokedHolder = userId + 500;
        const count = EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT + 5;

        for (let i = 0; i < count; i++)
            await store.add({
                subId: `revoked-${seq}-${i}`,
                socketId: `socket-${seq}-${i}`,
                // Last in, so it lands among the ones the cap cuts rather
                // than among the ones actually delivered.
                holderUserId: i === count - 1 ? revokedHolder : userId,
                ownerUserId: userId,
                subject: 'fs:seeded',
                token: `f#${documents.uid}`,
                anchorUid: documents.uid,
                anchorPath: documents.path,
                match: null,
                op: null,
                appUid: null,
                permission: 'list',
            });
        deniedHolders.add(revokedHolder);

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        const gappedSubIds = new Set(
            sent
                .filter((s) => s.envelope.event.op === 'gap')
                .map((s) => s.envelope.subId),
        );
        // Cut for the cap, same as its neighbors — but the re-check refuses
        // it, so no marker goes to a holder the revocation already covers.
        expect(gappedSubIds).toHaveLength(4);
        expect(gappedSubIds.has(`revoked-${seq}-${count - 1}`)).toBe(false);
    });

    it('stops evaluating filters at the cap and says there was more', async () => {
        vi.useFakeTimers();
        const { documents } = seedTree();
        // Every one of these matches, so the pass would run to the end if the
        // cap did not stop it — and the marker names the cap that did.
        await seedSubscriptions(FILTER_EVALUATIONS_PER_EVENT + 20, {
            token: `f#${documents.uid}`,
            anchorUid: documents.uid,
            anchorPath: documents.path,
            match: 'reports/*.csv',
        });
        const file = register(
            entry({
                uid: `deep-${seq}`,
                path: `${documents.path}/reports/summary.csv`,
            }),
        );

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(
            sent.filter((s) => s.envelope.event.op === 'write'),
        ).toHaveLength(EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT);
        // 200 evaluated, 20 never reached: everything past the delivery cap is
        // told it missed something, itself capped.
        expect(
            sent.filter((s) => s.envelope.event.op === 'gap'),
        ).toHaveLength(EVENTS_MATCHED_SUBSCRIPTIONS_PER_EVENT);
        expect(
            sent.find((s) => s.envelope.event.op === 'gap')?.envelope.event,
        ).toMatchObject({ reason: 'filter_evaluation_limit' });
    });

    it('drops a subscription past its delivery budget with a gap', async () => {
        vi.useFakeTimers();
        const { documents } = seedTree();
        const sub = await subscribe(`fs:${documents.uid}`);
        const over = EVENTS_BROADCAST_DELIVERY_LIMIT.limit + 1;

        // One window, one file each: coalescing folds repeats on a subject, so
        // spending the budget means distinct subjects rather than distinct
        // minutes — the budget is per subscription, not per subject.
        for (let i = 0; i < over; i++)
            await dispatch(
                register(
                    entry({
                        uid: `burst-${seq}-${i}`,
                        path: `${documents.path}/burst-${i}.txt`,
                    }),
                ),
            );
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(over);
        expect(sent.every((s) => s.envelope.subId === sub.subId)).toBe(true);
        expect(
            sent.filter((s) => s.envelope.event.op === 'write'),
        ).toHaveLength(EVENTS_BROADCAST_DELIVERY_LIMIT.limit);
        expect(
            sent.find((s) => s.envelope.event.op === 'gap')?.envelope.event,
        ).toMatchObject({ reason: 'delivery_rate_limit' });
    });
});

// -- The socket surface ----------------------------------------------

describe('the socket surface', () => {
    const fakeSocket = (): EventSocket & {
        fire: (event: string, ...args: unknown[]) => void;
    } => {
        const handlers = new Map<string, (...args: never[]) => void>();
        return {
            id: socketId,
            on: (event, listener) => handlers.set(event, listener),
            once: (event, listener) => handlers.set(event, listener),
            fire: (event, ...args) =>
                (
                    handlers.get(event) as
                        | ((...a: unknown[]) => void)
                        | undefined
                )?.(...args),
        };
    };

    it('acks a subscribe with the subscription it made', async () => {
        const { documents } = seedTree();
        const socket = fakeSocket();
        service.attachSocket(socket, actorFor());

        const ack = vi.fn();
        socket.fire(
            EVENTS_SUBSCRIBE_VERB,
            { subject: `fs:${documents.uid}` },
            ack,
        );
        await vi.waitFor(() => expect(ack).toHaveBeenCalled());

        expect(ack.mock.calls[0][0]).toMatchObject({
            ok: true,
            sub: { subject: `fs:${documents.uid}` },
        });
    });

    it('acks a failure with a code rather than throwing at the socket', async () => {
        const socket = fakeSocket();
        service.attachSocket(socket, actorFor());

        const ack = vi.fn();
        socket.fire(EVENTS_SUBSCRIBE_VERB, { subject: 'not-a-subject' }, ack);
        await vi.waitFor(() => expect(ack).toHaveBeenCalled());

        expect(ack.mock.calls[0][0]).toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'invalid_subject' }),
        });
    });

    it('acks an unsubscribe', async () => {
        const { documents } = seedTree();
        const socket = fakeSocket();
        service.attachSocket(socket, actorFor());
        const sub = await subscribe(`fs:${documents.uid}`);

        const ack = vi.fn();
        socket.fire(EVENTS_UNSUBSCRIBE_VERB, { subId: sub.subId }, ack);
        await vi.waitFor(() => expect(ack).toHaveBeenCalled());

        expect(ack.mock.calls[0][0]).toEqual({ ok: true });
    });

    it('answers an ack for a subscription the caller does not hold', async () => {
        const socket = fakeSocket();
        service.attachSocket(socket, actorFor());

        const ack = vi.fn();
        socket.fire(
            EVENTS_ACK_VERB,
            { subId: 'app#someone-elses', id: '1-0' },
            ack,
        );
        await vi.waitFor(() => expect(ack).toHaveBeenCalled());

        expect(ack.mock.calls[0][0]).toEqual({
            ok: false,
            error: expect.objectContaining({
                code: 'subscription_does_not_exist',
            }),
        });
    });

    it('addresses deliveries at the socket that asked for them', async () => {
        vi.useFakeTimers();
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`, 'socket-one');
        await subscribe(`fs:${documents.uid}`, 'socket-two');

        await dispatch(file);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent.map((s) => s.socket).sort()).toEqual([
            'socket-one',
            'socket-two',
        ]);
    });

    it('reaps what a socket held when it disconnects', async () => {
        const { documents, file } = seedTree();
        const socket = fakeSocket();
        service.attachSocket(socket, actorFor());
        await subscribe(`fs:${documents.uid}`, socket.id);

        socket.fire('disconnect');
        await vi.waitFor(async () =>
            expect(await store.userHasAny(userId)).toBe(false),
        );
        await dispatch(file);

        expect(sent).toEqual([]);
    });

    it('clears its refresh timer on disconnect rather than leaking one per socket', async () => {
        vi.useFakeTimers();
        const { documents } = seedTree();
        const socket = fakeSocket();
        service.attachSocket(socket, actorFor());
        const before = vi.getTimerCount();

        await subscribe(`fs:${documents.uid}`, socket.id);
        expect(vi.getTimerCount()).toBe(before + 1);

        socket.fire('disconnect');
        await vi.waitFor(async () =>
            expect(await store.userHasAny(userId)).toBe(false),
        );

        expect(vi.getTimerCount()).toBe(before);
    });
});

// -- The write path is never the subscriber's problem ----------------

describe('failure containment', () => {
    it('swallows a store that cannot answer', async () => {
        const { file } = seedTree();
        vi.spyOn(store, 'userHasAny').mockRejectedValue(new Error('down'));

        await expect(dispatch(file)).resolves.toBeUndefined();
        expect(sent).toEqual([]);
    });

    it('swallows a socket that cannot be reached', async () => {
        vi.useFakeTimers();
        const { documents, file } = seedTree();
        await subscribe(`fs:${documents.uid}`);
        (
            service as unknown as {
                services: { socket: { send: ReturnType<typeof vi.fn> } };
            }
        ).services.socket.send.mockRejectedValue(new Error('no socket'));

        await expect(dispatch(file)).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);
        expect(delivered).toHaveLength(1);
    });
});

it('sends only the projected shape, never an internal row', async () => {
    vi.useFakeTimers();
    const { documents, file } = seedTree();
    await subscribe(`fs:${documents.uid}`);

    await dispatch(file);
    await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

    expect(Object.keys(sent[0].envelope).sort()).toEqual(['event', 'subId']);
    expect(Object.keys(sent[0].envelope.event).sort()).toEqual([
        'id',
        'op',
        'path',
        'self',
        'seq',
        'subject',
        'ts',
        'uid',
    ]);
    expect(sent[0].envelope.event).not.toHaveProperty('userId');
});

it('names the delivery channel the clients listen on', () => {
    expect(EVENTS_DELIVERY_CHANNEL).toBe('events.delivery');
});

// -- KV subjects -----------------------------------------------------

describe('resolving a kv subject', () => {
    it('anchors an exact key on the key itself, with no filter', async () => {
        const sub = await subscribeKv(`kv:${OWN_APP}:cart`);

        expect(sub).toMatchObject({
            subject: `kv:${OWN_APP}:cart`,
            anchor: { uid: OWN_APP, path: 'cart' },
            match: null,
            op: null,
        });
    });

    it('anchors a widened key on the prefix the `*` landed on', async () => {
        const sub = await subscribeKv(`kv:${OWN_APP}:cart:*`);

        expect(sub.anchor).toEqual({ uid: OWN_APP, path: 'cart:' });
        expect(sub.match).toBeNull();
    });

    it('backs the anchor off to a delimiter and files the rest as a filter', async () => {
        const sub = await subscribeKv(`kv:${OWN_APP}:user:12*`);

        expect(sub.anchor).toEqual({ uid: OWN_APP, path: 'user:' });
        expect(sub.match).toBe('user:12*');
    });

    it('expands a two-segment subject against the acting app', async () => {
        const sub = await subscribeKv('kv:cart');

        expect(sub.subject).toBe(`kv:${OWN_APP}:cart`);
        expect(sub.anchor.uid).toBe(OWN_APP);
    });

    it('reads a third segment as the key, not as sugar', async () => {
        // `kv:orders:pending` names app `orders`, which is what makes the wire
        // form unambiguous — and why a key with a `:` in it is written out.
        const sub = await subscribeKv('kv:orders:pending', actorFor());

        expect(sub.subject).toBe('kv:orders:pending');
        expect(sub.anchor).toEqual({ uid: 'orders', path: 'pending' });
    });

    it('expands against the global namespace when there is no app', async () => {
        const sub = await subscribeKv('kv:cart', actorFor());

        expect(sub.subject).toBe('kv:os-global:cart');
        expect(sub.anchor.uid).toBe('os-global');
    });

    it('refuses a pattern the grammar cannot enumerate from a key', async () => {
        for (const subject of [
            `kv:${OWN_APP}:ca*rt`,
            `kv:${OWN_APP}:cart?`,
        ])
            await expect(subscribeKv(subject)).rejects.toSatisfy(
                (err: unknown) =>
                    isHttpError(err) && err.legacyCode === 'invalid_kv_pattern',
            );
    });

    it('keys two users of one app under different tokens, and delivers to only one', async () => {
        vi.useFakeTimers();
        const mine = await subscribeKv(`kv:${OWN_APP}:cart`);
        const otherId = userId + 500;
        const theirs = (
            await service.subscribe(
                appActorFor(OWN_APP, otherId),
                `socket-${otherId}`,
                { subject: `kv:${OWN_APP}:cart` },
            )
        ).sub;

        expect(mine.subId).not.toBe(theirs.subId);
        await expect(
            store.watchedTokens(userId, [`k#user-${otherId}#${OWN_APP}#cart`]),
        ).resolves.toEqual([]);

        // Same app, same key, two different users: each write reaches only
        // the subscriber whose own namespace it landed in.
        await dispatchKv(['cart']);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);
        expect(sent.map((one) => one.envelope.subId)).toEqual([mine.subId]);

        sent.length = 0;
        await service.dispatchKv({
            userId: otherId,
            namespace: `v1:user-${otherId}:${OWN_APP}`,
            keys: ['cart'],
            op: 'set',
        });
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);
        expect(sent.map((one) => one.envelope.subId)).toEqual([theirs.subId]);
    });
});

describe('delivering a kv change', () => {
    it('delivers an exact key and nothing under it', async () => {
        vi.useFakeTimers();
        const sub = await subscribeKv(`kv:${OWN_APP}:cart`);

        await dispatchKv(['cart']);
        await dispatchKv(['cart:items']);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
        expect(sent[0].envelope.subId).toBe(sub.subId);
        expect(sent[0].envelope.event).toMatchObject({
            subject: `kv:${OWN_APP}:cart`,
            op: 'set',
            key: 'cart',
        });
    });

    it('delivers everything under a widened prefix, at any depth', async () => {
        vi.useFakeTimers();
        await subscribeKv(`kv:${OWN_APP}:cart:*`);

        await dispatchKv(['cart:items', 'cart:a:b:c', 'basket:x']);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(
            sent.map((one) => (one.envelope.event as { key: string }).key),
        ).toEqual(['cart:items', 'cart:a:b:c']);
    });

    it('applies a trailing-star filter with no delimiter to stop it', async () => {
        vi.useFakeTimers();
        await subscribeKv(`kv:${OWN_APP}:user:12*`);

        await dispatchKv(['user:12', 'user:1234', 'user:12:deep', 'user:99']);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(
            sent.map((one) => (one.envelope.event as { key: string }).key),
        ).toEqual(['user:12', 'user:1234', 'user:12:deep']);
    });

    it('reaches a subscription past the segment cap through its filter', async () => {
        vi.useFakeTimers();
        await subscribeKv(`kv:${OWN_APP}:a:b:c:d:e:f:g`);

        await dispatchKv(['a:b:c:d:e:f:g', 'a:b:c:d:e:f:h']);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
        expect(sent[0].envelope.event).toMatchObject({ key: 'a:b:c:d:e:f:g' });
    });

    it('carries the op the mutation reported', async () => {
        vi.useFakeTimers();
        await subscribeKv(`kv:${OWN_APP}:cart`);

        await dispatchKv(['cart'], { op: 'del' });
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent[0].envelope.event).toMatchObject({ op: 'del' });
    });

    it('leaves another app`s namespace alone', async () => {
        vi.useFakeTimers();
        await subscribeKv(`kv:${OWN_APP}:cart`);

        await dispatchKv(['cart'], { appUid: OTHER_APP });
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toEqual([]);
    });

    it('sends only the projected shape', async () => {
        vi.useFakeTimers();
        await subscribeKv(`kv:${OWN_APP}:cart`);

        await dispatchKv(['cart']);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(Object.keys(sent[0].envelope.event).sort()).toEqual([
            'id',
            'key',
            'op',
            'self',
            'seq',
            'subject',
            'ts',
        ]);
    });
});

describe('what a kv dispatch costs', () => {
    it('spends no redis command for a user with nothing subscribed', async () => {
        await dispatchKv(['cart']);
        commands = [];

        for (let i = 0; i < 5; i++) await dispatchKv(['cart']);

        expect(commands).toEqual([]);
    });

    it('spends nothing at all when the switch is off', async () => {
        const { service: off } = buildService({
            events: { enabled: false },
        } as IConfig);

        await dispatchKv(['cart'], {}, off);

        expect(commands).toEqual([]);
    });

    it('spends one command, and no store read, on an unwatched key', async () => {
        await subscribeKv(`kv:${OWN_APP}:cart`);
        await dispatchKv(['elsewhere']);
        commands = [];

        await dispatchKv(['elsewhere']);

        expect(commands).toEqual(['smismember']);
        expect(sent).toEqual([]);
    });

    it('asks about a whole batch of keys in one membership test', async () => {
        await subscribeKv(`kv:${OWN_APP}:cart:*`);
        const keys = Array.from({ length: 20 }, (_, i) => `cart:${i}`);
        await dispatchKv(keys);
        commands = [];

        await dispatchKv(keys);

        expect(commands).toEqual(['smismember', 'pipeline']);
    });
});

describe('the cross-app kv gate', () => {
    const grantRead = (app: string) =>
        grants.add(`app-data:${app}:kv:read`);

    const crossAppService = () =>
        buildService({
            events: { enabled: true, crossAppKv: true },
        } as IConfig);

    it('is off unless the config turns it on', () => {
        expect(service.crossAppKvEnabled).toBe(false);
        expect(crossAppService().service.crossAppKvEnabled).toBe(true);
    });

    it('refuses a cross-app subject with a stable code while off', async () => {
        await expect(subscribeKv(`kv:${OTHER_APP}:cart`)).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.legacyCode === 'events_cross_app_disabled',
        );
    });

    it('asks nothing at all for the app`s own namespace', async () => {
        ({ service, sent, delivered } = {
            ...crossAppService(),
            delivered: [],
        } as never);
        vi.useFakeTimers();

        await subscribeKv(`kv:${OWN_APP}:cart`);
        await dispatchKv(['cart']);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
        expect(permissionChecks).toEqual([]);
    });

    it('asks nothing for a user acting on their own data', async () => {
        ({ service, sent } = crossAppService());
        vi.useFakeTimers();

        await subscribeKv(`kv:${OTHER_APP}:cart`, actorFor());
        await dispatchKv(['cart'], { appUid: OTHER_APP });
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
        expect(permissionChecks).toEqual([]);
    });

    it('delivers to an app the user granted', async () => {
        ({ service, sent } = crossAppService());
        grantRead(OTHER_APP);
        vi.useFakeTimers();

        await subscribeKv(`kv:${OTHER_APP}:cart`);
        await dispatchKv(['cart'], { appUid: OTHER_APP });
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toHaveLength(1);
        expect(permissionChecks).toContain(`app-data:${OTHER_APP}:kv:read`);
    });

    it('refuses an app the user never granted', async () => {
        ({ service } = crossAppService());

        await expect(subscribeKv(`kv:${OTHER_APP}:cart`)).rejects.toSatisfy(
            (err: unknown) => isHttpError(err) && err.legacyCode === 'forbidden',
        );
    });

    it('answers an app that is not there as absent', async () => {
        ({ service } = crossAppService());
        grantRead('app-gone');
        apps.set('app-gone', null);

        await expect(subscribeKv('kv:app-gone:cart')).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.legacyCode === 'subject_does_not_exist',
        );
    });

    it('refuses an app that opted out of sharing', async () => {
        ({ service } = crossAppService());
        grantRead(OTHER_APP);
        apps.set(OTHER_APP, {
            uid: OTHER_APP,
            id: 1,
            metadata: { share_app_data: false },
        });

        await expect(subscribeKv(`kv:${OTHER_APP}:cart`)).rejects.toSatisfy(
            (err: unknown) => isHttpError(err) && err.legacyCode === 'forbidden',
        );
    });

    it('shares an app with no metadata at all — sharing is opt-out', async () => {
        ({ service } = crossAppService());
        grantRead(OTHER_APP);
        apps.set(OTHER_APP, { uid: OTHER_APP, id: 1 });

        await expect(
            subscribeKv(`kv:${OTHER_APP}:cart`),
        ).resolves.toMatchObject({ anchor: { uid: OTHER_APP } });
    });

    it('stops delivering the moment the grant goes', async () => {
        ({ service, sent } = crossAppService());
        grantRead(OTHER_APP);
        vi.useFakeTimers();
        await subscribeKv(`kv:${OTHER_APP}:cart`);

        grants.clear();
        await dispatchKv(['cart'], { appUid: OTHER_APP });
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toEqual([]);
    });

    it('stops delivering the moment the target stops sharing', async () => {
        ({ service, sent } = crossAppService());
        grantRead(OTHER_APP);
        vi.useFakeTimers();
        await subscribeKv(`kv:${OTHER_APP}:cart`);

        // Nothing bumps the permission generation here, which is why the KV
        // re-check does not lean on the cross-event cache.
        apps.set(OTHER_APP, {
            uid: OTHER_APP,
            id: 1,
            metadata: { share_app_data: false },
        });
        await dispatchKv(['cart'], { appUid: OTHER_APP });
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toEqual([]);
    });
});

describe('cross-user kv handles', () => {
    const PREFIX = 'workspace:abc:';
    let handle: string;
    let guestId: number;
    let permission: string;

    const handleService = () =>
        buildService({
            events: { enabled: true, kvHandles: true },
        } as IConfig);

    /** A live handle over the dispatching user's namespace, held by a guest. */
    const mintHandle = (
        overrides: Partial<KvShareHandle> = {},
    ): KvShareHandle => {
        const row: KvShareHandle = {
            handle,
            ownerUserId: userId,
            granteeUserId: guestId,
            appUid: OWN_APP,
            keyPrefix: PREFIX,
            permission,
            createdAt: 0,
            revokedAt: null,
            ...overrides,
        };
        handles.set(row.handle, row);
        return row;
    };

    const subscribeAsGuest = (subject: string, on = service) =>
        on.subscribe(actorFor(guestId), socketId, { subject });

    beforeEach(() => {
        handle = `kvh-${userId}`;
        guestId = userId + 500;
        permission = kvSharePermission(`user-${userId}`, OWN_APP, PREFIX);
        ({ service, sent, delivered } = {
            ...handleService(),
            delivered: [],
        } as never);
        grants.add(permission);
    });

    it('is off unless the config turns it on', async () => {
        mintHandle();
        const { service: off } = buildService({
            events: { enabled: true },
        } as IConfig);
        expect(off.kvHandlesEnabled).toBe(false);
        expect(service.kvHandlesEnabled).toBe(true);

        await expect(
            subscribeAsGuest(`kv:${handle}:*`, off),
        ).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.legacyCode === 'events_kv_handles_disabled',
        );
    });

    it('anchors where the owner`s own equivalent subject would', async () => {
        mintHandle();
        const guest = (await subscribeAsGuest(`kv:${handle}:*`)).sub;
        const owner = await subscribeKv(`kv:${OWN_APP}:${PREFIX}*`);

        // The socket set is keyed by the holder, and these two are different
        // people watching one anchor.
        const [guestRow] = await store.listForSocket(guestId, socketId);
        const [ownerRow] = await store.listForSocket(userId, socketId);
        expect(guestRow?.subId).toBe(guest.subId);
        expect(ownerRow?.subId).toBe(owner.subId);

        expect(guestRow?.token).toBe(ownerRow?.token);
        expect(guestRow?.token).toBe(
            kvAnchorToken(`user-${userId}`, OWN_APP, PREFIX),
        );
        // Keyed on the owner, because that is all a write knows about itself.
        expect(guestRow?.ownerUserId).toBe(userId);
        expect(guestRow?.holderUserId).toBe(guestId);
    });

    it('never hands the grantee the owner`s identity', async () => {
        mintHandle();
        const { sub } = await subscribeAsGuest(`kv:${handle}:messages:*`);

        const wire = JSON.stringify(sub);
        expect(sub.subject).toBe(`kv:${handle}:messages:*`);
        expect(wire).not.toContain(`user-${userId}`);
        expect(wire).not.toContain(`u${userId}`);
    });

    it('delivers every key under the granted region', async () => {
        mintHandle();
        vi.useFakeTimers();
        const { sub } = await subscribeAsGuest(`kv:${handle}:*`);

        await dispatchKv([`${PREFIX}messages:1`, `${PREFIX}title`]);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent.map((out) => out.envelope.subId)).toEqual([
            sub.subId,
            sub.subId,
        ]);
        // The write was the owner's, and the grantee is somebody else.
        expect(sent[0].envelope.event).toMatchObject({ self: false });
    });

    it('leaves a key outside the granted region alone', async () => {
        mintHandle();
        vi.useFakeTimers();
        await subscribeAsGuest(`kv:${handle}:*`);

        await dispatchKv(['workspace:other:messages:1']);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toEqual([]);
    });

    it('narrows to a sub-region under the handle', async () => {
        mintHandle();
        vi.useFakeTimers();
        await subscribeAsGuest(`kv:${handle}:messages:*`);

        await dispatchKv([`${PREFIX}title`]);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);
        expect(sent).toEqual([]);

        await dispatchKv([`${PREFIX}messages:1`]);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);
        expect(sent).toHaveLength(1);
    });

    it('asks once per subscription however many events arrive', async () => {
        mintHandle();
        vi.useFakeTimers();
        await subscribeAsGuest(`kv:${handle}:*`);
        permissionChecks.length = 0;

        for (let i = 0; i < 5; i++) {
            await dispatchKv([`${PREFIX}messages:${i}`]);
            await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);
        }

        expect(sent).toHaveLength(5);
        // The handle is the granted root, so nothing under it can vary the
        // answer — one evaluation covers the lot until a generation moves.
        expect(
            permissionChecks.filter((asked) => asked === permission),
        ).toEqual([permission]);
    });

    it('stops delivering when the grant is gone', async () => {
        mintHandle();
        vi.useFakeTimers();
        await subscribeAsGuest(`kv:${handle}:*`);

        grants.delete(permission);
        permissionGeneration++;
        await dispatchKv([`${PREFIX}messages:1`]);
        await vi.advanceTimersByTimeAsync(EVENTS_COALESCE_WINDOW_MS + 1);

        expect(sent).toEqual([]);
    });

    it.each([
        ['an unknown handle', () => undefined],
        ['a revoked handle', () => mintHandle({ revokedAt: 1 })],
        ['a handle whose grant the caller does not hold', () => {
            mintHandle();
            grants.delete(permission);
        }],
    ])('answers %s as absent', async (_case, setUp) => {
        setUp();
        await expect(subscribeAsGuest(`kv:${handle}:*`)).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 404 &&
                err.legacyCode === 'subject_does_not_exist',
        );
    });

    it('refuses a key that reads as leaving the region', async () => {
        mintHandle();
        await expect(
            subscribeAsGuest(`kv:${handle}:..:secrets`),
        ).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) && err.legacyCode === 'invalid_kv_handle_key',
        );
    });
});
