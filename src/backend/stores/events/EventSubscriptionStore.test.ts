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
import { beforeEach, describe, expect, it } from 'vitest';
import { EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET } from '../../controllers/events/limits.js';
import { isHttpError } from '../../core/http/HttpError.js';
import type { IConfig } from '../../types.js';
import {
    EventSubscriptionStore,
    SESSION_SUBSCRIPTION_TTL_SECONDS,
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
    userId: USER,
    subject: 'fs:/testuser/Documents',
    token: 'f#anchor',
    anchorUid: 'anchor',
    anchorPath: '/testuser/Documents',
    match: null,
    op: null,
    appUid: null,
    ...over,
});

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
        ).resolves.toBeGreaterThan(0);
    });
});

describe('removal', () => {
    it('stops the token being watched once its last row goes', async () => {
        const sub = makeSub();
        await store.add(sub);

        await store.remove(USER, sub.socketId, sub.subId);

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

        await store.remove(USER, 'socket-a', 'mine');

        await expect(store.watchedTokens(USER, ['f#anchor'])).resolves.toEqual([
            'f#anchor',
        ]);
        await expect(store.getForTokens(USER, ['f#anchor'])).resolves.toEqual([
            theirs,
        ]);
    });

    it('reports an id this socket never held as absent', async () => {
        await store.add(makeSub({ subId: 'mine', socketId: 'socket-a' }));

        await expect(
            store.remove(USER, 'socket-b', 'mine'),
        ).resolves.toBeNull();
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
        await expect(store.reapSocket(USER, 'socket-z')).resolves.toBeNull();
    });
});

describe('the generation counter', () => {
    it('advances on every registration and removal', async () => {
        const first = await store.add(makeSub({ subId: 'a' }));
        const second = await store.add(makeSub({ subId: 'b', token: 'f#two' }));
        expect(second).toBeGreaterThan(first);

        const third = await store.remove(USER, 'socket-a', 'a');
        expect(third).toBeGreaterThan(second);
        await expect(store.getGeneration(USER)).resolves.toBe(third);
    });

    it('outlives the subscriptions it orders', async () => {
        await store.add(makeSub());
        await store.reapSocket(USER, 'socket-a');

        expect(await redis.ttl(`ev:g:{${USER}}`)).toBeGreaterThan(
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
    });
});
