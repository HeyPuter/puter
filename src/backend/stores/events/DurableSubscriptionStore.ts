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
    EVENTS_REVOKED_SUBSCRIPTIONS_KEPT,
    type TieredQuota,
} from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { DeliveryClass } from '../../services/events/registry.js';
import type { FsOp } from '../../services/events/subjects.js';
import {
    keysetPage,
    openIdCursor,
    type PageResult,
} from '../../util/pagination.js';
import { PuterStore } from '../types.js';
import {
    assertColumnWidths,
    EVENT_SUBSCRIPTION_WIDTHS,
} from './columnWidths.js';
import type { GenerationBump } from './EventSubscriptionStore.js';
import {
    isScheduleRow,
    SCHEDULE_TOKEN_PREFIX,
    scheduleToken,
    type DurableSubscription,
    type SubscriptionPermission,
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

/** Rows one page of a holder-wide settle takes. */
export const HOLDER_SETTLE_BATCH = 500;

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
    handlerName: string | null;
    context: string | null;
    permission: SubscriptionPermission;
    expiresAt: number | null;
    includeValue?: true;
    /**
     * Plan-resolved caps this subscribe is held to. Omitted falls back to the
     * structural maximum, so a writer that never resolved a plan still cannot
     * leave an account holding more rows than the design allows.
     */
    limits?: TieredQuota;
}

/** What a reap deleted, and the generations it bumped. */
export interface DurableReap {
    rows: DurableSubscription[];
    bumps: GenerationBump[];
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

/**
 * Reasons that never lift. A row suspended for one is kept only so its holder
 * can list it, so it holds no quota slot.
 */
export const TERMINAL_SUSPENDED_REASONS: readonly SuspendedReason[] = [
    'permission_revoked',
];

/** Rows suspended for good. The `?`s bind {@link TERMINAL_SUSPENDED_REASONS}. */
const TERMINAL_CLAUSE =
    '(`suspended_at` IS NOT NULL AND `suspended_reason` IN (' +
    `${TERMINAL_SUSPENDED_REASONS.map(() => '?').join(', ')}))`;

/**
 * Leaves out the rows schedules own: they have their own caps and listing, and
 * never enter the dispatch cache. Binds {@link SCHEDULE_TOKEN_PATTERN}.
 */
const NOT_SCHEDULE_CLAUSE = '`token` NOT LIKE ?';
const SCHEDULE_TOKEN_PATTERN = `${SCHEDULE_TOKEN_PREFIX}%`;

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

export const assertDurableContext = (context: string | null): void => {
    if (context === null) return;
    if (Buffer.byteLength(context, 'utf8') > DURABLE_CONTEXT_MAX_BYTES)
        throw contextTooLarge();
};

const quotaReached = (limit: number, scope: 'account' | 'app'): HttpError =>
    new HttpError(
        429,
        scope === 'app'
            ? `An app may hold ${limit} durable subscriptions for one account`
            : `An account may hold ${limit} durable subscriptions`,
        { legacyCode: 'events_subscription_limit' },
    );

/** What one holder's rows add up to, as the quota reads them. */
export interface DurableHolderCount {
    /** Rows holding a slot: live, or suspended for a reason that lifts. */
    total: number;
    /** The part of `total` that is one app's. */
    forApp: number;
    /** Rows suspended for good, which hold no slot. */
    terminal: number;
}

/**
 * The refusal for a create whose holder is at a cap, or `null`. `own` is how
 * many of the counted rows are this create's: none before its insert, one
 * after.
 */
const quotaRefusal = (
    input: DurableSubscriptionInput,
    held: DurableHolderCount,
    own: 0 | 1,
): HttpError | null => {
    const perUser = Math.min(
        input.limits?.perUser ?? EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
        EVENTS_DURABLE_SUBSCRIPTIONS_MAX,
    );
    const perApp = input.limits?.perApp ?? perUser;
    if (held.total - own >= perUser) return quotaReached(perUser, 'account');
    if (input.appUid !== null && held.forApp - own >= perApp)
        return quotaReached(perApp, 'app');
    return null;
};

/**
 * The quota refusal for a create that concurrent creates beat to the last slot
 * after its own insert. Its row is already gone again; `bump` still has to be
 * published, because another region may have cached the row in between.
 */
export class DurableQuotaRaceLost extends HttpError {
    readonly bump: GenerationBump | null;

    constructor(refusal: HttpError, bump: GenerationBump | null) {
        super(refusal.statusCode, refusal.message, {
            legacyCode: refusal.legacyCode,
        });
        this.bump = bump;
    }
}

// -- Row mapping ------------------------------------------------------

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const asNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The `targets` column predates delivery to every transport. Nothing reads it;
 * it is written with what older servers expect for this row.
 */
const legacyTargets = (appUid: string | null): string =>
    JSON.stringify(appUid === null ? ['socket'] : ['socket', 'worker']);

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
    delivery: row.delivery === 'single' ? 'single' : 'broadcast',
    handlerName:
        row.handler_name === null || row.handler_name === undefined
            ? null
            : String(row.handler_name),
    context:
        row.context === null || row.context === undefined
            ? null
            : String(row.context),
    ...(Number(row.include_value) === 1 ? { includeValue: true } : {}),
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
    '`handler_name`, `context`, `permission`, `include_value`, ' +
    '`suspended_at`, `suspended_reason`, `expires_at`, `created_at`';

export class DurableSubscriptionStore extends PuterStore {
    // -- Writes ------------------------------------------------------

    /**
     * Insert one subscription and put it in this region's cache before
     * returning. The generation bump is what tells every other region, and the
     * caller broadcasts it.
     *
     * A schedule's row skips the durable quotas and the cache, so it comes back
     * with no bump: its caps are the schedule store's.
     */
    async create(
        input: DurableSubscriptionInput,
    ): Promise<{ row: DurableSubscription; bump: GenerationBump | null }> {
        assertDurableContext(input.context);
        const forSchedule = isScheduleRow(input);
        assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, {
            token: input.token,
            appUid: input.appUid,
            subject: input.subject,
            anchorUid: input.anchorUid,
            anchorPath: input.anchorPath,
            match: input.match,
            handlerName: input.handlerName,
            permission: input.permission,
        });

        if (!forSchedule) {
            const refusal = quotaRefusal(
                input,
                await this.countForHolder(input.holderUserId, input.appUid),
                0,
            );
            if (refusal) throw refusal;
        }

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
            handlerName: input.handlerName,
            context: input.context,
            ...(input.includeValue ? { includeValue: true } : {}),
            expiresAt: input.expiresAt,
            suspendedAt: null,
            suspendedReason: null,
            createdAt: nowSeconds(),
        };
        assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, { subId: row.subId });

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
            targets: legacyTargets(row.appUid),
            context: row.context,
            permission: row.permission,
            include_value: row.includeValue ? 1 : 0,
            expires_at: row.expiresAt,
            created_at: row.createdAt,
        });
        if (forSchedule) return { row, bump: null };

        // Concurrent creates can all pass the count above. Counted again with
        // this row in it, each one past the cap takes itself back out — at
        // the last slot that may refuse more than it had to, never fewer.
        const held = await this.countForHolder(
            input.holderUserId,
            input.appUid,
        );
        const lost = quotaRefusal(input, held, 1);
        if (lost) throw new DurableQuotaRaceLost(lost, await this.remove(row));
        if (held.terminal > EVENTS_REVOKED_SUBSCRIPTIONS_KEPT)
            await this.#dropOldestTerminal(
                input.holderUserId,
                held.terminal - EVENTS_REVOKED_SUBSCRIPTIONS_KEPT,
            );

        // Write-through, and over the whole owner rather than the one row: it
        // costs the same indexed read as a warm would, on a path rate-limited
        // to a few calls a minute, and it leaves this region needing nothing
        // from the table before it can deliver.
        await this.#rebuildRegion(row.ownerUserId);
        return { row, bump: await this.#bump(row.ownerUserId) };
    }

    /**
     * Remove one row and stop this region delivering against it.
     *
     * `null` when a concurrent duplicate of this call already deleted it.
     */
    async remove(row: DurableSubscription): Promise<GenerationBump | null> {
        const written = await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`sub_id\` = ?`,
            [row.subId],
        );
        if (!written.anyRowsAffected) return null;
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
        opts: { override?: readonly SuspendedReason[] } = {},
    ): Promise<{ suspended: DurableSubscription[]; bumps: GenerationBump[] }> {
        if (rows.length === 0) return { suspended: [], bumps: [] };

        // One conditional write per row, so two settles racing over the same
        // rows — an unshare withdraws several grant strings in a row — each
        // learn exactly which rows they were the one to suspend.
        //
        // `override` re-stamps a row already out of service for one of the
        // named reasons, so a revocation reaches it and its backlog is purged
        // rather than waiting for a resume that must never come.
        const override = opts.override ?? [];
        const condition = override.length
            ? '(`suspended_at` IS NULL OR `suspended_reason` IN ' +
              `(${override.map(() => '?').join(', ')}))`
            : '`suspended_at` IS NULL';
        const at = nowSeconds();
        const suspended: DurableSubscription[] = [];
        for (const row of rows) {
            const written = await this.clients.db.write(
                `UPDATE \`${TABLE}\` SET \`suspended_at\` = ?, ` +
                    '`suspended_reason` = ? ' +
                    `WHERE \`sub_id\` = ? AND ${condition}`,
                [at, reason, row.subId, ...override],
            );
            if (written.anyRowsAffected)
                suspended.push({
                    ...row,
                    suspendedAt: at,
                    suspendedReason: reason,
                });
        }

        const cached = suspended.filter((row) => !isScheduleRow(row));
        await this.stores.eventSubscription.dropDurables(cached);
        const owners = new Set(cached.map((row) => row.ownerUserId));
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
            if (isScheduleRow(row)) continue;
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
     *
     * `bumps` comes back empty when a concurrent unsubscribe already deleted
     * the row.
     */
    async reanchor(
        row: DurableSubscription,
        next: ReanchorInput,
    ): Promise<{ row: DurableSubscription; bumps: GenerationBump[] }> {
        assertColumnWidths(EVENT_SUBSCRIPTION_WIDTHS, {
            token: next.token,
            anchorUid: next.anchorUid,
            anchorPath: next.anchorPath,
            match: next.match,
        });

        const written = await this.clients.db.write(
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
        if (!written.anyRowsAffected) return { row, bumps: [] };

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
     * Replace one row's `context`, keeping its id and whatever it is still
     * owed. Null when a concurrent unsubscribe already deleted the row.
     */
    async updateContext(
        row: DurableSubscription,
        context: string | null,
    ): Promise<{ row: DurableSubscription; bump: GenerationBump } | null> {
        assertDurableContext(context);
        const written = await this.clients.db.write(
            `UPDATE \`${TABLE}\` SET \`context\` = ? WHERE \`sub_id\` = ?`,
            [context, row.subId],
        );
        if (!written.anyRowsAffected) return null;

        // Rebuilt from the table rather than cached from `row`: a row
        // suspended since it was read must not go back into the cache.
        await this.#rebuildRegion(row.ownerUserId);
        return {
            row: { ...row, context },
            bump: await this.#bump(row.ownerUserId),
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
    async sweepExpired(batchSize: number): Promise<DurableReap> {
        return this.#reap(await this.#listExpired(nowSeconds(), batchSize));
    }

    /**
     * Reap rows suspended longer than the retention window. A suspension that
     * never resumes is a row kept only so its holder can see why it stopped,
     * and that answer has a shelf life.
     */
    async sweepSuspended(
        cutoff: number,
        batchSize: number,
    ): Promise<DurableReap> {
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
        const after = openIdCursor(options.cursor, this.config.jwt_secret_v2);

        // The scope half of the predicate is what the total counts over; the
        // cursor half only positions one page inside it.
        const scope = [
            '`holder_user_id` = ?',
            this.#unexpiredClause(),
            NOT_SCHEDULE_CLAUSE,
        ];
        const scopeParams: unknown[] = [
            holderUserId,
            nowSeconds(),
            SCHEDULE_TOKEN_PATTERN,
        ];
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

        const page = keysetPage(rows, limit, this.config.jwt_secret_v2);
        const result: PageResult<DurableSubscription> = {
            items: page.rows.map(toRow),
        };
        if (page.cursor) result.cursor = page.cursor;

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
    ): Promise<DurableHolderCount> {
        const terminal = TERMINAL_SUSPENDED_REASONS;
        const [row] = await this.clients.db.pread(
            `SELECT SUM(CASE WHEN ${TERMINAL_CLAUSE} THEN 0 ELSE 1 END) AS \`total\`, ` +
                `SUM(CASE WHEN ${TERMINAL_CLAUSE} THEN 0 ` +
                'WHEN `app_uid` = ? THEN 1 ELSE 0 END) AS `for_app`, ' +
                `SUM(CASE WHEN ${TERMINAL_CLAUSE} THEN 1 ELSE 0 END) AS \`terminal\` ` +
                `FROM \`${TABLE}\` WHERE \`holder_user_id\` = ? AND ${this.#unexpiredClause()} ` +
                `AND ${NOT_SCHEDULE_CLAUSE}`,
            [
                ...terminal,
                ...terminal,
                appUid,
                ...terminal,
                holderUserId,
                nowSeconds(),
                SCHEDULE_TOKEN_PATTERN,
            ],
        );
        return {
            total: Number(row?.total ?? 0),
            forApp: Number(row?.for_app ?? 0),
            terminal: Number(row?.terminal ?? 0),
        };
    }

    /**
     * The holder's live rows, which is what a revocation has to consider, one
     * keyset page at a time. Same index the listing and the quota use — passing
     * `appUid` narrows to one app's rows, which is what a grant made to that
     * app can have authorized. Schedule rows are included: a holder can hold
     * far more of them than the durable quota allows, which is why this pages.
     *
     * `includeSuspended` also returns rows out of service for a reason that
     * lifts. A revocation needs them: those reasons hold a backlog, and a row
     * skipped here comes back in service on the next resume and hands it over.
     * Rows suspended for good are left out.
     */
    async listActiveForHolderPage(
        holderUserId: number,
        appUid: string | null,
        afterId: number,
        batchSize: number = HOLDER_SETTLE_BATCH,
        opts: { includeSuspended?: boolean } = {},
    ): Promise<DurablePage> {
        const where = [
            '`holder_user_id` = ?',
            opts.includeSuspended
                ? `NOT ${TERMINAL_CLAUSE}`
                : '`suspended_at` IS NULL',
            this.#unexpiredClause(),
        ];
        const params: unknown[] = [
            holderUserId,
            ...(opts.includeSuspended ? TERMINAL_SUSPENDED_REASONS : []),
            nowSeconds(),
        ];
        if (appUid !== null) {
            where.push('`app_uid` = ?');
            params.push(appUid);
        }
        return this.#page(where, params, afterId, batchSize, {
            primary: true,
        });
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
     * that belongs to the account rather than to a handler releases — one
     * keyset page at a time.
     */
    async listSuspendedForHolderPage(
        holderUserId: number,
        reason: SuspendedReason,
        afterId: number,
        batchSize: number = HOLDER_SETTLE_BATCH,
    ): Promise<DurablePage> {
        return this.#page(
            [
                '`holder_user_id` = ?',
                '`suspended_at` IS NOT NULL',
                '`suspended_reason` = ?',
                this.#unexpiredClause(),
            ],
            [holderUserId, reason, nowSeconds()],
            afterId,
            batchSize,
            { primary: true },
        );
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
                `${this.#unexpiredClause()} AND ${NOT_SCHEDULE_CLAUSE}`,
            [ownerUserId, nowSeconds(), SCHEDULE_TOKEN_PATTERN],
        );
        return rows.map(toRow);
    }

    /**
     * Every holder with a row bound to this app — who may hold a reused
     * `events:handlers` worker session for it.
     * `idx_event_subscriptions_app_handler` is `app_uid`-leading, so this is an
     * indexed scan rather than a table scan, with no new index needed.
     * Suspended rows included: a row `handler_not_found` still names a holder
     * who may hold the session.
     */
    async listHolderIdsForApp(appUid: string): Promise<number[]> {
        const rows = await this.clients.db.pread(
            `SELECT DISTINCT \`holder_user_id\` FROM \`${TABLE}\` WHERE \`app_uid\` = ?`,
            [appUid],
        );
        return rows.map((row) => Number(row.holder_user_id));
    }

    /**
     * Page and delete every row bound to one app, wherever its holder lives.
     * What app deletion reaps: `#reap` already purges the backlog, drops the
     * cache and bumps a generation per owner, so this is the whole of it.
     */
    async reapForApp(appUid: string, batchSize: number): Promise<DurableReap> {
        return this.#reap(await this.#listForApp(appUid, batchSize));
    }

    /**
     * Delete the row a schedule owns, whether or not the schedule ever recorded
     * its id: a create that crashed between the two inserts leaves one it
     * didn't. Never cached, so there is nothing to drop or bump.
     */
    async removeScheduleSubscription(scheduleUid: string): Promise<boolean> {
        const written = await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`token\` = ?`,
            [scheduleToken(scheduleUid)],
        );
        return written.anyRowsAffected;
    }

    // -- Internals ---------------------------------------------------

    /**
     * Delete a holder's oldest rows suspended for good, past what `list` keeps.
     * Best-effort: the next subscribe tries again.
     */
    async #dropOldestTerminal(
        holderUserId: number,
        count: number,
    ): Promise<void> {
        try {
            const rows = await this.clients.db.pread(
                `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                    `WHERE \`holder_user_id\` = ? AND ${TERMINAL_CLAUSE} ` +
                    `AND ${NOT_SCHEDULE_CLAUSE} ` +
                    'ORDER BY `suspended_at`, `id` LIMIT ?',
                [
                    holderUserId,
                    ...TERMINAL_SUSPENDED_REASONS,
                    SCHEDULE_TOKEN_PATTERN,
                    count,
                ],
            );
            await this.#reap(rows.map(toRow));
        } catch (err) {
            console.warn('[events] could not drop old revoked rows', err);
        }
    }

    /**
     * Primary, unlike the timed sweeps: this runs the moment an app is deleted,
     * and a replica still a beat behind would answer "nothing to reap" and
     * leave the rows with nothing to come back for them.
     */
    async #listForApp(
        appUid: string,
        batchSize: number,
    ): Promise<DurableSubscription[]> {
        const limit = Math.max(1, Math.floor(batchSize));
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                'WHERE `app_uid` = ? ORDER BY `id` LIMIT ?',
            [appUid, limit],
        );
        return rows.map(toRow);
    }

    /**
     * One keyset page, ordered and positioned by primary key. The replica
     * unless `primary`, which settles need: a lagging read would skip a row
     * just created.
     */
    async #page(
        where: string[],
        params: unknown[],
        afterId: number,
        batchSize: number,
        opts: { primary?: boolean } = {},
    ): Promise<DurablePage> {
        const limit = Math.max(1, Math.floor(batchSize));
        const read = opts.primary
            ? this.clients.db.pread.bind(this.clients.db)
            : this.clients.db.read.bind(this.clients.db);
        const rows = await read(
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

    /**
     * Delete a batch and leave no region delivering against any of it. The
     * deleted rows come back so the caller can end the schedules among them.
     */
    async #reap(rows: readonly DurableSubscription[]): Promise<DurableReap> {
        if (rows.length === 0) return { rows: [], bumps: [] };

        await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`sub_id\` IN ` +
                `(${rows.map(() => '?').join(', ')})`,
            rows.map((row) => row.subId),
        );

        const cached = rows.filter((row) => !isScheduleRow(row));
        await this.stores.eventSubscription.dropDurables(cached);
        for (const row of cached) {
            // Whatever was still owed to a row that no longer exists.
            try {
                await this.stores.pendingDelivery.purge(row.subId);
            } catch {
                // Best-effort: the row is already gone.
            }
        }
        const owners = new Set(cached.map((row) => row.ownerUserId));
        const bumps: GenerationBump[] = [];
        for (const ownerUserId of owners)
            bumps.push(await this.#bump(ownerUserId));
        return { rows: [...rows], bumps };
    }

    async #bump(ownerUserId: number): Promise<GenerationBump> {
        return {
            userId: ownerUserId,
            generation:
                await this.stores.eventSubscription.bumpGeneration(ownerUserId),
        };
    }
}
