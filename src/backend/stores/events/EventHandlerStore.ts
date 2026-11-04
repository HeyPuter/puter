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

import { createHash } from 'node:crypto';
import {
    EVENTS_HANDLERS_PER_APP,
    EVENTS_HANDLER_SOURCE_MAX_BYTES,
    EVENTS_USER_HANDLERS_PER_SCOPE,
} from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    decodeCursor,
    keysetPage,
    type PageResult,
} from '../../util/pagination.js';
import { isUniqueViolation } from '../../util/dbError.js';
import { PuterStore } from '../types.js';

/**
 * Named handlers an app has deployed.
 *
 * A handler name is a label for a piece of code, not an event: nothing triggers
 * by name, and a row here runs only when a subscription bound to that name has
 * a delivery. The name is the identity — it survives source changes, and it is
 * what subscriptions bind to; the hash is only a change detector and an
 * idempotency key.
 *
 * Two writers race on every build step, so `publish` is optimistic rather than
 * last-write-wins: a caller says which source it believes is published
 * (`ifHash`), and a publish whose base has moved under it is refused rather
 * than silently picking a winner.
 */

const TABLE = 'event_handlers';
const USER_TABLE = 'event_user_handlers';
const SUBSCRIPTION_TABLE = 'event_subscriptions';
const APP_TABLE = 'apps';

/**
 * Default and cap for `listEventsWorkersForOwner`, same shape as other list
 * stores.
 */
export const EVENTS_WORKERS_LIST_DEFAULT_LIMIT = 50;
export const EVENTS_WORKERS_LIST_LIMIT_CAP = 200;

/** Default page of `listUserScopes`, and of one GC read. */
const USER_SCOPES_PAGE_DEFAULT = 500;
const USER_SCOPES_PAGE_CAP = 1000;
const UNBOUND_HANDLERS_BATCH = 200;

/** Longest a handler name may be, matching the column that holds it. */
export const HANDLER_NAME_MAX_LENGTH = 128;

/** Names are addressable identifiers, not free text. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

/**
 * A server-minted name for an inline handler: `@` and the source hash. `@` is
 * outside {@link NAME_PATTERN}, so a minted name never collides with a chosen
 * one, and only a user scope accepts it.
 */
const INLINE_NAME_PATTERN = /^@[0-9a-f]{64}$/;

/**
 * Longest a delivery may address an app's handler set from cache. Every write
 * here drops the entry on every node, so this only bounds a read that raced a
 * publish or removal and cached the set from before it.
 */
export const HANDLER_SET_CACHE_TTL_SECONDS = 30;

// -- Scopes -----------------------------------------------------------

/**
 * Whose handlers a call is about: an app's own set (`holder` 0), or the
 * handlers one user published into their scope of that app. The two live in
 * separate tables, so code that predates user scopes never reads one.
 */
export interface HandlerScope {
    appUid: string;
    /** `users.id` of the scope's holder, or 0 for the app's own set. */
    holder: number;
}

/** The app's own scope. */
export const appHandlerScope = (appUid: string): HandlerScope => ({
    appUid,
    holder: 0,
});

const isUserScope = (scope: HandlerScope): boolean => scope.holder !== 0;

const assertScope = (scope: HandlerScope): void => {
    if (!Number.isInteger(scope.holder) || scope.holder < 0)
        throw new TypeError('handler scope holder must be a user id or 0');
};

const tableOf = (scope: HandlerScope): string =>
    isUserScope(scope) ? USER_TABLE : TABLE;

const handlerCapOf = (scope: HandlerScope): number =>
    isUserScope(scope)
        ? EVENTS_USER_HANDLERS_PER_SCOPE
        : EVENTS_HANDLERS_PER_APP;

/** The WHERE clause for a scope's rows and its parameters. */
const scopeFilter = (
    scope: HandlerScope,
): { where: string; params: unknown[] } => {
    assertScope(scope);
    return isUserScope(scope)
        ? {
              where: '`app_uid` = ? AND `holder_user_id` = ?',
              params: [scope.appUid, scope.holder],
          }
        : { where: '`app_uid` = ?', params: [scope.appUid] };
};

// App scope keeps the key it always had, so nodes on either side of a rolling
// deploy share it.
const handlerSetCacheKey = (scope: HandlerScope): string =>
    isUserScope(scope)
        ? `eventHandlers:uset:${scope.appUid}:${scope.holder}`
        : `eventHandlers:set:${scope.appUid}`;

/**
 * The same set as read from the replica, kept apart so a lagging read can never
 * stand in for the primary's answer on the delivery path.
 */
const replicaSetCacheKey = (scope: HandlerScope): string =>
    `${handlerSetCacheKey(scope)}:r`;

// -- Shapes -----------------------------------------------------------

/** A row in `event_handlers`, as the rest of the system sees it. */
export interface EventHandler {
    appUid: string;
    name: string;
    source: string;
    sourceHash: string;
    createdAt: number;
    updatedAt: number;
}

/** One handler as `list` reports it. Never carries source. */
export interface EventHandlerSummary {
    name: string;
    hash: string;
    updatedAt: number;
    /** Subscriptions currently bound to this name, suspended ones included. */
    subscriptions: number;
}

/**
 * One app with published handlers, as an owner's events-worker listing reports
 * it.
 */
export interface EventsWorkerSummary {
    appUid: string;
    appName: string;
    appTitle: string;
    handlerCount: number;
    /**
     * Earliest handler `created_at` — when this app's events worker first came
     * into being.
     */
    createdAt: number;
    /** Latest handler `updated_at` across the app's handlers. */
    updatedAt: number;
}

export interface ListEventsWorkersOptions {
    limit?: number;
    cursor?: string;
    /** Narrows to one app's own worker, for an app-scoped listing. */
    appUid?: string;
}

/** One user scope: the handlers a user keeps in one app. */
export interface UserScopeSummary {
    appUid: string;
    /** Empty when the app row is gone. */
    appName: string;
    appTitle: string;
    handlerCount: number;
    /** Earliest handler `created_at` in the scope. */
    createdAt: number;
    /** Latest handler `updated_at` in the scope. */
    updatedAt: number;
}

/** A user scope as an app-wide listing reports it. */
export interface AppUserScope {
    holder: number;
    handlerCount: number;
    createdAt: number;
    updatedAt: number;
}

/** One user-scope handler a GC pass may delete. */
export interface UnboundUserHandler {
    id: number;
    appUid: string;
    holder: number;
    name: string;
}

/**
 * One entry of a scope's handler set. `updatedAt` (unix seconds) is set for a
 * user scope and absent from entries cached without it, meaning unknown.
 */
export type HandlerSetEntry = Pick<EventHandler, 'name' | 'sourceHash'> & {
    updatedAt?: number;
};

export interface PublishHandlerInput {
    scope: HandlerScope;
    name: string;
    source: string;
    /**
     * The hash the caller believes is published. Absent means "create, or
     * accept that it is already exactly this" — anything else is a conflict.
     */
    ifHash?: string | null;
    /** Take the name whatever is published under it. */
    replace?: boolean;
    /**
     * A create leaves peer nodes' cached sets alone: one missing the new name
     * is re-read when asked for it. Updates always broadcast.
     */
    broadcast?: boolean;
}

/** What one publish did, which is what the caller reports back. */
export type PublishOutcome = 'created' | 'updated' | 'unchanged';

export interface PublishResult {
    handler: EventHandler;
    outcome: PublishOutcome;
}

// -- Errors -----------------------------------------------------------

const invalidName = (): HttpError =>
    new HttpError(
        400,
        'A handler name must start alphanumeric and may contain letters, ' +
            `digits, and \`_ . : -\`, up to ${HANDLER_NAME_MAX_LENGTH} characters`,
        { legacyCode: 'events_handler_name_invalid' },
    );

const sourceTooLarge = (): HttpError =>
    new HttpError(
        413,
        `A handler may not exceed ${EVENTS_HANDLER_SOURCE_MAX_BYTES} bytes`,
        { legacyCode: 'events_handler_too_large' },
    );

const invalidSource = (): HttpError =>
    new HttpError(400, 'A handler must be a non-empty source string', {
        legacyCode: 'events_handler_source_invalid',
    });

const tooManyHandlers = (scope: HandlerScope): HttpError =>
    new HttpError(
        429,
        isUserScope(scope)
            ? `A user scope may hold ${EVENTS_USER_HANDLERS_PER_SCOPE} handlers`
            : `An app may publish ${EVENTS_HANDLERS_PER_APP} handlers`,
        { legacyCode: 'events_handler_limit' },
    );

/**
 * Two build steps racing. Refused rather than resolved: whichever won would be
 * running the other's users' subscriptions, and neither asked for that.
 */
const publishConflict = (name: string): HttpError =>
    new HttpError(
        409,
        `\`${name}\` has different source published; pass \`replace\` to take it`,
        { legacyCode: 'events_handler_conflict' },
    );

// -- Row mapping ------------------------------------------------------

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const toRow = (row: Record<string, unknown>): EventHandler => ({
    appUid: String(row.app_uid),
    name: String(row.name),
    source: String(row.source),
    sourceHash: String(row.source_hash),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
});

const SELECT_COLUMNS =
    '`app_uid`, `name`, `source`, `source_hash`, `created_at`, `updated_at`';

/**
 * Content hash of a stored blob. The handler change detector, what an inline
 * subscribe body is checked against, and what a subscription listing reports in
 * place of its context values.
 */
export const hashContent = (content: string): string =>
    createHash('sha256').update(content, 'utf8').digest('hex');

/** `userScope` also admits the `@<sha256>` names minted for inline handlers. */
export const isValidHandlerName = (name: string, userScope = false): boolean =>
    name.length > 0 &&
    name.length <= HANDLER_NAME_MAX_LENGTH &&
    (NAME_PATTERN.test(name) || (userScope && INLINE_NAME_PATTERN.test(name)));

export class EventHandlerStore extends PuterStore {
    // -- Writes ------------------------------------------------------

    /**
     * Create or update one handler.
     *
     * Reads the primary: a publish decided against a lagging replica would
     * either resurrect source the previous call replaced, or report a conflict
     * with a row that no longer exists.
     */
    async publish(input: PublishHandlerInput): Promise<PublishResult> {
        const { scope } = input;
        const name = this.#assertName(input.name, scope);
        const source = this.#assertSource(input.source);
        const sourceHash = hashContent(source);

        const existing = await this.getByName(scope, name);
        if (!existing) {
            // `ifHash` naming a source that is not there is the same race from
            // the other side: something removed the row this publish was
            // updating, and re-creating it silently would undo that.
            if (input.ifHash && !input.replace) throw publishConflict(name);
            return {
                handler: await this.#insert(
                    scope,
                    name,
                    source,
                    sourceHash,
                    input.broadcast !== false,
                ),
                outcome: 'created',
            };
        }

        // Idempotent whatever the caller believed: the published source is
        // already the one being asked for.
        if (existing.sourceHash === sourceHash)
            return { handler: existing, outcome: 'unchanged' };

        const basedOnPublished =
            input.ifHash !== undefined &&
            input.ifHash !== null &&
            input.ifHash === existing.sourceHash;
        if (!input.replace && !basedOnPublished) throw publishConflict(name);

        return {
            handler: await this.#update(scope, existing, source, sourceHash),
            outcome: 'updated',
        };
    }

    /** Drop one handler. Null when the scope had nothing published by that name. */
    async remove(
        scope: HandlerScope,
        name: string,
    ): Promise<EventHandler | null> {
        const existing = await this.getByName(scope, name);
        if (!existing) return null;
        const { where, params } = scopeFilter(scope);
        await this.clients.db.write(
            `DELETE FROM \`${tableOf(scope)}\` WHERE ${where} AND \`name\` = ?`,
            [...params, name],
        );
        await this.#forgetSet(scope);
        return existing;
    }

    /**
     * Drop every handler an app has published, in its own set and in every
     * user's scope — what a deleted app leaves behind. Returns the rows
     * removed. User scopes go a batch of holders at a time, each batch's cached
     * sets dropped here and on every peer.
     */
    async deleteForApp(appUid: string): Promise<number> {
        const result = await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`app_uid\` = ?`,
            [appUid],
        );
        let removed = result.affectedRows ?? 0;
        for (;;) {
            const holders = (
                await this.clients.db.pread(
                    `SELECT DISTINCT \`holder_user_id\` FROM \`${USER_TABLE}\` ` +
                        'WHERE `app_uid` = ? ORDER BY `holder_user_id` LIMIT ?',
                    [appUid, USER_SCOPES_PAGE_DEFAULT],
                )
            ).map((row) => Number(row.holder_user_id));
            if (holders.length === 0) break;
            const batch = await this.clients.db.write(
                `DELETE FROM \`${USER_TABLE}\` WHERE \`app_uid\` = ? ` +
                    `AND \`holder_user_id\` IN (${holders.map(() => '?').join(', ')})`,
                [appUid, ...holders],
            );
            await this.#forgetSets(
                holders.map((holder) => ({ appUid, holder })),
            );
            const affected = batch.affectedRows ?? 0;
            removed += affected;
            if (affected === 0) break;
        }
        await this.#forgetSet(appHandlerScope(appUid));
        return removed;
    }

    /** Drop one user's scope of one app. Returns the handlers removed. */
    async deleteUserScope(appUid: string, holder: number): Promise<number> {
        const scope = { appUid, holder };
        if (!isUserScope(scope)) return 0;
        assertScope(scope);
        const result = await this.clients.db.write(
            `DELETE FROM \`${USER_TABLE}\` WHERE \`app_uid\` = ? AND \`holder_user_id\` = ?`,
            [appUid, holder],
        );
        await this.#forgetSet(scope);
        return result.affectedRows ?? 0;
    }

    /**
     * Drop every scope a user holds, across apps — what an account deletion
     * leaves behind. Returns the handlers removed.
     */
    async deleteUserScopesForHolder(userId: number): Promise<number> {
        if (!Number.isInteger(userId) || userId <= 0) return 0;
        const apps = await this.clients.db.pread(
            `SELECT DISTINCT \`app_uid\` FROM \`${USER_TABLE}\` WHERE \`holder_user_id\` = ?`,
            [userId],
        );
        const result = await this.clients.db.write(
            `DELETE FROM \`${USER_TABLE}\` WHERE \`holder_user_id\` = ?`,
            [userId],
        );
        for (const row of apps)
            await this.#forgetSet({
                appUid: String(row.app_uid),
                holder: userId,
            });
        return result.affectedRows ?? 0;
    }

    /**
     * Delete one user-scope handler if no subscription row of any state is
     * bound to it and it was last touched before `olderThan` (unix seconds).
     * The check and the delete are one statement, so a row bound in between
     * keeps the handler. True when it deleted.
     */
    async deleteUserHandlerIfUnbound(
        scope: HandlerScope,
        name: string,
        olderThan: number,
    ): Promise<boolean> {
        if (!isUserScope(scope)) return false;
        assertScope(scope);
        const result = await this.clients.db.write(
            `DELETE FROM \`${USER_TABLE}\` WHERE \`app_uid\` = ? AND \`holder_user_id\` = ? ` +
                'AND `name` = ? AND `updated_at` < ? ' +
                `AND NOT EXISTS (SELECT 1 FROM \`${SUBSCRIPTION_TABLE}\` ` +
                'WHERE `holder_user_id` = ? AND `app_uid` = ? ' +
                'AND `handler_scope` = 1 AND `handler_name` = ?)',
            [
                scope.appUid,
                scope.holder,
                name,
                olderThan,
                scope.holder,
                scope.appUid,
                name,
            ],
        );
        if (!result.anyRowsAffected) return false;
        await this.#forgetSet(scope);
        return true;
    }

    /**
     * Mark one user-scope handler as just used, so the unbound sweep (which
     * only takes rows last touched before its cutoff) leaves it alone. False
     * when the handler is gone.
     */
    async touchUserHandler(
        scope: HandlerScope,
        name: string,
    ): Promise<boolean> {
        if (!isUserScope(scope)) return false;
        assertScope(scope);
        const result = await this.clients.db.write(
            `UPDATE \`${USER_TABLE}\` SET \`updated_at\` = ? ` +
                'WHERE `app_uid` = ? AND `holder_user_id` = ? AND `name` = ?',
            [nowSeconds(), scope.appUid, scope.holder, name],
        );
        return Boolean(result.anyRowsAffected);
    }

    /** Drop this region's cached sets of a scope, without telling peers. */
    async forgetScopeCache(scope: HandlerScope): Promise<void> {
        await this.#forgetSet(scope, false);
    }

    // -- Reads -------------------------------------------------------

    /**
     * One handler by name. Primary: this answers both the binding check a
     * subscribe runs and the base a publish is compared against, and a replica
     * behind by a moment would report a handler that was just published as
     * absent.
     */
    async getByName(
        scope: HandlerScope,
        name: string,
    ): Promise<EventHandler | null> {
        const { where, params } = scopeFilter(scope);
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${tableOf(scope)}\` ` +
                `WHERE ${where} AND \`name\` = ?`,
            [...params, name],
        );
        return rows.length > 0 ? toRow(rows[0]) : null;
    }

    /**
     * What a scope has published, with how many subscriptions each name is
     * carrying. Bounded by the scope's cap, so the whole set is one page.
     *
     * The counts come from one grouped read rather than a join, because the
     * subscription side has to count names a scope never published — a handler
     * removed while subscriptions still pointed at it leaves exactly that.
     */
    async listForApp(scope: HandlerScope): Promise<EventHandlerSummary[]> {
        const { where, params } = scopeFilter(scope);
        const rows = await this.clients.db.read(
            'SELECT `name`, `source_hash`, `updated_at` ' +
                `FROM \`${tableOf(scope)}\` WHERE ${where} ` +
                'ORDER BY `name` LIMIT ?',
            [...params, handlerCapOf(scope)],
        );

        const counts = await this.countSubscriptionsByHandler(scope);
        return rows.map((row) => ({
            name: String(row.name),
            hash: String(row.source_hash),
            updatedAt: Number(row.updated_at) || 0,
            subscriptions: counts.get(String(row.name)) ?? 0,
        }));
    }

    /**
     * Name and source hash for every handler a scope has published: the
     * identity of its set, without reading a byte of source. What a deploy
     * checks the script it was asked for against, and what the delivery path's
     * cache is filled from. Primary, so neither reads a set a replica has not
     * caught up to.
     */
    async setForApp(
        scope: HandlerScope,
        options: { replica?: boolean } = {},
    ): Promise<HandlerSetEntry[]> {
        const { where, params: whereParams } = scopeFilter(scope);
        const withAge = isUserScope(scope);
        const sql =
            `SELECT \`name\`, \`source_hash\`${withAge ? ', `updated_at`' : ''} ` +
            `FROM \`${tableOf(scope)}\` WHERE ${where} ` +
            'ORDER BY `name` LIMIT ?';
        const params = [...whereParams, handlerCapOf(scope)];
        const rows = options.replica
            ? await this.clients.db.read(sql, params)
            : await this.clients.db.pread(sql, params);
        return rows.map((row) => ({
            name: String(row.name),
            sourceHash: String(row.source_hash),
            ...(withAge ? { updatedAt: Number(row.updated_at) || 0 } : {}),
        }));
    }

    /**
     * `setForApp` for the delivery path, which asks once per invocation. Cached
     * for up to {@link HANDLER_SET_CACHE_TTL_SECONDS}, and dropped everywhere by
     * every write here. An empty set is not cached: it fails the delivery, and
     * must not outlast the publish that fills it. Schedule runs read a miss
     * from the replica (`missRead: 'replica'`), since they come by the clock
     * rather than after a write, and cache it under a key of their own; an
     * empty replica read is checked on the primary, since a lagging replica
     * right after a publish would fail the run. Called by extensions.
     */
    async cachedSetForApp(
        scope: HandlerScope,
        options: {
            missRead?: 'primary' | 'replica';
            handlerName?: string;
        } = {},
    ): Promise<HandlerSetEntry[]> {
        const replica = options.missRead === 'replica';
        // A set without the handler may be from before its publish.
        const usable = (set: Pick<EventHandler, 'name'>[]) =>
            set.length > 0 &&
            (options.handlerName === undefined ||
                set.some((handler) => handler.name === options.handlerName));
        const key = replica
            ? replicaSetCacheKey(scope)
            : handlerSetCacheKey(scope);
        try {
            const cached = JSON.parse(
                (await this.clients.redis.get(key)) ?? 'null',
            ) as unknown;
            if (
                Array.isArray(cached) &&
                usable(cached as Pick<EventHandler, 'name'>[])
            )
                return cached as HandlerSetEntry[];
        } catch {
            // Read the table instead.
        }

        let set = await this.setForApp(scope, { replica });
        if (replica && !usable(set)) set = await this.setForApp(scope);
        if (set.length > 0) {
            try {
                await this.clients.redis.set(
                    key,
                    JSON.stringify(set),
                    'EX',
                    HANDLER_SET_CACHE_TTL_SECONDS,
                );
            } catch {
                // The next delivery reads the table again.
            }
        }
        return set;
    }

    /**
     * Every handler the scope has published, sources included — what the events
     * worker is generated from. Primary, for the same reason `getByName` is:
     * the bake follows the publish that triggered it.
     */
    async allForApp(scope: HandlerScope): Promise<EventHandler[]> {
        const { where, params } = scopeFilter(scope);
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${tableOf(scope)}\` ` +
                `WHERE ${where} ORDER BY \`name\` LIMIT ?`,
            [...params, handlerCapOf(scope)],
        );
        return rows.map(toRow);
    }

    async countForApp(scope: HandlerScope): Promise<number> {
        const { where, params } = scopeFilter(scope);
        const [row] = await this.clients.db.pread(
            `SELECT COUNT(*) AS \`total\` FROM \`${tableOf(scope)}\` WHERE ${where}`,
            params,
        );
        return Number(row?.total ?? 0);
    }

    /**
     * Bytes of source a scope has published, across every handler. What a
     * publish is checked against before it lands, so the generated events
     * worker never grows past what the runtime may load.
     *
     * `OCTET_LENGTH`, not `LENGTH`: only MySQL measures the latter in bytes,
     * and the caller compares this against `Buffer.byteLength`.
     */
    async totalSourceBytesForApp(scope: HandlerScope): Promise<number> {
        const { where, params } = scopeFilter(scope);
        const [row] = await this.clients.db.pread(
            `SELECT SUM(OCTET_LENGTH(\`source\`)) AS \`total\` FROM \`${tableOf(scope)}\` WHERE ${where}`,
            params,
        );
        return Number(row?.total ?? 0);
    }

    /**
     * How many subscriptions each of a scope's handler names is carrying,
     * suspended rows included — a suspended subscription is still a dependent,
     * and it is the reason a removal is not a delete.
     *
     * A user scope reads by holder, so it never scans the other holders of a
     * popular app.
     */
    async countSubscriptionsByHandler(
        scope: HandlerScope,
    ): Promise<Map<string, number>> {
        assertScope(scope);
        const filter = isUserScope(scope)
            ? '`holder_user_id` = ? AND `app_uid` = ? AND `handler_scope` = 1'
            : '`app_uid` = ? AND `handler_scope` = 0';
        const params = isUserScope(scope)
            ? [scope.holder, scope.appUid]
            : [scope.appUid];
        const rows = await this.clients.db.read(
            'SELECT `handler_name`, COUNT(*) AS `total` ' +
                `FROM \`${SUBSCRIPTION_TABLE}\` ` +
                `WHERE ${filter} AND \`handler_name\` IS NOT NULL ` +
                'GROUP BY `handler_name`',
            params,
        );
        return new Map(
            rows.map((row) => [
                String(row.handler_name),
                Number(row.total) || 0,
            ]),
        );
    }

    /**
     * How many of an owner's apps have at least one published handler — what a
     * rent listener counts to tell a first publish (0→1) from a redeploy, and a
     * last removal (1→0) from one of several. Reads the apps' own sets only:
     * user scopes are never the owner's.
     *
     * `createdBefore` (epoch ms) restricts to apps whose events worker existed
     * before that time, by its earliest handler; used to bill only what was
     * already standing at a charge boundary.
     */
    async countAppsWithHandlersForOwner(
        ownerUserId: number,
        opts: { createdBefore?: number } = {},
    ): Promise<number> {
        const params: unknown[] = [ownerUserId];
        let having = '';
        if (opts.createdBefore !== undefined) {
            having = ` HAVING MIN(\`${TABLE}\`.\`created_at\`) < ?`;
            // Column is unix seconds, the option is epoch ms. Rounding up is
            // what makes "strictly before" exact: second `s` starts at
            // `s * 1000`, so `s < ceil(ms / 1000)` is `s * 1000 < ms`.
            params.push(Math.ceil(opts.createdBefore / 1000));
        }

        const rows = await this.clients.db.pread(
            'SELECT COUNT(*) AS `total` FROM (' +
                `SELECT \`${TABLE}\`.\`app_uid\` FROM \`${TABLE}\` ` +
                `JOIN \`${APP_TABLE}\` ON \`${APP_TABLE}\`.\`uid\` = \`${TABLE}\`.\`app_uid\` ` +
                `WHERE \`${APP_TABLE}\`.\`owner_user_id\` = ? ` +
                `GROUP BY \`${TABLE}\`.\`app_uid\`${having}` +
                ') AS `counted`',
            params,
        );
        return Number(rows[0]?.total ?? 0);
    }

    /**
     * How many apps a user holds a scope in — the rent count for user scopes,
     * with `createdBefore` (epoch ms) meaning what it does for
     * {@link countAppsWithHandlersForOwner}.
     */
    async countUserScopesWithHandlersForUser(
        userId: number,
        opts: { createdBefore?: number } = {},
    ): Promise<number> {
        const params: unknown[] = [userId];
        let having = '';
        if (opts.createdBefore !== undefined) {
            having = ' HAVING MIN(`scope_since`) < ?';
            params.push(Math.ceil(opts.createdBefore / 1000));
        }
        const rows = await this.clients.db.pread(
            'SELECT COUNT(*) AS `total` FROM (' +
                `SELECT \`app_uid\` FROM \`${USER_TABLE}\` ` +
                `WHERE \`holder_user_id\` = ? GROUP BY \`app_uid\`${having}` +
                ') AS `counted`',
            params,
        );
        return Number(rows[0]?.total ?? 0);
    }

    /**
     * The events workers an owner is running, one row per app with at least one
     * published handler. Keyset-paginated on `app_uid`, since the grouping key
     * is the only stable order a set this shape can offer. Reads the apps' own
     * sets only.
     */
    async listEventsWorkersForOwner(
        ownerUserId: number,
        opts: ListEventsWorkersOptions = {},
    ): Promise<PageResult<EventsWorkerSummary>> {
        const limit = Math.min(
            Math.max(
                1,
                Math.floor(opts.limit ?? EVENTS_WORKERS_LIST_DEFAULT_LIMIT),
            ),
            EVENTS_WORKERS_LIST_LIMIT_CAP,
        );
        const after = decodeCursor(opts.cursor)?.appUid;

        const where = [`\`${APP_TABLE}\`.\`owner_user_id\` = ?`];
        const params: unknown[] = [ownerUserId];
        if (typeof opts.appUid === 'string') {
            where.push(`\`${TABLE}\`.\`app_uid\` = ?`);
            params.push(opts.appUid);
        }
        if (typeof after === 'string') {
            where.push(`\`${TABLE}\`.\`app_uid\` > ?`);
            params.push(after);
        }

        const rows = await this.clients.db.read(
            `SELECT \`${TABLE}\`.\`app_uid\` AS \`app_uid\`, ` +
                `\`${APP_TABLE}\`.\`name\` AS \`app_name\`, ` +
                `\`${APP_TABLE}\`.\`title\` AS \`app_title\`, ` +
                'COUNT(*) AS `handler_count`, ' +
                `MIN(\`${TABLE}\`.\`created_at\`) AS \`created_at\`, ` +
                `MAX(\`${TABLE}\`.\`updated_at\`) AS \`updated_at\` ` +
                `FROM \`${TABLE}\` ` +
                `JOIN \`${APP_TABLE}\` ON \`${APP_TABLE}\`.\`uid\` = \`${TABLE}\`.\`app_uid\` ` +
                `WHERE ${where.join(' AND ')} ` +
                `GROUP BY \`${TABLE}\`.\`app_uid\`, \`${APP_TABLE}\`.\`name\`, \`${APP_TABLE}\`.\`title\` ` +
                `ORDER BY \`${TABLE}\`.\`app_uid\` LIMIT ?`,
            [...params, limit + 1],
        );

        // An app uid rather than a sequence position, so it needn't be sealed.
        const page = keysetPage(rows, limit, undefined, (last) => ({
            appUid: last.app_uid,
        }));
        const result: PageResult<EventsWorkerSummary> = {
            items: page.rows.map((row) => ({
                appUid: String(row.app_uid),
                appName: String(row.app_name),
                appTitle: String(row.app_title),
                handlerCount: Number(row.handler_count) || 0,
                createdAt: Number(row.created_at) || 0,
                updatedAt: Number(row.updated_at) || 0,
            })),
        };
        if (page.cursor) result.cursor = page.cursor;
        return result;
    }

    /**
     * The scopes one user holds, one row per app, keyset-paginated on
     * `app_uid`. `total` counts every scope the user holds (or the one app's,
     * when `appUid` narrows it).
     */
    async listUserScopesForUser(
        userId: number,
        opts: ListEventsWorkersOptions = {},
    ): Promise<PageResult<UserScopeSummary>> {
        const limit = Math.min(
            Math.max(
                1,
                Math.floor(opts.limit ?? EVENTS_WORKERS_LIST_DEFAULT_LIMIT),
            ),
            EVENTS_WORKERS_LIST_LIMIT_CAP,
        );
        const after = decodeCursor(opts.cursor)?.appUid;

        const where = [`\`${USER_TABLE}\`.\`holder_user_id\` = ?`];
        const params: unknown[] = [userId];
        if (typeof opts.appUid === 'string') {
            where.push(`\`${USER_TABLE}\`.\`app_uid\` = ?`);
            params.push(opts.appUid);
        }
        const totalRows = await this.clients.db.read(
            'SELECT COUNT(*) AS `total` FROM (' +
                `SELECT \`${USER_TABLE}\`.\`app_uid\` FROM \`${USER_TABLE}\` ` +
                `WHERE ${where.join(' AND ')} GROUP BY \`${USER_TABLE}\`.\`app_uid\`` +
                ') AS `counted`',
            params,
        );
        if (typeof after === 'string') {
            where.push(`\`${USER_TABLE}\`.\`app_uid\` > ?`);
            params.push(after);
        }

        const rows = await this.clients.db.read(
            `SELECT \`${USER_TABLE}\`.\`app_uid\` AS \`app_uid\`, ` +
                `\`${APP_TABLE}\`.\`name\` AS \`app_name\`, ` +
                `\`${APP_TABLE}\`.\`title\` AS \`app_title\`, ` +
                'COUNT(*) AS `handler_count`, ' +
                `MIN(\`${USER_TABLE}\`.\`created_at\`) AS \`created_at\`, ` +
                `MAX(\`${USER_TABLE}\`.\`updated_at\`) AS \`updated_at\` ` +
                `FROM \`${USER_TABLE}\` ` +
                `LEFT JOIN \`${APP_TABLE}\` ON \`${APP_TABLE}\`.\`uid\` = \`${USER_TABLE}\`.\`app_uid\` ` +
                `WHERE ${where.join(' AND ')} ` +
                `GROUP BY \`${USER_TABLE}\`.\`app_uid\`, \`${APP_TABLE}\`.\`name\`, \`${APP_TABLE}\`.\`title\` ` +
                `ORDER BY \`${USER_TABLE}\`.\`app_uid\` LIMIT ?`,
            [...params, limit + 1],
        );

        const page = keysetPage(rows, limit, undefined, (last) => ({
            appUid: last.app_uid,
        }));
        const result: PageResult<UserScopeSummary> = {
            items: page.rows.map((row) => ({
                appUid: String(row.app_uid),
                appName: row.app_name == null ? '' : String(row.app_name),
                appTitle: row.app_title == null ? '' : String(row.app_title),
                handlerCount: Number(row.handler_count) || 0,
                createdAt: Number(row.created_at) || 0,
                updatedAt: Number(row.updated_at) || 0,
            })),
            total: Number(totalRows[0]?.total ?? 0),
        };
        if (page.cursor) result.cursor = page.cursor;
        return result;
    }

    /**
     * The user scopes one app holds, ordered by holder. A batch scan: it
     * carries no `total`, to spare a COUNT per page. `cursor` is null at the
     * end.
     */
    async listUserScopes(
        appUid: string,
        opts: { limit?: number; cursor?: string } = {},
    ): Promise<{ items: AppUserScope[]; cursor: string | null }> {
        const limit = Math.min(
            Math.max(1, Math.floor(opts.limit ?? USER_SCOPES_PAGE_DEFAULT)),
            USER_SCOPES_PAGE_CAP,
        );
        const after = Number(decodeCursor(opts.cursor)?.holder);
        const rows = await this.clients.db.read(
            'SELECT `holder_user_id`, COUNT(*) AS `handler_count`, ' +
                'MIN(`created_at`) AS `created_at`, ' +
                'MAX(`updated_at`) AS `updated_at` ' +
                `FROM \`${USER_TABLE}\` WHERE \`app_uid\` = ? AND \`holder_user_id\` > ? ` +
                'GROUP BY `holder_user_id` ORDER BY `holder_user_id` LIMIT ?',
            [appUid, Number.isFinite(after) ? after : 0, limit + 1],
        );
        const page = keysetPage(rows, limit, undefined, (last) => ({
            holder: Number(last.holder_user_id),
        }));
        return {
            items: page.rows.map((row) => ({
                holder: Number(row.holder_user_id),
                handlerCount: Number(row.handler_count) || 0,
                createdAt: Number(row.created_at) || 0,
                updatedAt: Number(row.updated_at) || 0,
            })),
            cursor: page.cursor ?? null,
        };
    }

    /**
     * One keyset page of user-scope handlers last touched before `olderThan`
     * (unix seconds) that no subscription row of any state is bound to. A batch
     * scan: it carries no `total`, to spare a COUNT per page. `cursor` is null
     * at the end. A candidate may be bound before it is deleted, so delete
     * through {@link deleteUserHandlerIfUnbound}.
     */
    async listUnboundUserHandlers(
        olderThan: number,
        opts: { limit?: number; cursor?: string } = {},
    ): Promise<{ items: UnboundUserHandler[]; cursor: string | null }> {
        const limit = Math.max(
            1,
            Math.floor(opts.limit ?? UNBOUND_HANDLERS_BATCH),
        );
        const after = Number(decodeCursor(opts.cursor)?.id);
        const rows = await this.clients.db.read(
            'SELECT h.`id`, h.`app_uid`, h.`holder_user_id`, h.`name` ' +
                `FROM \`${USER_TABLE}\` h ` +
                'WHERE h.`id` > ? AND h.`updated_at` < ? ' +
                `AND NOT EXISTS (SELECT 1 FROM \`${SUBSCRIPTION_TABLE}\` s ` +
                'WHERE s.`holder_user_id` = h.`holder_user_id` ' +
                'AND s.`app_uid` = h.`app_uid` AND s.`handler_scope` = 1 ' +
                'AND s.`handler_name` = h.`name`) ' +
                'ORDER BY h.`id` LIMIT ?',
            [Number.isFinite(after) ? after : 0, olderThan, limit + 1],
        );
        const page = keysetPage(rows, limit, undefined);
        return {
            items: page.rows.map((row) => ({
                id: Number(row.id),
                appUid: String(row.app_uid),
                holder: Number(row.holder_user_id),
                name: String(row.name),
            })),
            cursor: page.cursor ?? null,
        };
    }

    // -- Internals ---------------------------------------------------

    async #insert(
        scope: HandlerScope,
        name: string,
        source: string,
        sourceHash: string,
        broadcast: boolean,
    ): Promise<EventHandler> {
        // A user scope's count read also yields when the scope began, so its
        // age survives the handlers that held it.
        let scopeSince: number | null = null;
        if (isUserScope(scope)) {
            const [state] = await this.clients.db.pread(
                'SELECT COUNT(*) AS `total`, MIN(`scope_since`) AS `since` ' +
                    `FROM \`${USER_TABLE}\` WHERE \`app_uid\` = ? AND \`holder_user_id\` = ?`,
                [scope.appUid, scope.holder],
            );
            if (Number(state?.total ?? 0) >= handlerCapOf(scope))
                throw tooManyHandlers(scope);
            scopeSince = state?.since == null ? null : Number(state.since);
        } else if ((await this.countForApp(scope)) >= handlerCapOf(scope))
            throw tooManyHandlers(scope);

        const at = nowSeconds();
        try {
            await this.clients.db.insert(tableOf(scope), {
                app_uid: scope.appUid,
                ...(isUserScope(scope)
                    ? {
                          holder_user_id: scope.holder,
                          scope_since: scopeSince ?? at,
                      }
                    : {}),
                name,
                source,
                source_hash: sourceHash,
                created_at: at,
                updated_at: at,
            });
        } catch (err) {
            // Lost a create-vs-create race: the unique index is what actually
            // arbitrated it, and the loser hits it here rather than at the
            // read above. Same stable code a sequential caller gets — never
            // the raw driver error.
            if (isUniqueViolation(err)) throw publishConflict(name);
            throw err;
        }
        // Concurrent creates can all pass the count above. Counted again with
        // this row in it, each one past the cap takes itself back out — at the
        // last slot that may refuse more than it had to, never fewer. User
        // scopes only: reads stop at the cap, so a row past it would be unseen.
        if (
            isUserScope(scope) &&
            (await this.countForApp(scope)) > handlerCapOf(scope)
        ) {
            const { where, params } = scopeFilter(scope);
            await this.clients.db.write(
                `DELETE FROM \`${tableOf(scope)}\` WHERE ${where} AND \`name\` = ?`,
                [...params, name],
            );
            await this.#forgetSet(scope);
            throw tooManyHandlers(scope);
        }
        await this.#forgetSet(scope, broadcast);
        return {
            appUid: scope.appUid,
            name,
            source,
            sourceHash,
            createdAt: at,
            updatedAt: at,
        };
    }

    async #update(
        scope: HandlerScope,
        existing: EventHandler,
        source: string,
        sourceHash: string,
    ): Promise<EventHandler> {
        const at = nowSeconds();
        const { where, params } = scopeFilter(scope);
        // The `source_hash` predicate is what makes the check-then-write a
        // compare-and-set: a publish that raced past the read above updates
        // nothing here, and its caller is told.
        const updated = await this.clients.db.write(
            `UPDATE \`${tableOf(scope)}\` SET \`source\` = ?, \`source_hash\` = ?, ` +
                `\`updated_at\` = ? WHERE ${where} AND \`name\` = ? ` +
                'AND `source_hash` = ?',
            [
                source,
                sourceHash,
                at,
                ...params,
                existing.name,
                existing.sourceHash,
            ],
        );
        if (updated?.anyRowsAffected === false)
            throw publishConflict(existing.name);

        await this.#forgetSet(scope);
        return { ...existing, source, sourceHash, updatedAt: at };
    }

    /**
     * Drop the delivery path's cached set here, and on every peer if
     * `broadcast`.
     */
    async #forgetSet(scope: HandlerScope, broadcast = true): Promise<void> {
        await this.publishCacheKeys({
            keys: [handlerSetCacheKey(scope), replicaSetCacheKey(scope)],
            broadcast,
        });
    }

    /** {@link #forgetSet} for many scopes, as one peer message. */
    async #forgetSets(scopes: HandlerScope[]): Promise<void> {
        await this.publishCacheKeys({
            keys: scopes.flatMap((scope) => [
                handlerSetCacheKey(scope),
                replicaSetCacheKey(scope),
            ]),
            broadcast: true,
        });
    }

    #assertName(name: unknown, scope: HandlerScope): string {
        if (
            typeof name !== 'string' ||
            !isValidHandlerName(name, isUserScope(scope))
        )
            throw invalidName();
        return name;
    }

    #assertSource(source: unknown): string {
        if (typeof source !== 'string' || source.trim().length === 0)
            throw invalidSource();
        if (Buffer.byteLength(source, 'utf8') > EVENTS_HANDLER_SOURCE_MAX_BYTES)
            throw sourceTooLarge();
        return source;
    }
}
