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

import { EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET } from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterStore } from '../types.js';
import type {
    DispatchSubscription,
    DurableSubscription,
    GenerationBump,
    SessionSubscription,
} from './types.js';

/**
 * The region's subscription keyspace. Session rows live here and nowhere else —
 * keyed to the socket that holds them, gone when it disconnects — and durable
 * rows are cached here over the table that owns them, so dispatch reads one
 * place whichever kind answered.
 *
 * Rows are indexed by the **owner of the anchor node**, not by the subscriber:
 * dispatch knows only whose resource changed, and a subscription on a folder
 * shared with someone else has to be found from that side. The subscriber is
 * still on the row — it is who the delivery is for and whose access is
 * re-checked — but it is not what anything is keyed by.
 *
 * Keys carry a `{<userId>}` hash tag so one user's set lives in one cluster
 * slot and a pipeline over it never crosses slots. Four keys, each answering
 * one question:
 *
 *     ev:w:{<ownerId>}             SET   which tokens anyone is watching
 *     ev:t:{<ownerId>}:<token>     HASH  subId -> row, for one watched token
 *     ev:s:{<holderId>}:<socketId> SET   what this socket holds, for reaping
 *     ev:g:{<ownerId>}             STR   subscription-set generation
 *     ev:dm:{<ownerId>}            HASH  subId -> token, durable rows cached here
 *     ev:dw:{<ownerId>}            STR   this region's durable cache is warm
 *
 * The socket set is the one keyed by the holder — it is read on disconnect,
 * when all that is known is whose connection went — so its members name the
 * owner whose keyspace each row lives in, and a write touching both sides
 * splits into one pipeline per slot.
 *
 * `ev:w` is what dispatch asks first and is the only one on the hot path.
 * Membership in it is exact rather than approximate: a token's row hash going
 * empty is what removes it, so an unsubscribe really does stop the lookup.
 *
 * Everything carries a TTL. A socket process that dies without running its
 * disconnect handler leaves keys behind, and the TTL is what collects them — a
 * live socket refreshes its own, so the backstop only ever fires on rows whose
 * socket is gone.
 *
 * Durable rows share the row hash and the watched set rather than getting their
 * own: `ev:w` is the one key on the hot path, and a token still wanted by a
 * durable row has to stay in it when a session row on the same anchor goes —
 * which the existing "drop the token once its hash is empty" rule gets right
 * for free. What durable rows add is the warm marker, which is how a region
 * tells "nobody is subscribed" apart from "this region has not looked yet".
 */

export type {
    DispatchSubscription,
    DurableSubscription,
    GenerationBump,
    SessionSubscription,
} from './types.js';

// -- Keys -------------------------------------------------------------

const watchedKey = (userId: number | string): string => `ev:w:{${userId}}`;
const tokenKey = (userId: number | string, token: string): string =>
    `ev:t:{${userId}}:${token}`;
const socketKey = (userId: number | string, socketId: string): string =>
    `ev:s:{${userId}}:${socketId}`;
const generationKey = (userId: number | string): string => `ev:g:{${userId}}`;
const durableMapKey = (userId: number | string): string => `ev:dm:{${userId}}`;
const durableWarmKey = (userId: number | string): string => `ev:dw:{${userId}}`;

/** `ev:s` members name the row they point at, and the keyspace it is in. */
interface SocketRef {
    ownerUserId: number;
    token: string;
    subId: string;
}

const socketRef = (ref: SocketRef): string =>
    `${ref.ownerUserId}|${ref.token}|${ref.subId}`;

const parseSocketRef = (ref: string): SocketRef => {
    const owner = ref.indexOf('|');
    const token = ref.indexOf('|', owner + 1);
    return {
        ownerUserId: Number(ref.slice(0, owner)),
        token: ref.slice(owner + 1, token),
        subId: ref.slice(token + 1),
    };
};

/** Group refs by the keyspace they live in, so no pipeline crosses slots. */
const byOwner = (refs: readonly SocketRef[]): Map<number, SocketRef[]> => {
    const grouped = new Map<number, SocketRef[]>();
    for (const ref of refs) {
        const held = grouped.get(ref.ownerUserId) ?? [];
        held.push(ref);
        grouped.set(ref.ownerUserId, held);
    }
    return grouped;
};

// -- Lifetimes --------------------------------------------------------

/**
 * How long a session key survives without its socket. Long enough that a
 * refresh can be missed a few times over, short enough that a dead node's rows
 * are gone well before anyone notices them.
 */
export const SESSION_SUBSCRIPTION_TTL_SECONDS = 60 * 60;

/**
 * The generation counter outlives the subscriptions it orders — a bump that
 * expired and restarted at zero would let a stale cached answer look current
 * again.
 */
const GENERATION_TTL_SECONDS = 24 * 60 * 60;

/** How long a cached durable row stays readable without being rebuilt. */
export const DURABLE_CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long a region trusts its durable cache before reading the table again.
 * Long, because most owners have nothing durable and a real change marks the
 * region cold itself; this only backstops a bump a region never received.
 * Longer than the session TTL, so `#keepDurableWindow` is what holds cached
 * rows open against a session-shortened key.
 */
export const DURABLE_WARM_TTL_SECONDS = 6 * 60 * 60;

const subscriptionLimitReached = (): HttpError =>
    new HttpError(
        429,
        `A connection may hold ${EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET} subscriptions`,
        { legacyCode: 'events_subscription_limit' },
    );

export class EventSubscriptionStore extends PuterStore {
    // -- Writes ------------------------------------------------------

    /**
     * Register one subscription. Returns the owner's new generation, so the
     * caller can broadcast it — that is the keyspace dispatch reads.
     *
     * Ordering is deliberate: the row lands before the token joins the watched
     * set, so dispatch never sees a token whose rows it cannot read yet.
     *
     * The cap is decided on the cardinality after `sadd`, rolling the member
     * back when over — `scard` then `sadd` would let two concurrent adds both
     * pass.
     */
    async add(sub: SessionSubscription): Promise<GenerationBump> {
        const { holderUserId, ownerUserId, socketId, token, subId } = sub;
        const ref = socketRef({ ownerUserId, token, subId });

        const holder = this.clients.redis.pipeline();
        holder.sadd(socketKey(holderUserId, socketId), ref);
        holder.expire(
            socketKey(holderUserId, socketId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        holder.scard(socketKey(holderUserId, socketId));
        const counted = ((await holder.exec()) ?? [])[2];
        const held = Number(counted?.[1]);
        // A count that could not be read is not a count under the cap.
        if (
            counted?.[0] ||
            !Number.isFinite(held) ||
            held > EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET
        ) {
            await this.clients.redis.srem(
                socketKey(holderUserId, socketId),
                ref,
            );
            throw counted?.[0] ?? subscriptionLimitReached();
        }

        const rows = this.clients.redis.pipeline();
        rows.hset(tokenKey(ownerUserId, token), subId, JSON.stringify(sub));
        rows.expire(
            tokenKey(ownerUserId, token),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        rows.sadd(watchedKey(ownerUserId), token);
        rows.expire(watchedKey(ownerUserId), SESSION_SUBSCRIPTION_TTL_SECONDS);
        await rows.exec();

        await this.#keepDurableWindow(ownerUserId, [token]);

        return {
            userId: ownerUserId,
            generation: await this.bumpGeneration(ownerUserId),
        };
    }

    /**
     * Put the durable window back on whatever a session write just shortened.
     * Session and durable rows share the watched set and the row hashes, and
     * the session TTL is far the shorter of the two — left alone, a socket
     * touching a key durable rows live in would expire them while this region
     * still holds a warm marker saying it has looked, and dispatch would read
     * "nobody is subscribed" until that marker lapsed.
     */
    async #keepDurableWindow(
        ownerUserId: number,
        touched: readonly string[],
    ): Promise<void> {
        const cached = await this.clients.redis.hvals(
            durableMapKey(ownerUserId),
        );
        if (cached.length === 0) return;

        const durable = new Set(cached.map(String));
        const restore = this.clients.redis.pipeline();
        restore.expire(watchedKey(ownerUserId), DURABLE_CACHE_TTL_SECONDS);
        restore.expire(durableMapKey(ownerUserId), DURABLE_CACHE_TTL_SECONDS);
        for (const token of touched)
            if (durable.has(token))
                restore.expire(
                    tokenKey(ownerUserId, token),
                    DURABLE_CACHE_TTL_SECONDS,
                );
        await restore.exec();
    }

    /**
     * Drop one subscription the caller has already read back. Taking the row
     * rather than an id keeps the scope decision — whose row this is, and which
     * app's — with the actor, where it belongs.
     */
    async remove(sub: SessionSubscription): Promise<GenerationBump> {
        await this.#dropRefs(sub.holderUserId, sub.socketId, [
            {
                ownerUserId: sub.ownerUserId,
                token: sub.token,
                subId: sub.subId,
            },
        ]);
        return {
            userId: sub.ownerUserId,
            generation: await this.bumpGeneration(sub.ownerUserId),
        };
    }

    /**
     * Move one session row onto a different anchor, keeping its id and its
     * socket. Not `remove` then `add`: this is the same subscription, so it
     * must not be turned away by the per-connection cap it already occupies a
     * slot in, and the new anchor may sit in a different owner's keyspace.
     */
    async reanchorSession(
        previous: SessionSubscription,
        next: SessionSubscription,
    ): Promise<GenerationBump[]> {
        await this.#dropRefs(previous.holderUserId, previous.socketId, [
            {
                ownerUserId: previous.ownerUserId,
                token: previous.token,
                subId: previous.subId,
            },
        ]);

        const rows = this.clients.redis.pipeline();
        const key = tokenKey(next.ownerUserId, next.token);
        rows.hset(key, next.subId, JSON.stringify(next));
        rows.expire(key, SESSION_SUBSCRIPTION_TTL_SECONDS);
        rows.sadd(watchedKey(next.ownerUserId), next.token);
        rows.expire(
            watchedKey(next.ownerUserId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        await rows.exec();

        const holder = this.clients.redis.pipeline();
        holder.sadd(
            socketKey(next.holderUserId, next.socketId),
            socketRef({
                ownerUserId: next.ownerUserId,
                token: next.token,
                subId: next.subId,
            }),
        );
        holder.expire(
            socketKey(next.holderUserId, next.socketId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        await holder.exec();

        await this.#keepDurableWindow(next.ownerUserId, [next.token]);

        const owners = new Set([previous.ownerUserId, next.ownerUserId]);
        return Promise.all(
            [...owners].map(async (userId) => ({
                userId,
                generation: await this.bumpGeneration(userId),
            })),
        );
    }

    /**
     * Drop everything a socket held. Runs on disconnect; the TTL is what covers
     * the disconnect that never runs. One socket can hold rows in several
     * owners' keyspaces, so several generations may move.
     */
    async reapSocket(
        holderUserId: number,
        socketId: string,
    ): Promise<GenerationBump[]> {
        const refs = (
            await this.clients.redis.smembers(socketKey(holderUserId, socketId))
        ).map(parseSocketRef);
        if (refs.length === 0) return [];

        await this.#dropRefs(holderUserId, socketId, refs);
        const bumps: GenerationBump[] = [];
        for (const ownerUserId of byOwner(refs).keys())
            bumps.push({
                userId: ownerUserId,
                generation: await this.bumpGeneration(ownerUserId),
            });
        return bumps;
    }

    /** Forget a socket's refs, then the rows they point at. */
    async #dropRefs(
        holderUserId: number,
        socketId: string,
        refs: readonly SocketRef[],
    ): Promise<void> {
        await this.clients.redis.srem(
            socketKey(holderUserId, socketId),
            ...refs.map(socketRef),
        );

        for (const [ownerUserId, owned] of byOwner(refs))
            await this.#dropRows(ownerUserId, owned);
    }

    /**
     * Drop rows from one owner's keyspace and then any token whose rows are all
     * gone. Emptiness is what un-watches a token, which is what keeps one
     * socket's unsubscribe — or a durable row's removal — from silencing
     * another subscription on the same anchor.
     */
    async #dropRows(
        ownerUserId: number,
        rows: ReadonlyArray<{ token: string; subId: string }>,
    ): Promise<void> {
        if (rows.length === 0) return;

        const drop = this.clients.redis.pipeline();
        for (const { token, subId } of rows)
            drop.hdel(tokenKey(ownerUserId, token), subId);
        await drop.exec();

        const tokens = [...new Set(rows.map((row) => row.token))];
        const counts = this.clients.redis.pipeline();
        for (const token of tokens) counts.hlen(tokenKey(ownerUserId, token));
        const results = (await counts.exec()) ?? [];

        const orphaned = tokens.filter(
            (_token, i) => Number(results[i]?.[1] ?? 0) === 0,
        );
        if (orphaned.length === 0) return;

        await this.clients.redis.srem(watchedKey(ownerUserId), ...orphaned);

        // A concurrent `add` can `hset` a fresh row onto one of these tokens
        // between the count above and the `srem` — self-heal rather than
        // leave it orphaned in the hash but absent from the watched set until
        // something else happens to touch it.
        const recheck = this.clients.redis.pipeline();
        for (const token of orphaned)
            recheck.hlen(tokenKey(ownerUserId, token));
        const recounted = (await recheck.exec()) ?? [];
        const revived = orphaned.filter(
            (_token, i) => Number(recounted[i]?.[1] ?? 0) > 0,
        );
        if (revived.length > 0)
            await this.clients.redis.sadd(watchedKey(ownerUserId), ...revived);
    }

    /**
     * Keep a live socket's keys ahead of the TTL backstop — its own, and the
     * watched sets its rows live in, which may belong to other users.
     *
     * Re-asserts each token into the watched set rather than only extending its
     * TTL: a live row is proof its token belongs there, so a race that silently
     * dropped it (see `#dropRows`) heals itself on the next refresh even if
     * nothing catches it sooner.
     */
    async refresh(holderUserId: number, socketId: string): Promise<void> {
        const refs = (
            await this.clients.redis.smembers(socketKey(holderUserId, socketId))
        ).map(parseSocketRef);

        await this.clients.redis.expire(
            socketKey(holderUserId, socketId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );

        for (const [ownerUserId, owned] of byOwner(refs)) {
            const tokens = [...new Set(owned.map((ref) => ref.token))];
            const pipeline = this.clients.redis.pipeline();
            pipeline.sadd(watchedKey(ownerUserId), ...tokens);
            pipeline.expire(
                watchedKey(ownerUserId),
                SESSION_SUBSCRIPTION_TTL_SECONDS,
            );
            for (const token of tokens)
                pipeline.expire(
                    tokenKey(ownerUserId, token),
                    SESSION_SUBSCRIPTION_TTL_SECONDS,
                );
            await pipeline.exec();

            await this.#keepDurableWindow(ownerUserId, tokens);
        }
    }

    // -- Durable rows in the region cache ----------------------------

    /**
     * Cache durable rows so dispatch finds them without the table. Ordering
     * matches `add`: rows land before their tokens join the watched set.
     */
    async cacheDurable(rows: readonly DurableSubscription[]): Promise<void> {
        if (rows.length === 0) return;
        const ownerUserId = rows[0].ownerUserId;

        const write = this.clients.redis.pipeline();
        for (const row of rows) {
            const key = tokenKey(ownerUserId, row.token);
            write.hset(key, row.subId, JSON.stringify(row));
            write.expire(key, DURABLE_CACHE_TTL_SECONDS);
            write.hset(durableMapKey(ownerUserId), row.subId, row.token);
        }
        write.sadd(watchedKey(ownerUserId), ...rows.map((row) => row.token));
        write.expire(watchedKey(ownerUserId), DURABLE_CACHE_TTL_SECONDS);
        write.expire(durableMapKey(ownerUserId), DURABLE_CACHE_TTL_SECONDS);
        await write.exec();
    }

    /** Forget one cached durable row, un-watching its token if it was the last. */
    async dropDurable(row: {
        ownerUserId: number;
        token: string;
        subId: string;
    }): Promise<void> {
        await this.clients.redis.hdel(
            durableMapKey(row.ownerUserId),
            row.subId,
        );
        await this.#dropRows(row.ownerUserId, [
            { token: row.token, subId: row.subId },
        ]);
    }

    /**
     * Replace everything this region has cached for one owner. Rows that are no
     * longer in the table go, which is how an unsubscribe taken in another
     * region eventually stops delivering here.
     */
    async rebuildDurable(
        ownerUserId: number,
        rows: readonly DurableSubscription[],
    ): Promise<void> {
        const cached = await this.clients.redis.hgetall(
            durableMapKey(ownerUserId),
        );
        const fresh = new Set(rows.map((row) => row.subId));
        const stale = Object.entries(cached ?? {})
            .filter(([subId]) => !fresh.has(subId))
            .map(([subId, token]) => ({ subId, token: String(token) }));

        if (stale.length > 0) {
            await this.clients.redis.hdel(
                durableMapKey(ownerUserId),
                ...stale.map((row) => row.subId),
            );
            await this.#dropRows(ownerUserId, stale);
        }
        await this.cacheDurable(rows);
        await this.markRegionWarm(ownerUserId);
    }

    /** Whether this region has read the table for this owner recently. */
    async isRegionWarm(ownerUserId: number): Promise<boolean> {
        return (
            (await this.clients.redis.exists(durableWarmKey(ownerUserId))) === 1
        );
    }

    async markRegionWarm(ownerUserId: number): Promise<void> {
        await this.clients.redis.set(
            durableWarmKey(ownerUserId),
            '1',
            'EX',
            DURABLE_WARM_TTL_SECONDS,
        );
    }

    /**
     * Force the next dispatch in this region to read the table again. What a
     * generation bump from anywhere lands on.
     */
    async markRegionCold(ownerUserId: number): Promise<void> {
        await this.clients.redis.del(durableWarmKey(ownerUserId));
    }

    // -- Reads -------------------------------------------------------

    /**
     * Whether anyone watches anything of this owner's at all. One command, and
     * the only thing a cold process needs before it can answer from memory.
     */
    async userHasAny(ownerUserId: number): Promise<boolean> {
        return (await this.clients.redis.exists(watchedKey(ownerUserId))) === 1;
    }

    /**
     * Which of an event's tokens anyone is watching — the dispatch hot path,
     * and one command whatever the depth of the tree.
     */
    async watchedTokens(
        ownerUserId: number,
        tokens: readonly string[],
    ): Promise<string[]> {
        if (tokens.length === 0) return [];
        const flags = await this.clients.redis.smismember(
            watchedKey(ownerUserId),
            ...tokens,
        );
        return tokens.filter((_token, i) => Number(flags[i]) === 1);
    }

    /** The rows behind a set of watched tokens, session and durable alike. */
    async getForTokens(
        ownerUserId: number,
        tokens: readonly string[],
    ): Promise<DispatchSubscription[]> {
        if (tokens.length === 0) return [];
        const pipeline = this.clients.redis.pipeline();
        for (const token of tokens)
            pipeline.hvals(tokenKey(ownerUserId, token));
        const results = (await pipeline.exec()) ?? [];

        const subs: DispatchSubscription[] = [];
        for (const [, raw] of results) {
            for (const row of (raw as string[] | null) ?? []) {
                try {
                    subs.push(JSON.parse(row) as DispatchSubscription);
                } catch {
                    // A row we cannot read is a row we cannot deliver against.
                }
            }
        }
        return subs;
    }

    /** Everything one socket holds, across every keyspace its rows live in. */
    async listForSocket(
        holderUserId: number,
        socketId: string,
    ): Promise<SessionSubscription[]> {
        const refs = (
            await this.clients.redis.smembers(socketKey(holderUserId, socketId))
        ).map(parseSocketRef);
        if (refs.length === 0) return [];

        const held: SessionSubscription[] = [];
        for (const [ownerUserId, owned] of byOwner(refs)) {
            const wanted = new Set(owned.map((ref) => ref.subId));
            const rows = await this.getForTokens(ownerUserId, [
                ...new Set(owned.map((ref) => ref.token)),
            ]);
            held.push(
                ...rows.filter(
                    (row): row is SessionSubscription =>
                        wanted.has(row.subId) && row.socketId !== undefined,
                ),
            );
        }
        return held;
    }

    /**
     * One row this socket holds, by id. An id the socket never held reads as
     * absent, which is what keeps unsubscribe from answering whether someone
     * else's id exists.
     */
    async getForSocket(
        holderUserId: number,
        socketId: string,
        subId: string,
    ): Promise<SessionSubscription | null> {
        const refs = await this.clients.redis.smembers(
            socketKey(holderUserId, socketId),
        );
        const ref = refs
            .map(parseSocketRef)
            .find((candidate) => candidate.subId === subId);
        if (!ref) return null;

        const raw = await this.clients.redis.hget(
            tokenKey(ref.ownerUserId, ref.token),
            subId,
        );
        if (!raw) return null;
        try {
            return JSON.parse(raw) as SessionSubscription;
        } catch {
            return null;
        }
    }

    // -- Generation --------------------------------------------------

    /**
     * Advance the user's subscription-set generation. A single-key `INCR`, so
     * it is cluster-safe and costs one command; the broadcast that carries it
     * is what actually invalidates other processes.
     */
    async bumpGeneration(userId: number | string): Promise<number> {
        const key = generationKey(userId);
        const next = await this.clients.redis.incr(key);
        await this.clients.redis.expire(key, GENERATION_TTL_SECONDS);
        return typeof next === 'number' ? next : 0;
    }

    async getGeneration(userId: number | string): Promise<number> {
        const raw = await this.clients.redis.get(generationKey(userId));
        const n = raw === null ? 0 : Number.parseInt(raw, 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    }
}
