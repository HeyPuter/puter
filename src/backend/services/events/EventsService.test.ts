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
import { EventSubscriptionStore } from '../../stores/events/EventSubscriptionStore.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { IConfig } from '../../types.js';
import {
    EventsService,
    EVENTS_DELIVERY_CHANNEL,
    EVENTS_SUBSCRIBE_VERB,
    EVENTS_UNSUBSCRIBE_VERB,
    type DeliveryEnvelope,
    type EventSocket,
} from './EventsService.js';
import { FILTER_EVALUATIONS_PER_EVENT } from './matcher.js';

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
        ([key]: [string]) => key === 'outer.events.generationBumped',
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

/**
 * Paths the ACL says no to, and how loudly. The real check is exercised against
 * real grants in the integration suite; here access is data, so a test can say
 * "this went away" without staging a share.
 */
let denied: Map<string, 'hidden' | 'forbidden'>;

const aclService = () => ({
    check: async (_actor: Actor, resource: { path: string }) =>
        !denied.has(resource.path),
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

const appStore = {
    getByUid: async (uid: string) => ({ uid, id: 1 }),
};

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
    eventBus: { on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> };
} => {
    const outbox: Array<{ socket?: string; envelope: DeliveryEnvelope }> = [];
    const counted: DeliveryEnvelope[] = [];
    const bus = { on: vi.fn(), emit: vi.fn() };
    const built = new EventsService(
        config,
        {
            redis,
            event: bus,
        } as never,
        {
            eventSubscription: store,
            fsEntry: fsEntryStore,
            user: userStore,
            app: appStore,
        } as never,
        {
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
        } as never,
    );
    built.onDelivered = (envelope) => counted.push(envelope);
    built.onServerStart();
    return { service: built, sent: outbox, delivered: counted, eventBus: bus };
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

beforeEach(() => {
    seq++;
    userId = 1000 + seq;
    socketId = `socket-${seq}`;
    commands = [];
    entries = new Map();
    denied = new Map();
    redis = countingRedis(new MockRedis.Cluster(['redis://localhost:7001']));
    store = new EventSubscriptionStore(
        {} as IConfig,
        { redis } as never,
        {} as never,
    );
    ({ service, sent, delivered, eventBus } = buildService({
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
        });
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
            'outer.events.generationBumped',
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
            'outer.events.generationBumped',
            { userId, generation: 1 },
            {},
        );
        await dispatch(file);

        expect(commands).toEqual([]);
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
