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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET } from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import type { IConfig } from '../../types.js';
import {
    EventSubscriptionStore,
    SESSION_SUBSCRIPTION_TTL_SECONDS,
    type DurableSubscription,
    type SessionSubscription,
} from './EventSubscriptionStore.js';

// ioredis-mock keeps one keyspace per process, so each test gets its own user
// rather than trying to reset a shared one between them.
let userSeq = 0;
let USER = 0;

let redis: InstanceType<typeof MockRedis.Cluster>;
let store: EventSubscriptionStore;

const makeSub = (
    over: Partial<SessionSubscription> = {},
): SessionSubscription => ({
    subId: over.subId ?? `sub-${Math.random().toString(36).slice(2)}`,
    socketId: 'socket-a',
    holderUserId: USER,
    ownerUserId: USER,
    subject: 'fs:/testuser/Documents',
    token: 'f#anchor',
    anchorUid: 'anchor',
    anchorPath: '/testuser/Documents',
    match: null,
    op: null,
    appUid: null,
    permission: 'list',
    ...over,
});

/** A row on someone else's node: the shared-folder case, in one place. */
const sharedWith = (
    holderUserId: number,
    over: Partial<SessionSubscription> = {},
): SessionSubscription => makeSub({ holderUserId, ownerUserId: USER, ...over });

beforeEach(() => {
    USER = ++userSeq;
    redis = new MockRedis.Cluster(['redis://localhost:7001']);
    store = new EventSubscriptionStore(
        {} as IConfig,
        { redis } as never,
        {} as never,
    );
});

describe('registration', () => {
    it('makes the anchor watched and readable by its token', async () => {
        const sub = makeSub();
        await store.add(sub);

        await expect(store.userHasAny(USER)).resolves.toBe(true);
        await expect(
            store.watchedTokens(USER, ['f#anchor', 'f#elsewhere']),
        ).resolves.toEqual(['f#anchor']);
        await expect(store.getForTokens(USER, ['f#anchor'])).resolves.toEqual([
            sub,
        ]);
    });

    it('indexes a shared anchor under its owner, not its subscriber', async () => {
        const holder = USER + 5000;
        const sub = sharedWith(holder);

        const bump = await store.add(sub);

        // Dispatch only knows whose resource changed, so that is the side the
        // row has to be findable from.
        expect(bump.userId).toBe(USER);
        await expect(store.userHasAny(USER)).resolves.toBe(true);
        await expect(store.userHasAny(holder)).resolves.toBe(false);
        await expect(store.getForTokens(USER, ['f#anchor'])).resolves.toEqual([
            sub,
        ]);
        // The socket set is the one side that is the holder's.
        expect(await redis.smembers(`ev:s:{${holder}}:socket-a`)).toEqual([
            `${USER}|f#anchor|${sub.subId}`,
        ]);
    });

    it('keys every one of a user`s keys into one cluster slot', async () => {
        await store.add(makeSub());
        const keys = await redis.keys(`ev:*{${USER}}*`);

        expect(keys.length).toBeGreaterThan(1);
        for (const key of keys) expect(key).toContain(`{${USER}}`);
    });

    it('leaves nothing without an expiry to collect it', async () => {
        await store.add(makeSub());
        for (const key of await redis.keys(`ev:*{${USER}}*`))
            expect(await redis.ttl(key)).toBeGreaterThan(0);
    });

    it('refreshes a live socket ahead of the backstop', async () => {
        await store.add(makeSub());
        await redis.expire(`ev:w:{${USER}}`, 5);

        await store.refresh(USER, 'socket-a');

        expect(await redis.ttl(`ev:w:{${USER}}`)).toBeGreaterThan(
            SESSION_SUBSCRIPTION_TTL_SECONDS - 10,
        );
    });

    it('refreshes the owner`s keys, not only the holder`s', async () => {
        const holder = USER + 5000;
        await store.add(sharedWith(holder));
        await redis.expire(`ev:w:{${USER}}`, 5);
        await redis.expire(`ev:t:{${USER}}:f#anchor`, 5);

        await store.refresh(holder, 'socket-a');

        for (const key of [`ev:w:{${USER}}`, `ev:t:{${USER}}:f#anchor`])
            expect(await redis.ttl(key)).toBeGreaterThan(
                SESSION_SUBSCRIPTION_TTL_SECONDS - 10,
            );
    });
});

describe('the per-socket cap', () => {
    it('rejects the one past the limit with a stable code', async () => {
        for (let i = 0; i < EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET; i++)
            await store.add(makeSub({ subId: `sub-${i}`, token: `f#n${i}` }));

        const overflow = store.add(makeSub({ subId: 'one-too-many' }));

        await expect(overflow).rejects.toSatisfy(
            (err: unknown) =>
                isHttpError(err) &&
                err.statusCode === 429 &&
                err.legacyCode === 'events_subscription_limit',
        );
    });

    it('counts per socket, not per user', async () => {
        for (let i = 0; i < EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET; i++)
            await store.add(makeSub({ subId: `a-${i}`, token: `f#n${i}` }));

        await expect(
            store.add(makeSub({ subId: 'b-0', socketId: 'socket-b' })),
        ).resolves.toMatchObject({ userId: USER });
    });

    it('never lets pipelined concurrent adds exceed the cap', async () => {
        const attempts = EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET + 10;

        const results = await Promise.allSettled(
            Array.from({ length: attempts }, (_, i) =>
                store.add(makeSub({ subId: `race-${i}`, token: `f#n${i}` })),
            ),
        );

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET);
        expect(rejected).toHaveLength(
            attempts - EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET,
        );
        expect(await redis.scard(`ev:s:{${USER}}:socket-a`)).toBe(
            EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET,
        );
    });
});

describe('removal', () => {
    it('stops the token being watched once its last row goes', async () => {
        const sub = makeSub();
        await store.add(sub);

        await store.remove(sub);

        await expect(store.watchedTokens(USER, ['f#anchor'])).resolves.toEqual(
            [],
        );
        await expect(store.userHasAny(USER)).resolves.toBe(false);
    });

    it('keeps a token watched while another socket still holds it', async () => {
        const mine = makeSub({ subId: 'mine', socketId: 'socket-a' });
        const theirs = makeSub({ subId: 'theirs', socketId: 'socket-b' });
        await store.add(mine);
        await store.add(theirs);

        await store.remove(mine);

        await expect(store.watchedTokens(USER, ['f#anchor'])).resolves.toEqual([
            'f#anchor',
        ]);
        await expect(store.getForTokens(USER, ['f#anchor'])).resolves.toEqual([
            theirs,
        ]);
    });

    it('reads back only what the asking socket holds', async () => {
        const mine = makeSub({ subId: 'mine', socketId: 'socket-a' });
        await store.add(mine);

        await expect(
            store.getForSocket(USER, 'socket-a', 'mine'),
        ).resolves.toEqual(mine);
        await expect(
            store.getForSocket(USER, 'socket-b', 'mine'),
        ).resolves.toBeNull();
        await expect(
            store.getForSocket(USER, 'socket-a', 'not-a-sub'),
        ).resolves.toBeNull();
    });

    it('finds a shared-anchor row from the holder`s socket', async () => {
        const holder = USER + 5000;
        const sub = sharedWith(holder, { subId: 'shared' });
        await store.add(sub);

        await expect(
            store.getForSocket(holder, 'socket-a', 'shared'),
        ).resolves.toEqual(sub);

        await store.remove(sub);
        await expect(store.userHasAny(USER)).resolves.toBe(false);
    });
});

describe('disconnect', () => {
    it('leaves no key behind for the socket that went', async () => {
        await store.add(makeSub({ subId: 'a', token: 'f#one' }));
        await store.add(makeSub({ subId: 'b', token: 'f#two' }));

        await store.reapSocket(USER, 'socket-a');

        await expect(store.userHasAny(USER)).resolves.toBe(false);
        await expect(
            store.watchedTokens(USER, ['f#one', 'f#two']),
        ).resolves.toEqual([]);
        expect(await redis.smembers(`ev:s:{${USER}}:socket-a`)).toEqual([]);
    });

    it('leaves another socket`s subscriptions alone', async () => {
        await store.add(makeSub({ subId: 'a', socketId: 'socket-a' }));
        const survivor = makeSub({
            subId: 'b',
            socketId: 'socket-b',
            token: 'f#other',
        });
        await store.add(survivor);

        await store.reapSocket(USER, 'socket-a');

        await expect(store.listForSocket(USER, 'socket-b')).resolves.toEqual([
            survivor,
        ]);
    });

    it('says nothing changed when the socket held nothing', async () => {
        await expect(store.reapSocket(USER, 'socket-z')).resolves.toEqual([]);
    });

    it('moves the generation of every owner the socket watched', async () => {
        const holder = USER + 5000;
        const otherOwner = USER + 6000;
        await store.add(sharedWith(holder));
        await store.add(
            makeSub({
                subId: 'elsewhere',
                holderUserId: holder,
                ownerUserId: otherOwner,
                token: 'f#other',
            }),
        );

        const bumps = await store.reapSocket(holder, 'socket-a');

        expect(bumps.map((bump) => bump.userId).sort()).toEqual(
            [USER, otherOwner].sort(),
        );
        await expect(store.userHasAny(USER)).resolves.toBe(false);
        await expect(store.userHasAny(otherOwner)).resolves.toBe(false);
    });
});

describe('durable rows sharing a session key', () => {
    const durable = (over: Partial<DurableSubscription> = {}) =>
        ({
            ...makeSub(),
            socketId: undefined,
            durable: true,
            delivery: 'broadcast',
            targets: ['socket'],
            handlerName: null,
            context: null,
            expiresAt: null,
            suspendedAt: null,
            suspendedReason: null,
            createdAt: 0,
            ...over,
        }) as DurableSubscription;

    // The warm marker outlives the session TTL, so a session write leaving the
    // session window on these keys would expire the cached rows while this
    // region still believed it had looked.
    it('keeps the durable window on the keys a session add shortens', async () => {
        await store.cacheDurable([durable({ subId: 'durable-1' })]);
        await store.add(makeSub({ subId: 'session-1' }));

        expect(await redis.ttl(`ev:w:{${USER}}`)).toBeGreaterThan(
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        expect(await redis.ttl(`ev:t:{${USER}}:f#anchor`)).toBeGreaterThan(
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
    });

    it('puts it back on every refresh', async () => {
        await store.cacheDurable([durable({ subId: 'durable-1' })]);
        const session = makeSub({ subId: 'session-1' });
        await store.add(session);
        await redis.expire(`ev:w:{${USER}}`, SESSION_SUBSCRIPTION_TTL_SECONDS);

        await store.refresh(session.holderUserId, session.socketId);

        expect(await redis.ttl(`ev:w:{${USER}}`)).toBeGreaterThan(
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
    });

    it('leaves a session-only token on the session window', async () => {
        await store.cacheDurable([
            durable({ subId: 'durable-1', token: 'f#other' }),
        ]);
        await store.add(makeSub({ subId: 'session-1', token: 'f#anchor' }));

        expect(await redis.ttl(`ev:t:{${USER}}:f#anchor`)).toBeLessThanOrEqual(
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
    });
});

describe('the watched-set race', () => {
    it('heals a token orphaned in the watched set on the next refresh', async () => {
        const sub = makeSub();
        await store.add(sub);

        // What a concurrent `add` racing `#dropRows`'s hdel/hlen/srem leaves
        // behind: the row still live in the hash, its token gone from `ev:w`.
        await redis.srem(`ev:w:{${USER}}`, 'f#anchor');
        await expect(store.watchedTokens(USER, ['f#anchor'])).resolves.toEqual(
            [],
        );

        await store.refresh(sub.holderUserId, sub.socketId);

        await expect(store.watchedTokens(USER, ['f#anchor'])).resolves.toEqual([
            'f#anchor',
        ]);
    });

    it('keeps a token watched when an add revives it between the count and the unwatch', async () => {
        const first = makeSub({ subId: 'first', socketId: 'socket-a' });
        await store.add(first);
        const second = makeSub({ subId: 'second', socketId: 'socket-b' });

        // Force the exact window the fix closes: `#dropRows` has already
        // counted the token empty and decided to unwatch it, and is about to
        // `srem` it from `ev:w` — but a concurrent `add` for a new row on the
        // same token lands right before that call runs. `#dropRefs` also
        // `srem`s the socket key first, so only intercept the watched-set one.
        const original = redis.srem.bind(redis);
        const spy = vi
            .spyOn(redis, 'srem')
            .mockImplementation(
                async (...args: Parameters<typeof redis.srem>) => {
                    if (args[0] !== `ev:w:{${USER}}`) return original(...args);
                    spy.mockRestore();
                    await store.add(second);
                    return original(...args);
                },
            );

        await store.remove(first);

        await expect(store.watchedTokens(USER, ['f#anchor'])).resolves.toEqual([
            'f#anchor',
        ]);
        await expect(store.getForTokens(USER, ['f#anchor'])).resolves.toEqual([
            second,
        ]);
    });
});

describe('the generation counter', () => {
    it('advances on every registration and removal', async () => {
        const first = await store.add(makeSub({ subId: 'a' }));
        const second = await store.add(makeSub({ subId: 'b', token: 'f#two' }));
        expect(second.generation).toBeGreaterThan(first.generation);

        const third = await store.remove(makeSub({ subId: 'a' }));
        expect(third.generation).toBeGreaterThan(second.generation);
        await expect(store.getGeneration(USER)).resolves.toBe(third.generation);
    });

    it('outlives the subscriptions it orders', async () => {
        await store.add(makeSub());
        await store.reapSocket(USER, 'socket-a');

        expect(await redis.ttl(`ev:g:{${USER}}`)).toBeGreaterThan(
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
    });
});
