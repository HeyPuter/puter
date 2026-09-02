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
import { PuterStore } from '../types.js';

/**
 * Session subscriptions: Redis only, keyed to the socket that holds them, gone
 * when it disconnects. Nothing here outlives a connection, so none of it
 * belongs in a table.
 *
 * Every key a user owns carries the same `{<userId>}` hash tag, so one user's
 * whole set lives in one cluster slot and a pipeline over it never crosses
 * slots. Four keys, each answering one question:
 *
 *     ev:w:{<userId>}              SET   which tokens anyone is watching
 *     ev:t:{<userId>}:<token>      HASH  subId -> row, for one watched token
 *     ev:s:{<userId>}:<socketId>   SET   what this socket holds, for reaping
 *     ev:g:{<userId>}              STR   subscription-set generation
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
    userId: number;
    /** The subject as the client asked for it. */
    subject: string;
    /** Anchor token the row is indexed under. */
    token: string;
    anchorUid: string;
    anchorPath: string;
    /** Glob relative to the anchor, or `null` for a node-form subscription. */
    match: string | null;
    op: FsOp | null;
    appUid: string | null;
}

// -- Keys -------------------------------------------------------------

const watchedKey = (userId: number | string): string => `ev:w:{${userId}}`;
const tokenKey = (userId: number | string, token: string): string =>
    `ev:t:{${userId}}:${token}`;
const socketKey = (userId: number | string, socketId: string): string =>
    `ev:s:{${userId}}:${socketId}`;
const generationKey = (userId: number | string): string => `ev:g:{${userId}}`;

/** `ev:s` members name the row they point at. */
const socketRef = (token: string, subId: string): string => `${token}|${subId}`;
const parseSocketRef = (ref: string): { token: string; subId: string } => {
    const at = ref.indexOf('|');
    return { token: ref.slice(0, at), subId: ref.slice(at + 1) };
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
     * Register one subscription. Returns the generation the write produced, so
     * the caller can broadcast it.
     *
     * Ordering is deliberate: the row lands before the token joins the watched
     * set, so dispatch never sees a token whose rows it cannot read yet.
     */
    async add(sub: SessionSubscription): Promise<number> {
        const { userId, socketId, token, subId } = sub;

        const held = await this.clients.redis.scard(
            socketKey(userId, socketId),
        );
        if (held >= EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET)
            throw subscriptionLimitReached();

        const pipeline = this.clients.redis.pipeline();
        pipeline.hset(tokenKey(userId, token), subId, JSON.stringify(sub));
        pipeline.expire(
            tokenKey(userId, token),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        pipeline.sadd(socketKey(userId, socketId), socketRef(token, subId));
        pipeline.expire(
            socketKey(userId, socketId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        pipeline.sadd(watchedKey(userId), token);
        pipeline.expire(watchedKey(userId), SESSION_SUBSCRIPTION_TTL_SECONDS);
        await pipeline.exec();

        return this.bumpGeneration(userId);
    }

    /**
     * Drop one subscription. Returns the new generation, or `null` when the
     * subscription was not this socket's to remove — the caller answers that as
     * a 404 rather than telling a client which ids exist.
     */
    async remove(
        userId: number,
        socketId: string,
        subId: string,
    ): Promise<number | null> {
        const refs = await this.clients.redis.smembers(
            socketKey(userId, socketId),
        );
        const ref = refs.find((r) => parseSocketRef(r).subId === subId);
        if (!ref) return null;

        await this.#dropRefs(userId, socketId, [ref]);
        return this.bumpGeneration(userId);
    }

    /**
     * Drop everything a socket held. Runs on disconnect; the TTL is what covers
     * the disconnect that never runs.
     */
    async reapSocket(userId: number, socketId: string): Promise<number | null> {
        const refs = await this.clients.redis.smembers(
            socketKey(userId, socketId),
        );
        if (refs.length === 0) return null;
        await this.#dropRefs(userId, socketId, refs);
        return this.bumpGeneration(userId);
    }

    /**
     * Remove rows and then any token whose rows are all gone. The token leaves
     * the watched set only once its hash is empty, which is what keeps one
     * socket's unsubscribe from silencing another's subscription on the same
     * anchor.
     */
    async #dropRefs(
        userId: number,
        socketId: string,
        refs: string[],
    ): Promise<void> {
        const parsed = refs.map(parseSocketRef);

        const drop = this.clients.redis.pipeline();
        for (const { token, subId } of parsed)
            drop.hdel(tokenKey(userId, token), subId);
        drop.srem(socketKey(userId, socketId), ...refs);
        await drop.exec();

        const tokens = [...new Set(parsed.map((p) => p.token))];
        const counts = this.clients.redis.pipeline();
        for (const token of tokens) counts.hlen(tokenKey(userId, token));
        const results = (await counts.exec()) ?? [];

        const orphaned = tokens.filter(
            (_token, i) => Number(results[i]?.[1] ?? 0) === 0,
        );
        if (orphaned.length > 0)
            await this.clients.redis.srem(watchedKey(userId), ...orphaned);
    }

    /** Keep a live socket's keys ahead of the TTL backstop. */
    async refresh(userId: number, socketId: string): Promise<void> {
        const pipeline = this.clients.redis.pipeline();
        pipeline.expire(
            socketKey(userId, socketId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        pipeline.expire(watchedKey(userId), SESSION_SUBSCRIPTION_TTL_SECONDS);
        await pipeline.exec();
    }

    // -- Reads -------------------------------------------------------

    /**
     * Whether this user has any subscriptions at all. One command, and the only
     * thing a cold process needs before it can answer from memory.
     */
    async userHasAny(userId: number): Promise<boolean> {
        return (await this.clients.redis.exists(watchedKey(userId))) === 1;
    }

    /**
     * Which of an event's tokens anyone is watching — the dispatch hot path,
     * and one command whatever the depth of the tree.
     */
    async watchedTokens(
        userId: number,
        tokens: readonly string[],
    ): Promise<string[]> {
        if (tokens.length === 0) return [];
        const flags = await this.clients.redis.smismember(
            watchedKey(userId),
            ...tokens,
        );
        return tokens.filter((_token, i) => Number(flags[i]) === 1);
    }

    /** The rows behind a set of watched tokens. */
    async getForTokens(
        userId: number,
        tokens: readonly string[],
    ): Promise<SessionSubscription[]> {
        if (tokens.length === 0) return [];
        const pipeline = this.clients.redis.pipeline();
        for (const token of tokens) pipeline.hvals(tokenKey(userId, token));
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

    /** Everything one socket holds, newest first is not meaningful here. */
    async listForSocket(
        userId: number,
        socketId: string,
    ): Promise<SessionSubscription[]> {
        const refs = await this.clients.redis.smembers(
            socketKey(userId, socketId),
        );
        if (refs.length === 0) return [];

        const byToken = new Map<string, Set<string>>();
        for (const ref of refs) {
            const { token, subId } = parseSocketRef(ref);
            const ids = byToken.get(token) ?? new Set<string>();
            ids.add(subId);
            byToken.set(token, ids);
        }

        const tokens = [...byToken.keys()];
        const rows = await this.getForTokens(userId, tokens);
        return rows.filter((row) => byToken.get(row.token)?.has(row.subId));
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
