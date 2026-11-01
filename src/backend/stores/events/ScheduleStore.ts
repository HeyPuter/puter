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
    EVENTS_SCHEDULE_PAYLOAD_MAX_BYTES,
    EVENTS_SCHEDULE_TOMBSTONE_TTL_MS,
} from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    keysetPage,
    openIdCursor,
    type PageResult,
} from '../../util/pagination.js';
import { PuterStore } from '../types.js';
import { assertColumnWidths, EVENT_SCHEDULE_WIDTHS } from './columnWidths.js';
import {
    scheduleToken,
    type ScheduleKind,
    type SubscriptionPermission,
} from './types.js';

/**
 * Schedule definitions (`event_schedules`).
 *
 * A row is written on create and on lifecycle changes, never per run: when a
 * schedule runs next is computed from its definition. Every UPDATE bumps
 * `version`, which orders changes to one row; `updated_at` is only where a
 * reconcile resumes. A recurring or `once` schedule also owns one
 * `event_subscriptions` row (`schedule:<uid>`), which carries its suspension
 * state through the subscription lifecycle.
 */

export type ScheduleState = 'active' | 'sending' | 'delivered' | 'done';

export type ScheduleEndReason =
    | 'removed'
    | 'ended'
    | 'app_deleted'
    | 'uninstalled'
    | 'permission_revoked'
    | 'holder_gone'
    | 'app_gone'
    | 'orphaned'
    | 'delivered'
    | 'dropped';

/** A schedule row with no subscription row this old was left by a crash. */
export const SCHEDULE_ORPHAN_AGE_MS = 10 * 60 * 1000;

/** Default page size for the holder listing, and its ceiling. */
export const SCHEDULE_LIST_DEFAULT_LIMIT = 50;
export const SCHEDULE_LIST_LIMIT_CAP = 200;

/** Ids one UPDATE names. */
const WRITE_BATCH = 500;

const TABLE = 'event_schedules';

export interface ScheduleRow {
    id: number;
    uid: string;
    namespace: string;
    kind: ScheduleKind;
    subId: string | null;
    holderUserId: number;
    appUid: string;
    region: string;
    startAt: number;
    everyMs: number | null;
    cron: string | null;
    tz: string;
    endsAt: number | null;
    ratePerHour: number;
    minGapMs: number | null;
    handlerDepth: number;
    action: string | null;
    /** JSON text. */
    payload: string | null;
    state: ScheduleState;
    sendToken: string | null;
    sendUntil: number | null;
    endReason: ScheduleEndReason | null;
    version: number;
    deletedAt: number | null;
    createdAt: number;
    updatedAt: number;
}

/** The subscription columns a reconcile reads with a schedule row. */
export interface ScheduleSubscriptionState {
    suspendedAt: number | null;
    suspendedReason: string | null;
    handlerName: string | null;
    context: string | null;
}

/** A schedule row joined with its subscription row, `null` if it has none. */
export interface ScheduleSyncRow extends ScheduleRow {
    sub: ScheduleSubscriptionState | null;
}

/** Plan-resolved caps one create is held to. */
export interface ScheduleQuota {
    recurringPerUser: number;
    recurringPerApp: number;
    oneShotsPerUser: number;
    oneShotsPerApp: number;
    /** Worst-case runs per hour × 1000, summed over recurring rows. */
    budgetPerUser: number;
    budgetPerApp: number;
}

/** What one holder's live rows add up to. */
export interface ScheduleUsage {
    recurring: { total: number; forApp: number };
    oneShots: { total: number; forApp: number };
    rate: { total: number; forApp: number };
}

export interface ScheduleInput {
    namespace: string;
    region: string;
    kind: ScheduleKind;
    holderUserId: number;
    appUid: string;
    startAt: number;
    everyMs: number | null;
    cron: string | null;
    tz: string;
    endsAt: number | null;
    ratePerHour: number;
    minGapMs: number | null;
    handlerDepth: number;
    /** The subscription row a recurring or `once` schedule owns. */
    subscription?: {
        handlerName: string;
        context: string | null;
        permission: SubscriptionPermission;
    };
    /** `deferred` only. */
    action?: string;
    payload?: string;
    quota: ScheduleQuota;
}

/** Where a reconcile pass resumes: after this `(updated_at, id)`. */
export interface ScheduleSyncCursor {
    updatedAt: number;
    id: number;
}

export interface ScheduleListOptions {
    appUid?: string | null;
    limit?: number;
    cursor?: string;
    includeTotal?: boolean;
}

// -- Errors -----------------------------------------------------------

const limitReached = (
    limit: number,
    scope: 'account' | 'app',
    oneShot: boolean,
): HttpError => {
    const what = oneShot ? 'pending one-time schedules' : 'recurring schedules';
    return new HttpError(
        429,
        scope === 'app'
            ? `An app may hold ${limit} ${what} for one account`
            : `An account may hold ${limit} ${what}`,
        { legacyCode: 'events_schedule_limit' },
    );
};

const budgetExceeded = (scope: 'account' | 'app'): HttpError =>
    new HttpError(
        429,
        scope === 'app'
            ? "This schedule would run this app's schedules more often than its plan allows"
            : "This schedule would run this account's schedules more often than its plan allows",
        { legacyCode: 'events_schedule_budget' },
    );

const payloadTooLarge = (): HttpError =>
    new HttpError(
        413,
        `A delayed payload may not exceed ${EVENTS_SCHEDULE_PAYLOAD_MAX_BYTES} bytes`,
        { legacyCode: 'events_value_too_large' },
    );

/**
 * The refusal for a create whose holder is at a cap, or `null`. `own` is
 * whether the counted rows include this create's.
 */
const quotaRefusal = (
    input: ScheduleInput,
    usage: ScheduleUsage,
    own: 0 | 1,
): HttpError | null => {
    const { quota } = input;
    if (input.kind !== 'recurring') {
        if (usage.oneShots.total - own >= quota.oneShotsPerUser)
            return limitReached(quota.oneShotsPerUser, 'account', true);
        if (usage.oneShots.forApp - own >= quota.oneShotsPerApp)
            return limitReached(quota.oneShotsPerApp, 'app', true);
        return null;
    }
    if (usage.recurring.total - own >= quota.recurringPerUser)
        return limitReached(quota.recurringPerUser, 'account', false);
    if (usage.recurring.forApp - own >= quota.recurringPerApp)
        return limitReached(quota.recurringPerApp, 'app', false);
    const added = (1 - own) * input.ratePerHour;
    if (usage.rate.total + added > quota.budgetPerUser)
        return budgetExceeded('account');
    if (usage.rate.forApp + added > quota.budgetPerApp)
        return budgetExceeded('app');
    return null;
};

// -- Row mapping ------------------------------------------------------

const numberOrNull = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value);

const stringOrNull = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);

/** `payload` is JSON on MySQL, which the driver hands back parsed. */
const jsonText = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
};

const toRow = (row: Record<string, unknown>): ScheduleRow => ({
    id: Number(row.id),
    uid: String(row.uid),
    namespace: String(row.namespace),
    kind: String(row.kind) as ScheduleKind,
    subId: stringOrNull(row.sub_id),
    holderUserId: Number(row.holder_user_id),
    appUid: String(row.app_uid),
    region: String(row.region),
    startAt: Number(row.start_at),
    everyMs: numberOrNull(row.every_ms),
    cron: stringOrNull(row.cron),
    tz: String(row.tz),
    endsAt: numberOrNull(row.ends_at),
    ratePerHour: Number(row.rate_per_hour),
    minGapMs: numberOrNull(row.min_gap_ms),
    handlerDepth: Number(row.handler_depth),
    action: stringOrNull(row.action),
    payload: jsonText(row.payload),
    state: String(row.state) as ScheduleState,
    sendToken: stringOrNull(row.send_token),
    sendUntil: numberOrNull(row.send_until),
    endReason: stringOrNull(row.end_reason) as ScheduleEndReason | null,
    version: Number(row.version),
    deletedAt: numberOrNull(row.deleted_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
});

const toSyncRow = (row: Record<string, unknown>): ScheduleSyncRow => ({
    ...toRow(row),
    sub:
        row.sub_row_id === null || row.sub_row_id === undefined
            ? null
            : {
                  suspendedAt: numberOrNull(row.sub_suspended_at),
                  suspendedReason: stringOrNull(row.sub_suspended_reason),
                  handlerName: stringOrNull(row.sub_handler_name),
                  context: stringOrNull(row.sub_context),
              },
});

const COLUMNS = [
    'id',
    'uid',
    'namespace',
    'kind',
    'sub_id',
    'holder_user_id',
    'app_uid',
    'region',
    'start_at',
    'every_ms',
    'cron',
    'tz',
    'ends_at',
    'rate_per_hour',
    'min_gap_ms',
    'handler_depth',
    'action',
    'payload',
    'state',
    'send_token',
    'send_until',
    'end_reason',
    'version',
    'deleted_at',
    'created_at',
    'updated_at',
];

const SELECT_COLUMNS = COLUMNS.map((c) => `\`${c}\``).join(', ');

/** Schedule columns plus its subscription row's, for the reconcile join. */
const SYNC_SELECT =
    `SELECT ${COLUMNS.map((c) => `s.\`${c}\``).join(', ')}, ` +
    'sub.`id` AS `sub_row_id`, sub.`suspended_at` AS `sub_suspended_at`, ' +
    'sub.`suspended_reason` AS `sub_suspended_reason`, ' +
    'sub.`handler_name` AS `sub_handler_name`, sub.`context` AS `sub_context` ' +
    `FROM \`${TABLE}\` s LEFT JOIN \`event_subscriptions\` sub ` +
    'ON sub.`sub_id` = s.`sub_id`';

const chunks = <T>(items: readonly T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size)
        out.push(items.slice(i, i + size));
    return out;
};

/**
 * Whether a reconcile should end this row: a recurring or `once` schedule whose
 * subscription row never landed, or was lost, and that nothing has touched for
 * {@link SCHEDULE_ORPHAN_AGE_MS}.
 */
export const isScheduleOrphan = (row: ScheduleSyncRow, now: number): boolean =>
    row.kind !== 'deferred' &&
    row.deletedAt === null &&
    row.sub === null &&
    row.updatedAt <= now - SCHEDULE_ORPHAN_AGE_MS;

export class ScheduleStore extends PuterStore {
    // -- Writes ------------------------------------------------------

    /**
     * Create one schedule, with its subscription row unless it is `deferred`.
     * The subscription's id is minted by its own store, so the schedule row
     * goes in first without it and is pointed at it after. A crash in between
     * leaves an orphan, which {@link isScheduleOrphan} finds.
     *
     * Caps are counted before the insert and again after it; a create that
     * concurrent ones beat to the last slot takes both rows back out.
     */
    async create(input: ScheduleInput): Promise<ScheduleRow> {
        const oneShot = input.kind !== 'recurring';
        if (input.kind !== 'deferred' && !input.subscription)
            throw new Error('A recurring or once schedule needs a handler');
        if (
            input.payload !== undefined &&
            Buffer.byteLength(input.payload, 'utf8') >
                EVENTS_SCHEDULE_PAYLOAD_MAX_BYTES
        )
            throw payloadTooLarge();

        const uid = randomUUID();
        assertColumnWidths(EVENT_SCHEDULE_WIDTHS, {
            uid,
            namespace: input.namespace,
            appUid: input.appUid,
            region: input.region,
            cron: input.cron,
            tz: input.tz,
            action: input.action,
        });

        const refusal = quotaRefusal(
            input,
            await this.usageForHolder(input.holderUserId, input.appUid),
            0,
        );
        if (refusal) throw refusal;

        const now = Date.now();
        const inserted = await this.clients.db.insert(TABLE, {
            uid,
            namespace: input.namespace,
            kind: input.kind,
            sub_id: null,
            holder_user_id: input.holderUserId,
            app_uid: input.appUid,
            region: input.region,
            start_at: input.startAt,
            every_ms: input.everyMs,
            cron: input.cron,
            tz: input.tz,
            ends_at: oneShot ? input.startAt : input.endsAt,
            rate_per_hour: oneShot ? 0 : input.ratePerHour,
            min_gap_ms: oneShot ? null : input.minGapMs,
            handler_depth: input.handlerDepth,
            action: input.action ?? null,
            payload: input.payload ?? null,
            state: 'active',
            version: 1,
            created_at: now,
            updated_at: now,
        });
        const id = Number(inserted.insertId);

        if (input.subscription) {
            let subId: string;
            try {
                const token = scheduleToken(uid);
                const sub = await this.stores.durableSubscription.create({
                    holderUserId: input.holderUserId,
                    ownerUserId: input.holderUserId,
                    appUid: input.appUid,
                    subject: token,
                    token,
                    anchorUid: uid,
                    anchorPath: '',
                    match: null,
                    op: null,
                    delivery: 'single',
                    handlerName: input.subscription.handlerName,
                    context: input.subscription.context,
                    permission: input.subscription.permission,
                    expiresAt: null,
                });
                subId = sub.row.subId;
            } catch (err) {
                await this.#discard(id, uid);
                throw err;
            }
            await this.clients.db.write(
                `UPDATE \`${TABLE}\` SET \`sub_id\` = ?, ` +
                    '`version` = `version` + 1, `updated_at` = ? WHERE `id` = ?',
                [subId, Date.now(), id],
            );
        }

        const lost = quotaRefusal(
            input,
            await this.usageForHolder(input.holderUserId, input.appUid),
            1,
        );
        if (lost) {
            await this.#discard(id, uid);
            throw lost;
        }

        const created = await this.#getById(id);
        if (!created) throw new Error('schedule row vanished after create');
        return created;
    }

    /**
     * End rows: soft-delete with a reason, bumping `version`. Rows already
     * ended keep their first reason. Returns the rows as they now stand.
     */
    async finish(
        ids: readonly number[],
        endReason: ScheduleEndReason,
    ): Promise<ScheduleRow[]> {
        const now = Date.now();
        for (const batch of chunks(ids, WRITE_BATCH)) {
            await this.clients.db.write(
                `UPDATE \`${TABLE}\` SET \`state\` = 'done', ` +
                    '`end_reason` = ?, `deleted_at` = ?, ' +
                    '`version` = `version` + 1, `updated_at` = ? ' +
                    `WHERE \`id\` IN (${batch.map(() => '?').join(', ')}) ` +
                    'AND `deleted_at` IS NULL',
                [endReason, now, now, ...batch],
            );
        }
        return this.#getByIds(ids);
    }

    /**
     * Record a change to the subscription rows schedules own: bump each
     * schedule's `version`, and end it when `end` is given. Runs after the
     * subscription change, so a replica that shows the new version also shows
     * the subscription state behind it. Returns the rows as they now stand.
     */
    async applySubscriptionChange(
        namespace: string,
        subIds: readonly string[],
        end: { reason: ScheduleEndReason } | null,
    ): Promise<ScheduleRow[]> {
        if (subIds.length === 0) return [];
        const now = Date.now();
        const set = end
            ? "`state` = 'done', `end_reason` = ?, `deleted_at` = ?, "
            : '';
        const setParams = end ? [end.reason, now] : [];
        const rows: ScheduleRow[] = [];
        for (const batch of chunks(subIds, WRITE_BATCH)) {
            const inList = batch.map(() => '?').join(', ');
            await this.clients.db.write(
                `UPDATE \`${TABLE}\` SET ${set}` +
                    '`version` = `version` + 1, `updated_at` = ? ' +
                    `WHERE \`namespace\` = ? AND \`sub_id\` IN (${inList}) ` +
                    'AND `deleted_at` IS NULL',
                [...setParams, now, namespace, ...batch],
            );
            const read = await this.clients.db.pread(
                `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                    `WHERE \`namespace\` = ? AND \`sub_id\` IN (${inList})`,
                [namespace, ...batch],
            );
            rows.push(...read.map(toRow));
        }
        return rows;
    }

    /**
     * End a row a crash left without its subscription row, and delete any
     * subscription row the crash left without its schedule pointing at it.
     */
    async endOrphan(row: ScheduleRow): Promise<ScheduleRow | null> {
        const [ended] = await this.finish([row.id], 'orphaned');
        await this.stores.durableSubscription.removeScheduleSubscription(
            row.uid,
        );
        return ended ?? null;
    }

    // -- Reads -------------------------------------------------------

    /**
     * One schedule by its public id, ended or not. Primary: "not found" is how
     * a schedule that isn't the caller's is answered, and a lagging replica
     * would give that answer for one just created.
     */
    async get(namespace: string, uid: string): Promise<ScheduleRow | null> {
        const [row] = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                'WHERE `uid` = ? AND `namespace` = ?',
            [uid, namespace],
        );
        return row ? toRow(row) : null;
    }

    /**
     * What one holder's live rows count toward the caps, in one read over the
     * holder index. Primary, as the durable quota is: a lagging count is a cap
     * a burst of creates walks through. One-shots have no rate, so the budget
     * sums recurring rows only.
     */
    async usageForHolder(
        holderUserId: number,
        appUid: string,
    ): Promise<ScheduleUsage> {
        const recurring = "`kind` = 'recurring'";
        const oneShot = "`kind` IN ('once', 'deferred')";
        const [row] = await this.clients.db.pread(
            `SELECT SUM(CASE WHEN ${recurring} THEN 1 ELSE 0 END) AS \`recurring\`, ` +
                `SUM(CASE WHEN ${recurring} AND \`app_uid\` = ? THEN 1 ELSE 0 END) AS \`recurring_app\`, ` +
                `SUM(CASE WHEN ${oneShot} THEN 1 ELSE 0 END) AS \`one_shots\`, ` +
                `SUM(CASE WHEN ${oneShot} AND \`app_uid\` = ? THEN 1 ELSE 0 END) AS \`one_shots_app\`, ` +
                `SUM(CASE WHEN ${recurring} THEN \`rate_per_hour\` ELSE 0 END) AS \`rate\`, ` +
                `SUM(CASE WHEN ${recurring} AND \`app_uid\` = ? THEN \`rate_per_hour\` ELSE 0 END) AS \`rate_app\` ` +
                `FROM \`${TABLE}\` WHERE \`holder_user_id\` = ? AND \`deleted_at\` IS NULL`,
            [appUid, appUid, appUid, holderUserId],
        );
        const n = (value: unknown): number => Number(value ?? 0);
        return {
            recurring: {
                total: n(row?.recurring),
                forApp: n(row?.recurring_app),
            },
            oneShots: {
                total: n(row?.one_shots),
                forApp: n(row?.one_shots_app),
            },
            rate: { total: n(row?.rate), forApp: n(row?.rate_app) },
        };
    }

    /**
     * One holder's schedules, keyset-paginated on `id`: live ones, and ended
     * ones still within their retention so the holder can see why they stopped.
     * `appUid` confines it to one app's.
     */
    async listForHolder(
        namespace: string,
        holderUserId: number,
        options: ScheduleListOptions = {},
    ): Promise<PageResult<ScheduleRow>> {
        const limit = Math.min(
            Math.max(
                1,
                Math.floor(options.limit ?? SCHEDULE_LIST_DEFAULT_LIMIT),
            ),
            SCHEDULE_LIST_LIMIT_CAP,
        );
        const after = openIdCursor(options.cursor, this.config.jwt_secret_v2);

        const scope = [
            '`holder_user_id` = ?',
            '`namespace` = ?',
            '(`deleted_at` IS NULL OR `deleted_at` > ?)',
        ];
        const scopeParams: unknown[] = [
            holderUserId,
            namespace,
            Date.now() - EVENTS_SCHEDULE_TOMBSTONE_TTL_MS,
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
        const result: PageResult<ScheduleRow> = {
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
     * Rows of one region changed after `after`, oldest change first, with their
     * subscription rows. Replica. The cursor to resume from is the last row's:
     * the largest `updated_at` actually returned, never a clock. The `>=` bound
     * is what the index range starts at; the keyset half refines it.
     */
    async changedSince(
        namespace: string,
        region: string,
        after: ScheduleSyncCursor,
        limit: number,
    ): Promise<{
        rows: ScheduleSyncRow[];
        last: ScheduleSyncCursor | null;
        more: boolean;
    }> {
        const size = Math.max(1, Math.floor(limit));
        const raw = await this.clients.db.read(
            `${SYNC_SELECT} WHERE s.\`namespace\` = ? AND s.\`region\` = ? ` +
                'AND s.`updated_at` >= ? ' +
                'AND (s.`updated_at` > ? OR (s.`updated_at` = ? AND s.`id` > ?)) ' +
                'ORDER BY s.`updated_at`, s.`id` LIMIT ?',
            [
                namespace,
                region,
                after.updatedAt,
                after.updatedAt,
                after.updatedAt,
                after.id,
                size,
            ],
        );
        const rows = raw.map(toSyncRow);
        const tail = rows[rows.length - 1];
        return {
            rows,
            last: tail ? { updatedAt: tail.updatedAt, id: tail.id } : null,
            more: rows.length === size,
        };
    }

    /**
     * Every row of one region by id, ended ones included, with their
     * subscription rows. Replica. What a full diff and a rebuild walk.
     */
    async listRegionPage(
        namespace: string,
        region: string,
        afterId: number,
        limit: number,
    ): Promise<{ rows: ScheduleSyncRow[]; nextId: number | null }> {
        const size = Math.max(1, Math.floor(limit));
        const raw = await this.clients.db.read(
            `${SYNC_SELECT} WHERE s.\`namespace\` = ? AND s.\`region\` = ? ` +
                'AND s.`id` > ? ORDER BY s.`id` LIMIT ?',
            [namespace, region, afterId, size],
        );
        const rows = raw.map(toSyncRow);
        return {
            rows,
            nextId: rows.length < size ? null : rows[rows.length - 1].id,
        };
    }

    // -- Internals ---------------------------------------------------

    /** Take back a create that didn't complete: neither row was ever live. */
    async #discard(id: number, uid: string): Promise<void> {
        await this.stores.durableSubscription.removeScheduleSubscription(uid);
        await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`id\` = ?`,
            [id],
        );
    }

    async #getById(id: number): Promise<ScheduleRow | null> {
        const [row] = await this.#getByIds([id]);
        return row ?? null;
    }

    async #getByIds(ids: readonly number[]): Promise<ScheduleRow[]> {
        const rows: ScheduleRow[] = [];
        for (const batch of chunks(ids, WRITE_BATCH)) {
            const read = await this.clients.db.pread(
                `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                    `WHERE \`id\` IN (${batch.map(() => '?').join(', ')})`,
                [...batch],
            );
            rows.push(...read.map(toRow));
        }
        return rows;
    }
}
