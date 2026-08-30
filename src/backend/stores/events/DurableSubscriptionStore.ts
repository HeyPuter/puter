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
import { EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER } from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { AclMode } from '../../services/acl/ACLService.js';
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
    permission: AclMode;
    expiresAt: number | null;
}

export interface DurableListOptions {
    /** Confines the listing to one app's rows; omitted is the account view. */
    appUid?: string | null;
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
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
    new HttpError(400, 'A `single` subscription may not target `push`', {
        legacyCode: 'invalid_targets',
    });

const quotaReached = (): HttpError =>
    new HttpError(
        429,
        `An account may hold ${EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER} durable subscriptions`,
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
    permission: String(row.permission) as AclMode,
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
        const targets = this.#assertTargets(input.delivery, input.targets);
        this.#assertContext(input.context);

        const held = await this.countForHolder(input.holderUserId);
        if (held >= EVENTS_DURABLE_SUBSCRIPTIONS_PER_USER) throw quotaReached();

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
        const rows = await this.#listExpired(nowSeconds(), batchSize);
        if (rows.length === 0) return 0;

        await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`sub_id\` IN ` +
                `(${rows.map(() => '?').join(', ')})`,
            rows.map((row) => row.subId),
        );

        const owners = new Set<number>();
        for (const row of rows) {
            await this.stores.eventSubscription.dropDurable(row);
            owners.add(row.ownerUserId);
        }
        for (const ownerUserId of owners) await this.#bump(ownerUserId);
        return rows.length;
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
     * Quota counting, over the same index the listing uses. Primary: a count
     * read off a lagging replica is a cap a burst of subscribes walks straight
     * through.
     */
    async countForHolder(holderUserId: number): Promise<number> {
        const [row] = await this.clients.db.pread(
            `SELECT COUNT(*) AS \`total\` FROM \`${TABLE}\` ` +
                `WHERE \`holder_user_id\` = ? AND ${this.#unexpiredClause()}`,
            [holderUserId, nowSeconds()],
        );
        return Number(row?.total ?? 0);
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

    /**
     * The row cannot exist with transports its delivery class cannot use. Held
     * here rather than only at the API, so a writer that never passes through
     * one cannot leave an unsatisfiable row behind.
     */
    #assertTargets(
        delivery: DeliveryClass,
        targets: readonly string[],
    ): SubscriptionTarget[] {
        if (!Array.isArray(targets) || targets.length === 0)
            throw invalidTargets();
        if (!targets.every(isSubscriptionTarget)) throw invalidTargets();

        const unique = [...new Set(targets as SubscriptionTarget[])];
        if (!targetsAllowedForDelivery(delivery, unique)) throw pushOnSingle();
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
