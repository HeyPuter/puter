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
    RemoteWatchAnnounce,
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
 *     ev:sc:{<ownerId>}            HASH  token -> session-row count, this region
 *     ev:rw:{<ownerId>}            HASH  token -> {region: announcedAtMs}, peer-written
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
 *
 * `ev:sc` and `ev:rw` extend this for cross-region session subscriptions.
 * `ev:sc` counts this region's own live session rows per token — separate from
 * `ev:w` because that set is shared with durable rows, so a `sadd` returning 1
 * does not mean a _session_ watcher just arrived. Crossing 0<->1+ here is what
 * announces to (or withdraws from) every peer, which writes the announcement
 * into _its own_ `ev:rw`: which regions currently have a session watcher on one
 * of this owner's tokens. A write by this owner reads `ev:rw` alongside `ev:w`
 * to decide which peers, if any, get the raw event forwarded to them.
 *
 * A token that session rows here ask KV values on is counted and announced a
 * second time, as its value variant, so a write sends the value only to the
 * regions that asked for one.
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
const sessionCountKey = (userId: number | string): string =>
    `ev:sc:{${userId}}`;
const remoteWatchKey = (userId: number | string): string => `ev:rw:{${userId}}`;

/**
 * The `ev:sc`/`ev:rw` field for session rows on `token` that ask for KV values.
 * No anchor token starts with `v#`, so it can never name one.
 */
export const valueWatchToken = (token: string): string => `v#${token}`;

const safeParseRegions = (raw: string): Record<string, number> | null => {
    try {
        return JSON.parse(raw) as Record<string, number>;
    } catch {
        return null;
    }
};

/** Peers whose announcement of each token is still inside its TTL. */
const liveRegionsByToken = (
    tokens: readonly string[],
    raw: unknown,
    cutoffMs: number,
): Map<string, string[]> => {
    const announced = (raw as Array<string | null> | undefined) ?? [];
    const live = new Map<string, string[]>();
    tokens.forEach((token, i) => {
        const entry = announced[i];
        if (!entry) return;
        const regions = safeParseRegions(entry);
        if (!regions) return;
        const fresh = Object.entries(regions)
            .filter(
                ([, announcedAt]) =>
                    typeof announcedAt === 'number' && announcedAt >= cutoffMs,
            )
            .map(([region]) => region);
        if (fresh.length > 0) live.set(token, fresh);
    });
    return live;
};

/** A row we cannot read is a row we cannot deliver against. */
const parseRow = (raw: string): DispatchSubscription | null => {
    try {
        return JSON.parse(raw) as DispatchSubscription;
    } catch {
        return null;
    }
};

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

/** A session token whose region-local watcher count just crossed to zero. */
interface DroppedSessionToken {
    ownerUserId: number;
    token: string;
}

/** What `#dropRefs` actually did, as opposed to what it was asked to. */
interface DropRefsResult {
    /** Tokens whose region-local watcher count crossed to zero. */
    dropped: DroppedSessionToken[];
    /** Refs a concurrent duplicate had not already taken. */
    removed: SocketRef[];
}

const toAnnounces = (
    dropped: readonly DroppedSessionToken[],
    op: 'add' | 'drop',
): RemoteWatchAnnounce[] | undefined =>
    dropped.length > 0
        ? dropped.map((entry) => ({ token: entry.token, op }))
        : undefined;

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

/**
 * How long a peer's remote-watch announcement is trusted without a re-announce.
 * Well past the ~20 min socket refresh that re-asserts live tokens, so only a
 * lost `drop` — or a peer that vanished outright — is ever caught by this
 * rather than by the refresh or the `noWatch` repair.
 */
export const REMOTE_WATCH_TTL_SECONDS = 2 * 60 * 60;

/** Bounds how many times a reap re-reads the socket set racing a reanchor. */
const REAP_READS = 3;

const subscriptionLimitReached = (): HttpError =>
    new HttpError(
        429,
        `A connection may hold ${EVENTS_SESSION_SUBSCRIPTIONS_PER_SOCKET} subscriptions`,
        { legacyCode: 'events_subscription_limit' },
    );

/**
 * KEYS: socket set. ARGV: old, new, ttl. Returns 1 (swapped), 0 (old gone), or
 * 2 (another settle already swapped in this same new ref).
 */
const SWAP_REF_SCRIPT = `
if redis.call('SREM', KEYS[1], ARGV[1]) == 0 then
    if redis.call('SISMEMBER', KEYS[1], ARGV[2]) == 1 then return 2 end
    return 0
end
redis.call('SADD', KEYS[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

interface ReanchorScripts {
    eventsSwapSocketRef(
        socketKey: string,
        oldRef: string,
        newRef: string,
        ttlSeconds: string,
    ): Promise<number>;
}

/** Whether a move actually happened, and the generation bumps it produced. */
export interface ReanchorResult {
    moved: boolean;
    bumps: GenerationBump[];
}

export class EventSubscriptionStore extends PuterStore {
    #definedScripts = false;

    #scripts(): ReanchorScripts {
        if (!this.#definedScripts) {
            this.#definedScripts = true;
            this.clients.redis.defineCommand('eventsSwapSocketRef', {
                numberOfKeys: 1,
                lua: SWAP_REF_SCRIPT,
            });
        }
        return this.clients.redis as unknown as ReanchorScripts;
    }

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

        const counts = await this.#writeRow(sub);
        await this.#keepDurableWindow(ownerUserId, [token]);

        const announce: RemoteWatchAnnounce[] = [];
        if (counts.rows === 1) announce.push({ token, op: 'add' });
        if (counts.values === 1)
            announce.push({ token: valueWatchToken(token), op: 'add' });
        return {
            userId: ownerUserId,
            generation: await this.bumpGeneration(ownerUserId),
            announce: announce.length > 0 ? announce : undefined,
        };
    }

    /**
     * Write one row's hash entry, watched-set membership and session counts.
     * Returns the resulting counts for that token — `values` only for a row
     * asking for KV values. Shared by `add` and `reanchorSession`, which both
     * need the row in place before any ref names it.
     */
    async #writeRow(
        sub: SessionSubscription,
    ): Promise<{ rows: number; values: number | null }> {
        const { ownerUserId, token, subId } = sub;
        const rows = this.clients.redis.pipeline();
        rows.hset(tokenKey(ownerUserId, token), subId, JSON.stringify(sub));
        rows.expire(
            tokenKey(ownerUserId, token),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        rows.sadd(watchedKey(ownerUserId), token);
        rows.expire(watchedKey(ownerUserId), SESSION_SUBSCRIPTION_TTL_SECONDS);
        rows.hincrby(sessionCountKey(ownerUserId), token, 1);
        if (sub.includeValue)
            rows.hincrby(
                sessionCountKey(ownerUserId),
                valueWatchToken(token),
                1,
            );
        rows.expire(
            sessionCountKey(ownerUserId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );
        const results = (await rows.exec()) ?? [];
        return {
            rows: Number(results[4]?.[1]),
            values: sub.includeValue ? Number(results[5]?.[1]) : null,
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
     *
     * `null` when a concurrent duplicate of this call already removed it.
     */
    async remove(sub: SessionSubscription): Promise<GenerationBump | null> {
        const { dropped, removed } = await this.#dropRefs(
            sub.holderUserId,
            sub.socketId,
            [
                {
                    ownerUserId: sub.ownerUserId,
                    token: sub.token,
                    subId: sub.subId,
                },
            ],
        );
        if (removed.length === 0) return null;

        return {
            userId: sub.ownerUserId,
            generation: await this.bumpGeneration(sub.ownerUserId),
            announce: toAnnounces(dropped, 'drop'),
        };
    }

    /**
     * Move one session row onto a different anchor, keeping its id and its
     * socket. Not `remove` then `add`: this is the same subscription, so it
     * must not be turned away by the per-connection cap it already occupies a
     * slot in, and the new anchor may sit in a different owner's keyspace.
     *
     * The new row lands first and the ref is swapped in one step, so an
     * unsubscribe or a reap always finds exactly one ref to take.
     */
    async reanchorSession(
        previous: SessionSubscription,
        next: SessionSubscription,
    ): Promise<ReanchorResult> {
        const nextCounts = await this.#writeRow(next);

        const swapped = await this.#scripts().eventsSwapSocketRef(
            socketKey(previous.holderUserId, previous.socketId),
            socketRef({
                ownerUserId: previous.ownerUserId,
                token: previous.token,
                subId: previous.subId,
            }),
            socketRef({
                ownerUserId: next.ownerUserId,
                token: next.token,
                subId: next.subId,
            }),
            String(SESSION_SUBSCRIPTION_TTL_SECONDS),
        );

        if (swapped !== 1) {
            // 0: an unsubscribe, a reap, or another settle took the old ref
            // first — undo the row this call wrote speculatively. 2: another
            // settle racing the same move already landed this exact ref;
            // its row is the one in place, so only this call's own count
            // increments need undoing.
            if (swapped === 0)
                await this.#dropRows(next.ownerUserId, [
                    { token: next.token, subId: next.subId },
                ]);
            const counted: Array<[string, number]> = [
                [next.token, nextCounts.rows],
            ];
            if (nextCounts.values !== null)
                counted.push([valueWatchToken(next.token), nextCounts.values]);
            const undone = new Set(
                (
                    await this.#dropSessionCounts(
                        next.ownerUserId,
                        counted.map(([token]) => token),
                    )
                ).map((entry) => entry.token),
            );
            const announce = counted.flatMap(
                ([token, count]): RemoteWatchAnnounce[] => {
                    const announced = count === 1;
                    if (announced === undone.has(token)) return [];
                    return [{ token, op: announced ? 'add' : 'drop' }];
                },
            );
            if (announce.length === 0) return { moved: false, bumps: [] };
            return {
                moved: false,
                bumps: [
                    {
                        userId: next.ownerUserId,
                        generation: await this.bumpGeneration(next.ownerUserId),
                        announce,
                    },
                ],
            };
        }

        const valued = await this.#dropRows(previous.ownerUserId, [
            { token: previous.token, subId: previous.subId },
        ]);
        const dropped = await this.#dropSessionCounts(previous.ownerUserId, [
            previous.token,
            ...valued,
        ]);
        await this.#keepDurableWindow(next.ownerUserId, [next.token]);

        const announceByOwner = new Map<number, RemoteWatchAnnounce[]>();
        for (const { ownerUserId, token } of dropped)
            announceByOwner.set(ownerUserId, [
                ...(announceByOwner.get(ownerUserId) ?? []),
                { token, op: 'drop' },
            ]);
        const added: RemoteWatchAnnounce[] = [];
        if (nextCounts.rows === 1) added.push({ token: next.token, op: 'add' });
        if (nextCounts.values === 1)
            added.push({ token: valueWatchToken(next.token), op: 'add' });
        if (added.length > 0)
            announceByOwner.set(next.ownerUserId, [
                ...(announceByOwner.get(next.ownerUserId) ?? []),
                ...added,
            ]);

        const owners = new Set([previous.ownerUserId, next.ownerUserId]);
        const bumps = await Promise.all(
            [...owners].map(async (userId) => ({
                userId,
                generation: await this.bumpGeneration(userId),
                announce: announceByOwner.get(userId),
            })),
        );
        return { moved: true, bumps };
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
        const key = socketKey(holderUserId, socketId);
        const dropped: DroppedSessionToken[] = [];
        const removed: SocketRef[] = [];

        for (let read = 0; read < REAP_READS; read++) {
            const refs = (await this.clients.redis.smembers(key)).map(
                parseSocketRef,
            );
            if (refs.length === 0) break;

            const result = await this.#dropRefs(holderUserId, socketId, refs);
            dropped.push(...result.dropped);
            removed.push(...result.removed);
            if (result.removed.length === refs.length) break;
            // A ref this pass could not take may have moved rather than
            // gone; look again.
        }

        const announceByOwner = new Map<number, RemoteWatchAnnounce[]>();
        for (const { ownerUserId, token } of dropped)
            announceByOwner.set(ownerUserId, [
                ...(announceByOwner.get(ownerUserId) ?? []),
                { token, op: 'drop' },
            ]);

        // Bump only owners whose ref this call actually removed.
        const bumps: GenerationBump[] = [];
        for (const ownerUserId of byOwner(removed).keys())
            bumps.push({
                userId: ownerUserId,
                generation: await this.bumpGeneration(ownerUserId),
                announce: announceByOwner.get(ownerUserId),
            });
        return bumps;
    }

    /**
     * Forget a socket's refs, then the rows they point at. Only refs this
     * call's own `srem` actually removed count as dropped.
     */
    async #dropRefs(
        holderUserId: number,
        socketId: string,
        refs: readonly SocketRef[],
    ): Promise<DropRefsResult> {
        if (refs.length === 0) return { dropped: [], removed: [] };

        const key = socketKey(holderUserId, socketId);
        const pipeline = this.clients.redis.pipeline();
        for (const ref of refs) pipeline.srem(key, socketRef(ref));
        const results = (await pipeline.exec()) ?? [];
        const removed = refs.filter((_ref, i) => Number(results[i]?.[1]) === 1);

        const dropped: DroppedSessionToken[] = [];
        for (const [ownerUserId, owned] of byOwner(removed)) {
            const valued = await this.#dropRows(ownerUserId, owned);
            dropped.push(
                ...(await this.#dropSessionCounts(ownerUserId, [
                    ...owned.map((ref) => ref.token),
                    ...valued,
                ])),
            );
        }
        return { dropped, removed };
    }

    /**
     * Decrement this region's live-session count for each dropped token, and
     * report which crossed to zero — those are what a peer needs to be told to
     * stop for. A token can appear more than once (several rows on the same
     * anchor), so each is decremented by its own occurrence count in one
     * pipeline rather than one command per row.
     */
    async #dropSessionCounts(
        ownerUserId: number,
        tokens: readonly string[],
    ): Promise<DroppedSessionToken[]> {
        if (tokens.length === 0) return [];
        const counts = new Map<string, number>();
        for (const token of tokens)
            counts.set(token, (counts.get(token) ?? 0) + 1);

        const key = sessionCountKey(ownerUserId);
        const tokenList = [...counts.keys()];
        const pipeline = this.clients.redis.pipeline();
        for (const token of tokenList)
            pipeline.hincrby(key, token, -(counts.get(token) as number));
        const results = (await pipeline.exec()) ?? [];

        const zeroed: string[] = [];
        const dropped: DroppedSessionToken[] = [];
        tokenList.forEach((token, i) => {
            const remaining = Number(results[i]?.[1]);
            if (Number.isFinite(remaining) && remaining <= 0) {
                zeroed.push(token);
                dropped.push({ ownerUserId, token });
            }
        });
        if (zeroed.length > 0) await this.clients.redis.hdel(key, ...zeroed);
        return dropped;
    }

    /**
     * Drop rows from one owner's keyspace and then any token whose rows are all
     * gone. Emptiness is what un-watches a token, which is what keeps one
     * socket's unsubscribe — or a durable row's removal — from silencing
     * another subscription on the same anchor.
     *
     * Returns the value variant of each token a dropped session row asked KV
     * values on, read off the row as it goes.
     */
    async #dropRows(
        ownerUserId: number,
        rows: ReadonlyArray<{ token: string; subId: string }>,
    ): Promise<string[]> {
        if (rows.length === 0) return [];

        const drop = this.clients.redis.pipeline();
        for (const { token, subId } of rows) {
            drop.hget(tokenKey(ownerUserId, token), subId);
            drop.hdel(tokenKey(ownerUserId, token), subId);
        }
        const dropResults = (await drop.exec()) ?? [];
        const valued = rows.flatMap(({ token }, i) => {
            const raw = dropResults[2 * i]?.[1];
            if (Number(dropResults[2 * i + 1]?.[1]) !== 1) return [];
            const row = typeof raw === 'string' ? parseRow(raw) : null;
            return row?.socketId !== undefined && row.includeValue === true
                ? [valueWatchToken(token)]
                : [];
        });

        const tokens = [...new Set(rows.map((row) => row.token))];
        const counts = this.clients.redis.pipeline();
        for (const token of tokens) counts.hlen(tokenKey(ownerUserId, token));
        const results = (await counts.exec()) ?? [];

        const orphaned = tokens.filter(
            (_token, i) => Number(results[i]?.[1] ?? 0) === 0,
        );
        if (orphaned.length === 0) return valued;

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
        return valued;
    }

    /**
     * Keep a live socket's keys ahead of the TTL backstop — its own, and the
     * watched sets its rows live in, which may belong to other users.
     *
     * Re-asserts each token into the watched set rather than only extending its
     * TTL: a live row is proof its token belongs there, so a race that silently
     * dropped it (see `#dropRows`) heals itself on the next refresh even if
     * nothing catches it sooner.
     *
     * Returns every (owner, token) pair the socket still holds, and the value
     * variant of each one a row asks KV values on, so the caller can
     * re-announce them to peers — the whole of how a remote-watch announcement
     * survives longer than one refresh window without a second timer.
     */
    async refresh(
        holderUserId: number,
        socketId: string,
    ): Promise<Array<{ ownerUserId: number; token: string }>> {
        const refs = (
            await this.clients.redis.smembers(socketKey(holderUserId, socketId))
        ).map(parseSocketRef);

        await this.clients.redis.expire(
            socketKey(holderUserId, socketId),
            SESSION_SUBSCRIPTION_TTL_SECONDS,
        );

        const reasserted: Array<{ ownerUserId: number; token: string }> = [];
        for (const [ownerUserId, owned] of byOwner(refs)) {
            const tokens = [...new Set(owned.map((ref) => ref.token))];
            const pipeline = this.clients.redis.pipeline();
            pipeline.sadd(watchedKey(ownerUserId), ...tokens);
            pipeline.expire(
                watchedKey(ownerUserId),
                SESSION_SUBSCRIPTION_TTL_SECONDS,
            );
            pipeline.expire(
                sessionCountKey(ownerUserId),
                SESSION_SUBSCRIPTION_TTL_SECONDS,
            );
            for (const token of tokens)
                pipeline.expire(
                    tokenKey(ownerUserId, token),
                    SESSION_SUBSCRIPTION_TTL_SECONDS,
                );
            for (const ref of owned)
                pipeline.hget(tokenKey(ownerUserId, ref.token), ref.subId);
            const results = (await pipeline.exec()) ?? [];

            const rowsAt = 3 + tokens.length;
            const valued = new Set(
                owned.flatMap((ref, i) => {
                    const raw = results[rowsAt + i]?.[1];
                    const row = typeof raw === 'string' ? parseRow(raw) : null;
                    return row?.includeValue === true ? [ref.token] : [];
                }),
            );

            await this.#keepDurableWindow(ownerUserId, tokens);
            for (const token of tokens) reasserted.push({ ownerUserId, token });
            for (const token of valued)
                reasserted.push({ ownerUserId, token: valueWatchToken(token) });
        }
        return reasserted;
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
     * Whether anyone watches anything of this owner's at all — locally, or a
     * peer holding a session watcher on one of their tokens. One pipeline, two
     * commands, still the only thing a cold process needs before it can answer
     * from memory: a region with no local rows but a peer watching must not
     * read as "nobody is subscribed".
     */
    async userHasAny(ownerUserId: number): Promise<boolean> {
        const pipeline = this.clients.redis.pipeline();
        pipeline.exists(watchedKey(ownerUserId));
        pipeline.exists(remoteWatchKey(ownerUserId));
        const results = (await pipeline.exec()) ?? [];
        return Number(results[0]?.[1]) === 1 || Number(results[1]?.[1]) === 1;
    }

    /**
     * Which of an event's tokens anyone is watching locally — the dispatch hot
     * path, and one command whatever the depth of the tree. Delegates to
     * {@link watchedFor} so no existing caller has to change.
     */
    async watchedTokens(
        ownerUserId: number,
        tokens: readonly string[],
    ): Promise<string[]> {
        return (await this.watchedFor(ownerUserId, tokens)).local;
    }

    /**
     * Which of an event's tokens anyone watches — here, and in which peers. One
     * round trip, one cluster slot: `ev:w` and `ev:rw` share the owner's hash
     * tag. Regions whose announcement has aged past
     * {@link REMOTE_WATCH_TTL_SECONDS} are pruned from the answer in memory, not
     * written back — a peer that is actually still watching re-announces on its
     * own refresh well inside that window.
     */
    async watchedFor(
        ownerUserId: number,
        tokens: readonly string[],
        options: { values?: boolean } = {},
    ): Promise<{
        local: string[];
        remote: Map<string, string[]>;
        /**
         * With `values`: the regions whose rows on each token ask for KV
         * values.
         */
        remoteValues: Map<string, string[]>;
    }> {
        if (tokens.length === 0)
            return { local: [], remote: new Map(), remoteValues: new Map() };

        const pipeline = this.clients.redis.pipeline();
        pipeline.smismember(watchedKey(ownerUserId), ...tokens);
        pipeline.hmget(remoteWatchKey(ownerUserId), ...tokens);
        if (options.values)
            pipeline.hmget(
                remoteWatchKey(ownerUserId),
                ...tokens.map(valueWatchToken),
            );
        const results = (await pipeline.exec()) ?? [];

        const flags = (results[0]?.[1] as number[] | undefined) ?? [];
        const local = tokens.filter((_token, i) => Number(flags[i]) === 1);

        const cutoffMs = Date.now() - REMOTE_WATCH_TTL_SECONDS * 1000;
        return {
            local,
            remote: liveRegionsByToken(tokens, results[1]?.[1], cutoffMs),
            remoteValues: options.values
                ? liveRegionsByToken(tokens, results[2]?.[1], cutoffMs)
                : new Map(),
        };
    }

    /**
     * Record (or clear) one peer's session watch on one of our tokens — the
     * write side of {@link watchedFor}'s remote arm. Read-modify-write, since
     * several peers can hold the same token; a race between two peers'
     * announcements is bounded by the TTL, the periodic re-announce and the
     * `noWatch` repair, the same three things that bound a lost `drop`.
     */
    async noteRemoteWatch(
        ownerUserId: number,
        token: string,
        region: string,
        op: 'add' | 'drop',
    ): Promise<void> {
        const key = remoteWatchKey(ownerUserId);
        const raw = await this.clients.redis.hget(key, token);
        const regions = raw ? (safeParseRegions(raw) ?? {}) : {};

        if (op === 'drop') delete regions[region];
        else regions[region] = Date.now();

        if (Object.keys(regions).length === 0) {
            await this.clients.redis.hdel(key, token);
            return;
        }
        await this.clients.redis.hset(key, token, JSON.stringify(regions));
        await this.clients.redis.expire(key, REMOTE_WATCH_TTL_SECONDS);
    }

    /**
     * The rows behind a set of watched tokens, session and durable alike.
     *
     * With `perToken`, each token yields at most that many rows `keep` accepts,
     * scanned rather than read whole: every recipient of a shared folder
     * indexes under its owner's token, and one event only ever uses so many of
     * them.
     */
    async getForTokens(
        ownerUserId: number,
        tokens: readonly string[],
        options: {
            perToken?: number;
            keep?: (row: DispatchSubscription) => boolean;
        } = {},
    ): Promise<DispatchSubscription[]> {
        if (tokens.length === 0) return [];
        if (options.perToken !== undefined)
            return this.#scanForTokens(
                ownerUserId,
                tokens,
                Math.max(1, Math.floor(options.perToken)),
                options.keep ?? (() => true),
            );

        const pipeline = this.clients.redis.pipeline();
        for (const token of tokens)
            pipeline.hvals(tokenKey(ownerUserId, token));
        const results = (await pipeline.exec()) ?? [];

        const subs: DispatchSubscription[] = [];
        for (const [, raw] of results) {
            for (const row of (raw as string[] | null) ?? []) {
                const parsed = parseRow(row);
                if (parsed && (options.keep?.(parsed) ?? true))
                    subs.push(parsed);
            }
        }
        return subs;
    }

    /**
     * One pipelined first page per token, which is the whole hash for any token
     * small enough to be stored compactly; only a larger one is scanned
     * further, and only until it has given enough.
     */
    async #scanForTokens(
        ownerUserId: number,
        tokens: readonly string[],
        perToken: number,
        keep: (row: DispatchSubscription) => boolean,
    ): Promise<DispatchSubscription[]> {
        const pipeline = this.clients.redis.pipeline();
        for (const token of tokens)
            pipeline.hscan(
                tokenKey(ownerUserId, token),
                '0',
                'COUNT',
                perToken,
            );
        const results = (await pipeline.exec()) ?? [];

        const subs: DispatchSubscription[] = [];
        for (const [i, token] of tokens.entries()) {
            const [err, first] = results[i] ?? [];
            let page = err ? null : (first as [string, string[]] | null);
            // A scan can name an entry twice.
            const taken = new Map<string, DispatchSubscription>();
            while (page) {
                const [cursor, flat] = page;
                for (let j = 1; j < flat.length; j += 2) {
                    if (taken.size >= perToken) break;
                    const row = parseRow(flat[j]);
                    if (row && keep(row)) taken.set(row.subId, row);
                }
                if (cursor === '0' || taken.size >= perToken) break;
                page = await this.clients.redis.hscan(
                    tokenKey(ownerUserId, token),
                    cursor,
                    'COUNT',
                    perToken,
                );
            }
            subs.push(...taken.values());
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
        for (let attempt = 0; attempt < 2; attempt++) {
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
            if (raw) {
                try {
                    return JSON.parse(raw) as SessionSubscription;
                } catch {
                    return null;
                }
            }
            // A ref whose row just went has moved; read the refs once more.
        }
        return null;
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
