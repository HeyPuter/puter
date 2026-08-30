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

import { randomUUID } from 'node:crypto';
import {
    EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
    type SubscriptionQuota,
} from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { DeliveryClass } from '../../services/events/registry.js';
import type { FsOp } from '../../services/events/subjects.js';
import {
    encodeCursor,
    decodeCursor,
    type PageResult,
} from '../../util/pagination.js';
import { PuterStore } from '../types.js';
import type { GenerationBump } from './EventSubscriptionStore.js';
import {
    isSubscriptionTarget,
    SUBSCRIPTION_TARGETS,
    targetsAllowedForDelivery,
    type DurableSubscription,
    type SubscriptionPermission,
    type SubscriptionTarget,
} from './types.js';

/**
 * Subscriptions that outlive the connection that made them.
 *
 * The table is the record; nothing on the dispatch path reads it directly. A
 * subscribe is write-through — the row lands on the primary and in this
 * region's cache before the call returns, so subscribe-then-write works here
 * immediately — and every other region rebuilds lazily on its first dispatch
 * for the owner. Rebuilds read the **primary** (`pread`): a replica that has
 * not caught up would cache the absence of a subscription that exists, and no
 * later event would correct it.
 *
 * Everything is keyed two ways, and the pair is the whole access story:
 * `owner_user_id` is what dispatch rebuilds under, because a write only knows
 * whose resource changed; `(holder_user_id, app_uid)` is what list, revoke and
 * the quota use, and being the index it _is_ the scope check rather than a
 * filter over a wider read.
 */

// -- Limits -----------------------------------------------------------

/** Hard cap on the stored `context` blob. */
export const DURABLE_CONTEXT_MAX_BYTES = 4096;

/** Default page size for the holder listing, and its ceiling. */
export const DURABLE_LIST_DEFAULT_LIMIT = 50;
export const DURABLE_LIST_LIMIT_CAP = 200;

/**
 * Rows one handler-lifecycle pass takes. A removal suspends its dependents in
 * batches so a widely-used name cannot make one call hold the whole set.
 */
export const HANDLER_SETTLE_BATCH = 500;

const TABLE = 'event_subscriptions';

// -- Wire shapes ------------------------------------------------------

/** Everything a caller must decide before a row can exist. */
export interface DurableSubscriptionInput {
    holderUserId: number;
    ownerUserId: number;
    appUid: string | null;
    subject: string;
    token: string;
    anchorUid: string;
    anchorPath: string;
    match: string | null;
    op: FsOp | null;
    delivery: DeliveryClass;
    targets: SubscriptionTarget[];
    handlerName: string | null;
    context: string | null;
    permission: SubscriptionPermission;
    expiresAt: number | null;
    /**
     * Plan-resolved caps this subscribe is held to. Omitted falls back to the
     * structural maximum, so a writer that never resolved a plan still cannot
     * leave an account holding more rows than the design allows.
     */
    limits?: SubscriptionQuota;
}

/** One keyset page of rows, and where the next page starts. */
export interface DurablePage {
    rows: DurableSubscription[];
    /** `null` once the scan is exhausted. */
    nextId: number | null;
}

export interface DurableListOptions {
    /** Confines the listing to one app's rows; omitted is the account view. */
    appUid?: string | null;
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
}

/**
 * Why a row is out of service.
 *
 * All four are states rather than deletions, so a bad deploy or a lapsed card
 * is recoverable. Only `permission_revoked` is terminal: consent to watch is
 * re-established by subscribing again, never by re-granting.
 */
export const SUSPENDED_REASONS = [
    'handler_not_found',
    'failures',
    'no_credit',
    'permission_revoked',
] as const;

export type SuspendedReason = (typeof SUSPENDED_REASONS)[number];

export const isSuspendedReason = (value: unknown): value is SuspendedReason =>
    SUSPENDED_REASONS.includes(value as SuspendedReason);

/** Where a row is moving to when its anchor is deleted under it. */
export interface ReanchorInput {
    token: string;
    anchorUid: string;
    anchorPath: string;
    match: string;
    /** The new anchor's owner, which is the keyspace the row is indexed in. */
    ownerUserId: number;
}

// -- Errors -----------------------------------------------------------

const contextTooLarge = (): HttpError =>
    new HttpError(
        413,
        `Subscription context may not exceed ${DURABLE_CONTEXT_MAX_BYTES} bytes`,
        { legacyCode: 'events_context_too_large' },
    );

const invalidTargets = (): HttpError =>
    new HttpError(
        400,
        `targets must be a subset of ${SUBSCRIPTION_TARGETS.join(', ')}`,
        { legacyCode: 'invalid_targets' },
    );

const pushOnSingle = (): HttpError =>
    new HttpError(
        400,
        'A `single` subscription may not target `push`, and an app`s needs a `worker` target',
        { legacyCode: 'invalid_targets' },
    );

const workerNeedsApp = (): HttpError =>
    new HttpError(
        400,
        'A subscription with no app has no events worker to target',
        { legacyCode: 'invalid_targets' },
    );

const quotaReached = (limit: number, scope: 'account' | 'app'): HttpError =>
    new HttpError(
        429,
        scope === 'app'
            ? `An app may hold ${limit} durable subscriptions for one account`
            : `An account may hold ${limit} durable subscriptions`,
        { legacyCode: 'events_subscription_limit' },
    );

// -- Row mapping ------------------------------------------------------

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const asNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/**
 * `targets` is a JSON column on mysql and postgres and text on sqlite, so the
 * driver hands back either an array or the string it was stored as.
 */
const parseTargets = (value: unknown): SubscriptionTarget[] => {
    const raw =
        typeof value === 'string'
            ? (() => {
                  try {
                      return JSON.parse(value) as unknown;
                  } catch {
                      return [];
                  }
              })()
            : value;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isSubscriptionTarget);
};

const toRow = (row: Record<string, unknown>): DurableSubscription => ({
    durable: true,
    subId: String(row.sub_id),
    holderUserId: Number(row.holder_user_id),
    ownerUserId: Number(row.owner_user_id),
    subject: String(row.subject),
    token: String(row.token),
    anchorUid: String(row.anchor_uid),
    anchorPath: String(row.anchor_path),
    match:
        row.match === null || row.match === undefined
            ? null
            : String(row.match),
    op: row.ops ? (String(row.ops).split(',')[0] as FsOp) : null,
    appUid:
        row.app_uid === null || row.app_uid === undefined
            ? null
            : String(row.app_uid),
    permission: String(row.permission),
    delivery: String(row.delivery) as DeliveryClass,
    targets: parseTargets(row.targets),
    handlerName:
        row.handler_name === null || row.handler_name === undefined
            ? null
            : String(row.handler_name),
    context:
        row.context === null || row.context === undefined
            ? null
            : String(row.context),
    expiresAt: asNumber(row.expires_at),
    suspendedAt: asNumber(row.suspended_at),
    suspendedReason:
        row.suspended_reason === null || row.suspended_reason === undefined
            ? null
            : String(row.suspended_reason),
    createdAt: Number(row.created_at) || 0,
});

const SELECT_COLUMNS =
    '`id`, `sub_id`, `token`, `owner_user_id`, `holder_user_id`, `app_uid`, ' +
    '`subject`, `anchor_uid`, `anchor_path`, `match`, `delivery`, `ops`, ' +
    '`handler_name`, `targets`, `context`, `permission`, `suspended_at`, ' +
    '`suspended_reason`, `expires_at`, `created_at`';

export class DurableSubscriptionStore extends PuterStore {
    // -- Writes ------------------------------------------------------

    /**
     * Insert one subscription and put it in this region's cache before
     * returning. The generation bump is what tells every other region, and the
     * caller broadcasts it.
     */
    async create(
        input: DurableSubscriptionInput,
    ): Promise<{ row: DurableSubscription; bump: GenerationBump }> {
        const targets = this.#assertTargets(
            input.delivery,
            input.targets,
            input.appUid,
        );
        this.#assertContext(input.context);

        const perUser = Math.min(
            input.limits?.perUser ?? EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
            EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
        );
        const perApp = input.limits?.perApp ?? perUser;
        const held = await this.countForHolder(
            input.holderUserId,
            input.appUid,
        );
        if (held.total >= perUser) throw quotaReached(perUser, 'account');
        if (input.appUid !== null && held.forApp >= perApp)
            throw quotaReached(perApp, 'app');

        const row: DurableSubscription = {
            durable: true,
            subId: `${input.appUid ?? 'user'}#${randomUUID()}`,
            holderUserId: input.holderUserId,
            ownerUserId: input.ownerUserId,
            subject: input.subject,
            token: input.token,
            anchorUid: input.anchorUid,
            anchorPath: input.anchorPath,
            match: input.match,
            op: input.op,
            appUid: input.appUid,
            permission: input.permission,
            delivery: input.delivery,
            targets,
            handlerName: input.handlerName,
            context: input.context,
            expiresAt: input.expiresAt,
            suspendedAt: null,
            suspendedReason: null,
            createdAt: nowSeconds(),
        };

        await this.clients.db.insert(TABLE, {
            sub_id: row.subId,
            token: row.token,
            owner_user_id: row.ownerUserId,
            holder_user_id: row.holderUserId,
            app_uid: row.appUid,
            subject: row.subject,
            anchor_uid: row.anchorUid,
            anchor_path: row.anchorPath,
            match: row.match,
            delivery: row.delivery,
            ops: row.op,
            handler_name: row.handlerName,
            targets: JSON.stringify(row.targets),
            context: row.context,
            permission: row.permission,
            expires_at: row.expiresAt,
            created_at: row.createdAt,
        });

        // Write-through, and over the whole owner rather than the one row: it
        // costs the same indexed read as a warm would, on a path rate-limited
        // to a few calls a minute, and it leaves this region needing nothing
        // from the table before it can deliver.
        await this.#rebuildRegion(row.ownerUserId);
        return { row, bump: await this.#bump(row.ownerUserId) };
    }

    /** Remove one row and stop this region delivering against it. */
    async remove(row: DurableSubscription): Promise<GenerationBump> {
        await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`sub_id\` = ?`,
            [row.subId],
        );
        await this.stores.eventSubscription.dropDurable(row);
        return this.#bump(row.ownerUserId);
    }

    /**
     * Take a set of rows out of service without deleting them: one statement
     * for the table, then each row out of the cache, then one generation per
     * owner. Suspended rows stay listable — that is how their holder finds out
     * what happened — but nothing rebuilds them into a watched set again.
     */
    async suspend(
        rows: readonly DurableSubscription[],
        reason: SuspendedReason,
    ): Promise<{ suspended: DurableSubscription[]; bumps: GenerationBump[] }> {
        if (rows.length === 0) return { suspended: [], bumps: [] };

        // One conditional write per row, so two settles racing over the same
        // rows — an unshare withdraws several grant strings in a row — each
        // learn exactly which rows they were the one to suspend.
        const at = nowSeconds();
        const suspended: DurableSubscription[] = [];
        for (const row of rows) {
            const written = await this.clients.db.write(
                `UPDATE \`${TABLE}\` SET \`suspended_at\` = ?, ` +
                    '`suspended_reason` = ? ' +
                    'WHERE `sub_id` = ? AND `suspended_at` IS NULL',
                [at, reason, row.subId],
            );
            if (written.anyRowsAffected)
                suspended.push({
                    ...row,
                    suspendedAt: at,
                    suspendedReason: reason,
                });
        }

        const owners = new Set<number>();
        for (const row of suspended) {
            await this.stores.eventSubscription.dropDurable(row);
            owners.add(row.ownerUserId);
        }
        const bumps = await Promise.all(
            [...owners].map((owner) => this.#bump(owner)),
        );
        return { suspended, bumps };
    }

    /**
     * Put suspended rows back in service: clear the state, put each back in
     * this region's cache, and bump so every other region rebuilds. The inverse
     * of `suspend`, and the only way back for the three reasons that resume.
     */
    async resume(
        rows: readonly DurableSubscription[],
    ): Promise<GenerationBump[]> {
        if (rows.length === 0) return [];

        await this.clients.db.write(
            `UPDATE \`${TABLE}\` SET \`suspended_at\` = NULL, ` +
                '`suspended_reason` = NULL WHERE `sub_id` IN ' +
                `(${rows.map(() => '?').join(', ')})`,
            rows.map((row) => row.subId),
        );

        // Cached per owner: the cache keys one hash per owner and takes the
        // owner from the first row it is given.
        const byOwner = new Map<number, DurableSubscription[]>();
        for (const row of rows) {
            const live: DurableSubscription = {
                ...row,
                suspendedAt: null,
                suspendedReason: null,
            };
            const held = byOwner.get(row.ownerUserId);
            if (held) held.push(live);
            else byOwner.set(row.ownerUserId, [live]);
        }
        for (const [, owned] of byOwner)
            await this.stores.eventSubscription.cacheDurable(owned);

        return Promise.all(
            [...byOwner.keys()].map((owner) => this.#bump(owner)),
        );
    }

    /**
     * Move one row onto a different anchor, keeping its identity. The cache
     * entry moves with it — including across owners, which is a different
     * keyspace — so both sides advance and neither is left holding a row that
     * is no longer theirs.
     */
    async reanchor(
        row: DurableSubscription,
        next: ReanchorInput,
    ): Promise<{ row: DurableSubscription; bumps: GenerationBump[] }> {
        await this.clients.db.write(
            `UPDATE \`${TABLE}\` SET \`token\` = ?, \`anchor_uid\` = ?, ` +
                '`anchor_path` = ?, `match` = ?, `owner_user_id` = ? ' +
                'WHERE `sub_id` = ?',
            [
                next.token,
                next.anchorUid,
                next.anchorPath,
                next.match,
                next.ownerUserId,
                row.subId,
            ],
        );

        const moved: DurableSubscription = { ...row, ...next };
        await this.stores.eventSubscription.dropDurable(row);
        await this.stores.eventSubscription.cacheDurable([moved]);

        const owners = new Set([row.ownerUserId, next.ownerUserId]);
        return {
            row: moved,
            bumps: await Promise.all(
                [...owners].map((owner) => this.#bump(owner)),
            ),
        };
    }

    /**
     * Bring this region's cache for one owner up to date with the table, unless
     * it already is. Returns whether the table was read, which is what the
     * hot-path tests assert on.
     */
    async warmRegion(ownerUserId: number): Promise<boolean> {
        if (await this.stores.eventSubscription.isRegionWarm(ownerUserId))
            return false;
        await this.#rebuildRegion(ownerUserId);
        return true;
    }

    /**
     * Reap rows past their expiry, dropping each from the cache so the region
     * stops delivering against it without waiting for a rebuild.
     */
    async sweepExpired(batchSize: number): Promise<number> {
        return this.#reap(await this.#listExpired(nowSeconds(), batchSize));
    }

    /**
     * Reap rows suspended longer than the retention window. A suspension that
     * never resumes is a row kept only so its holder can see why it stopped,
     * and that answer has a shelf life.
     */
    async sweepSuspended(cutoff: number, batchSize: number): Promise<number> {
        return this.#reap(await this.#listSuspendedBefore(cutoff, batchSize));
    }

    // -- Reads -------------------------------------------------------

    /**
     * One row by id. Primary, because "not found" is how this surface answers a
     * subscription that is not the caller's — and a replica behind by a moment
     * would give that answer for a row the caller has only just created.
     */
    async getBySubId(subId: string): Promise<DurableSubscription | null> {
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` WHERE \`sub_id\` = ?`,
            [subId],
        );
        return rows.length > 0 ? toRow(rows[0]) : null;
    }

    /**
     * What an actor may see, keyset-paginated on `id`. `appUid` is the scope:
     * pass it for an app-context caller and the index answers the question,
     * omit it for the account view that spans apps — including rows left behind
     * by an app that has since been removed.
     */
    async listForHolder(
        holderUserId: number,
        options: DurableListOptions = {},
    ): Promise<PageResult<DurableSubscription>> {
        const limit = Math.min(
            Math.max(
                1,
                Math.floor(options.limit ?? DURABLE_LIST_DEFAULT_LIMIT),
            ),
            DURABLE_LIST_LIMIT_CAP,
        );
        const after = asNumber(decodeCursor(options.cursor)?.id);

        // The scope half of the predicate is what the total counts over; the
        // cursor half only positions one page inside it.
        const scope = ['`holder_user_id` = ?', this.#unexpiredClause()];
        const scopeParams: unknown[] = [holderUserId, nowSeconds()];
        if (options.appUid !== undefined && options.appUid !== null) {
            scope.push('`app_uid` = ?');
            scopeParams.push(options.appUid);
        }

        const where = [...scope];
        const params = [...scopeParams];
        if (after !== null) {
            where.push('`id` > ?');
            params.push(after);
        }

        const rows = await this.clients.db.read(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                `WHERE ${where.join(' AND ')} ORDER BY \`id\` LIMIT ?`,
            [...params, limit + 1],
        );

        const page = rows.slice(0, limit);
        const result: PageResult<DurableSubscription> = {
            items: page.map(toRow),
        };
        if (rows.length > limit)
            result.cursor = encodeCursor({
                id: Number(page[page.length - 1].id),
            });

        if (options.includeTotal) {
            const [count] = await this.clients.db.read(
                `SELECT COUNT(*) AS \`total\` FROM \`${TABLE}\` ` +
                    `WHERE ${scope.join(' AND ')}`,
                scopeParams,
            );
            result.total = Number(count?.total ?? 0);
        }
        return result;
    }

    /**
     * Quota counting, over the same index the listing uses: what the account
     * holds, and how much of that is one app's. Both caps come off one read.
     * Primary — a count read off a lagging replica is a cap a burst of
     * subscribes walks straight through.
     */
    async countForHolder(
        holderUserId: number,
        appUid: string | null = null,
    ): Promise<{ total: number; forApp: number }> {
        const [row] = await this.clients.db.pread(
            `SELECT COUNT(*) AS \`total\`, ` +
                'SUM(CASE WHEN `app_uid` = ? THEN 1 ELSE 0 END) AS `for_app` ' +
                `FROM \`${TABLE}\` WHERE \`holder_user_id\` = ? AND ${this.#unexpiredClause()}`,
            [appUid, holderUserId, nowSeconds()],
        );
        return {
            total: Number(row?.total ?? 0),
            forApp: Number(row?.for_app ?? 0),
        };
    }

    /**
     * The holder's live rows, which is what a revocation has to consider. Same
     * index the listing and the quota use — passing `appUid` narrows to one
     * app's rows, which is what a grant made to that app can have authorized.
     *
     * Bounded by the per-account quota, so the whole set fits one read.
     */
    async listActiveForHolder(
        holderUserId: number,
        appUid: string | null,
    ): Promise<DurableSubscription[]> {
        const where = [
            '`holder_user_id` = ?',
            '`suspended_at` IS NULL',
            this.#unexpiredClause(),
        ];
        const params: unknown[] = [holderUserId, nowSeconds()];
        if (appUid !== null) {
            where.push('`app_uid` = ?');
            params.push(appUid);
        }
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                `WHERE ${where.join(' AND ')} ORDER BY \`id\` LIMIT ?`,
            [...params, EVENTS_DURABLE_SUBSCRIPTIONS_MAX],
        );
        return rows.map(toRow);
    }

    /**
     * The rows bound to one of an app's handler names. What a removal has to
     * suspend, and — asking for the suspended half — what a republish resumes.
     *
     * Bounded by the per-account quota times nothing: a widely-used handler can
     * carry more rows than one read should return, so this is a page and the
     * caller walks it until it comes back short.
     */
    async listByHandler(
        appUid: string,
        handlerName: string,
        options: { suspendedReason?: SuspendedReason; limit?: number } = {},
    ): Promise<DurableSubscription[]> {
        const where = ['`app_uid` = ?', '`handler_name` = ?'];
        const params: unknown[] = [appUid, handlerName];
        if (options.suspendedReason === undefined) {
            where.push('`suspended_at` IS NULL');
        } else {
            where.push('`suspended_at` IS NOT NULL', '`suspended_reason` = ?');
            params.push(options.suspendedReason);
        }

        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                `WHERE ${where.join(' AND ')} ORDER BY \`id\` LIMIT ?`,
            [
                ...params,
                Math.max(1, Math.floor(options.limit ?? HANDLER_SETTLE_BATCH)),
            ],
        );
        return rows.map(toRow);
    }

    /**
     * One holder's rows suspended for a given reason — what a resume condition
     * that belongs to the account rather than to a handler releases.
     */
    async listSuspendedForHolder(
        holderUserId: number,
        reason: SuspendedReason,
    ): Promise<DurableSubscription[]> {
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                'WHERE `holder_user_id` = ? AND `suspended_at` IS NOT NULL ' +
                `AND \`suspended_reason\` = ? AND ${this.#unexpiredClause()} ` +
                'ORDER BY `id` LIMIT ?',
            [
                holderUserId,
                reason,
                nowSeconds(),
                EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
            ],
        );
        return rows.map(toRow);
    }

    /**
     * Rows suspended for one reason across every holder, one keyset page at a
     * time. The credit sweep is the one pass that has to see all of them rather
     * than one account's, and it walks the primary key so a long scan never
     * holds a position anything else waits on.
     */
    async listSuspendedPage(
        reason: SuspendedReason,
        afterId: number,
        batchSize: number,
    ): Promise<DurablePage> {
        return this.#page(
            ['`suspended_at` IS NOT NULL', '`suspended_reason` = ?'],
            [reason],
            afterId,
            batchSize,
        );
    }

    /**
     * Every row a region has to be able to deliver for one owner. Read from the
     * primary: this is what a cold region caches, and caching a replica's "no
     * rows yet" would silence a subscription with nothing to correct it.
     */
    async listDeliverableForOwner(
        ownerUserId: number,
    ): Promise<DurableSubscription[]> {
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                'WHERE `owner_user_id` = ? AND `suspended_at` IS NULL AND ' +
                `${this.#unexpiredClause()}`,
            [ownerUserId, nowSeconds()],
        );
        return rows.map(toRow);
    }

    // -- Internals ---------------------------------------------------

    /** One page of a whole-table scan, ordered and positioned by primary key. */
    async #page(
        where: string[],
        params: unknown[],
        afterId: number,
        batchSize: number,
    ): Promise<DurablePage> {
        const limit = Math.max(1, Math.floor(batchSize));
        const rows = await this.clients.db.read(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                `WHERE ${[...where, '`id` > ?'].join(' AND ')} ` +
                'ORDER BY `id` LIMIT ?',
            [...params, afterId, limit],
        );
        return {
            rows: rows.map(toRow),
            nextId:
                rows.length < limit
                    ? null
                    : Number(rows[rows.length - 1].id) || null,
        };
    }

    async #rebuildRegion(ownerUserId: number): Promise<void> {
        const rows = await this.listDeliverableForOwner(ownerUserId);
        await this.stores.eventSubscription.rebuildDurable(ownerUserId, rows);
    }

    /** `?` binds the cutoff, so no clock crosses the wire as SQL. */
    #unexpiredClause(): string {
        return '(`expires_at` IS NULL OR `expires_at` > ?)';
    }

    async #listExpired(
        cutoff: number,
        batchSize: number,
    ): Promise<DurableSubscription[]> {
        const limit = Math.max(1, Math.floor(batchSize));
        const rows = await this.clients.db.read(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                'WHERE `expires_at` IS NOT NULL AND `expires_at` <= ? ' +
                'ORDER BY `id` LIMIT ?',
            [cutoff, limit],
        );
        return rows.map(toRow);
    }

    async #listSuspendedBefore(
        cutoff: number,
        batchSize: number,
    ): Promise<DurableSubscription[]> {
        const limit = Math.max(1, Math.floor(batchSize));
        const rows = await this.clients.db.read(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                'WHERE `suspended_at` IS NOT NULL AND `suspended_at` <= ? ' +
                'ORDER BY `id` LIMIT ?',
            [cutoff, limit],
        );
        return rows.map(toRow);
    }

    /** Delete a batch and leave no region delivering against any of it. */
    async #reap(rows: readonly DurableSubscription[]): Promise<number> {
        if (rows.length === 0) return 0;

        await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`sub_id\` IN ` +
                `(${rows.map(() => '?').join(', ')})`,
            rows.map((row) => row.subId),
        );

        const owners = new Set<number>();
        for (const row of rows) {
            await this.stores.eventSubscription.dropDurable(row);
            // Whatever was still owed to a row that no longer exists.
            await this.stores.pendingDelivery.purge(row.subId).catch(() => {});
            owners.add(row.ownerUserId);
        }
        for (const ownerUserId of owners) await this.#bump(ownerUserId);
        return rows.length;
    }

    /**
     * The row cannot exist with transports its delivery class cannot use, or
     * with a `worker` target and no app to run one for — "one events worker per
     * app" means no app is no worker target, not a worker with nowhere to go.
     * Held here rather than only at the API, so a writer that never passes
     * through one cannot leave an unsatisfiable row behind.
     */
    #assertTargets(
        delivery: DeliveryClass,
        targets: readonly string[],
        appUid: string | null,
    ): SubscriptionTarget[] {
        if (!Array.isArray(targets) || targets.length === 0)
            throw invalidTargets();
        if (!targets.every(isSubscriptionTarget)) throw invalidTargets();

        const unique = [...new Set(targets as SubscriptionTarget[])];
        if (!targetsAllowedForDelivery(delivery, unique, appUid))
            throw pushOnSingle();
        if (appUid === null && unique.includes('worker'))
            throw workerNeedsApp();
        return unique;
    }

    #assertContext(context: string | null): void {
        if (context === null) return;
        if (Buffer.byteLength(context, 'utf8') > DURABLE_CONTEXT_MAX_BYTES)
            throw contextTooLarge();
    }

    async #bump(ownerUserId: number): Promise<GenerationBump> {
        return {
            userId: ownerUserId,
            generation:
                await this.stores.eventSubscription.bumpGeneration(ownerUserId),
        };
    }
}
