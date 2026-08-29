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
import type { FsOp } from '../../services/events/subjects.js';
import type { AclMode } from '../../services/acl/ACLService.js';
import { PuterStore } from '../types.js';

/**
 * Session subscriptions: Redis only, keyed to the socket that holds them, gone
 * when it disconnects. Nothing here outlives a connection, so none of it
 * belongs in a table.
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
 */

// -- Types ------------------------------------------------------------

export interface SessionSubscription {
    subId: string;
    socketId: string;
    /** Who subscribed: the delivery target, and whose access is re-checked. */
    holderUserId: number;
    /** Owner of the anchor node: the keyspace this row is indexed in. */
    ownerUserId: number;
    /** The subject as the client asked for it. */
    subject: string;
    /** Anchor token the row is indexed under. */
    token: string;
    anchorUid: string;
    anchorPath: string;
    /** Glob relative to the anchor, or `null` for a node-form subscription. */
    match: string | null;
    op: FsOp | null;
    /** The app that created the row, and the scope of the three verbs. */
    appUid: string | null;
    /** ACL mode the subscribe check passed under; re-checked per delivery. */
    permission: AclMode;
}

/** One owner's generation after a change to the set of rows keyed under them. */
export interface GenerationBump {
    userId: number;
    generation: number;
}

// -- Keys -------------------------------------------------------------

const watchedKey = (userId: number | string): string => `ev:w:{${userId}}`;
const tokenKey = (userId: number | string, token: string): string =>
    `ev:t:{${userId}}:${token}`;
const socketKey = (userId: number | string, socketId: string): string =>
    `ev:s:{${userId}}:${socketId}`;
const generationKey = (userId: number | string): string => `ev:g:{${userId}}`;

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
     */
    async add(sub: SessionSubscription): Promise<GenerationBump> {
        const { holderUserId, ownerUserId, socketId, token, subId } = sub;

        const held = await this.clients.redis.scard(
            socketKey(holderUserId, socketId),
        );
        if (held >= EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET)
            throw subscriptionLimitReached();

        const rows = this.clients.redis.pipeline();
        rows.hset(tokenKey(ownerUserId, token), subId, JSON.stringify(sub));
        rows.expire(
            tokenKey(ownerUserId, token),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        rows.sadd(watchedKey(ownerUserId), token);
        rows.expire(watchedKey(ownerUserId), SESSION_SUBSCRIPTION_TTL_SECONDS);
        await rows.exec();

        const holder = this.clients.redis.pipeline();
        holder.sadd(
            socketKey(holderUserId, socketId),
            socketRef({ ownerUserId, token, subId }),
        );
        holder.expire(
            socketKey(holderUserId, socketId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        await holder.exec();

        return {
            userId: ownerUserId,
            generation: await this.bumpGeneration(ownerUserId),
        };
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

    /**
     * Remove rows and then any token whose rows are all gone. The token leaves
     * the watched set only once its hash is empty, which is what keeps one
     * socket's unsubscribe from silencing another's subscription on the same
     * anchor.
     */
    async #dropRefs(
        holderUserId: number,
        socketId: string,
        refs: readonly SocketRef[],
    ): Promise<void> {
        await this.clients.redis.srem(
            socketKey(holderUserId, socketId),
            ...refs.map(socketRef),
        );

        for (const [ownerUserId, owned] of byOwner(refs)) {
            const drop = this.clients.redis.pipeline();
            for (const { token, subId } of owned)
                drop.hdel(tokenKey(ownerUserId, token), subId);
            await drop.exec();

            const tokens = [...new Set(owned.map((ref) => ref.token))];
            const counts = this.clients.redis.pipeline();
            for (const token of tokens)
                counts.hlen(tokenKey(ownerUserId, token));
            const results = (await counts.exec()) ?? [];

            const orphaned = tokens.filter(
                (_token, i) => Number(results[i]?.[1] ?? 0) === 0,
            );
            if (orphaned.length > 0)
                await this.clients.redis.srem(
                    watchedKey(ownerUserId),
                    ...orphaned,
                );
        }
    }

    /**
     * Keep a live socket's keys ahead of the TTL backstop — its own, and the
     * watched sets its rows live in, which may belong to other users.
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
            const pipeline = this.clients.redis.pipeline();
            pipeline.expire(
                watchedKey(ownerUserId),
                SESSION_SUBSCRIPTION_TTL_SECONDS,
            );
            for (const token of new Set(owned.map((ref) => ref.token)))
                pipeline.expire(
                    tokenKey(ownerUserId, token),
                    SESSION_SUBSCRIPTION_TTL_SECONDS,
                );
            await pipeline.exec();
        }
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

    /** The rows behind a set of watched tokens. */
    async getForTokens(
        ownerUserId: number,
        tokens: readonly string[],
    ): Promise<SessionSubscription[]> {
        if (tokens.length === 0) return [];
        const pipeline = this.clients.redis.pipeline();
        for (const token of tokens)
            pipeline.hvals(tokenKey(ownerUserId, token));
        const results = (await pipeline.exec()) ?? [];

        const subs: SessionSubscription[] = [];
        for (const [, raw] of results) {
            for (const row of (raw as string[] | null) ?? []) {
                try {
                    subs.push(JSON.parse(row) as SessionSubscription);
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
            held.push(...rows.filter((row) => wanted.has(row.subId)));
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
