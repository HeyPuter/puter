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
} from '../../controllers/events/limits.js';
import { HttpError } from '../../core/http/HttpError.js';
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
const SUBSCRIPTION_TABLE = 'event_subscriptions';

/** Longest a handler name may be, matching the column that holds it. */
export const HANDLER_NAME_MAX_LENGTH = 128;

/** Names are addressable identifiers, not free text. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

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

export interface PublishHandlerInput {
    appUid: string;
    name: string;
    source: string;
    /**
     * The hash the caller believes is published. Absent means "create, or
     * accept that it is already exactly this" — anything else is a conflict.
     */
    ifHash?: string | null;
    /** Take the name whatever is published under it. */
    replace?: boolean;
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

const tooManyHandlers = (): HttpError =>
    new HttpError(
        429,
        `An app may publish ${EVENTS_HANDLERS_PER_APP} handlers`,
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

export const isValidHandlerName = (name: string): boolean =>
    name.length > 0 &&
    name.length <= HANDLER_NAME_MAX_LENGTH &&
    NAME_PATTERN.test(name);

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
        const name = this.#assertName(input.name);
        const source = this.#assertSource(input.source);
        const sourceHash = hashContent(source);

        const existing = await this.getByName(input.appUid, name);
        if (!existing) {
            // `ifHash` naming a source that is not there is the same race from
            // the other side: something removed the row this publish was
            // updating, and re-creating it silently would undo that.
            if (input.ifHash && !input.replace) throw publishConflict(name);
            return {
                handler: await this.#insert(
                    input.appUid,
                    name,
                    source,
                    sourceHash,
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
            handler: await this.#update(existing, source, sourceHash),
            outcome: 'updated',
        };
    }

    /** Drop one handler. Null when the app had nothing published by that name. */
    async remove(appUid: string, name: string): Promise<EventHandler | null> {
        const existing = await this.getByName(appUid, name);
        if (!existing) return null;
        await this.clients.db.write(
            `DELETE FROM \`${TABLE}\` WHERE \`app_uid\` = ? AND \`name\` = ?`,
            [appUid, name],
        );
        return existing;
    }

    // -- Reads -------------------------------------------------------

    /**
     * One handler by name. Primary: this answers both the binding check a
     * subscribe runs and the base a publish is compared against, and a replica
     * behind by a moment would report a handler that was just published as
     * absent.
     */
    async getByName(
        appUid: string,
        name: string,
    ): Promise<EventHandler | null> {
        const rows = await this.clients.db.pread(
            `SELECT ${SELECT_COLUMNS} FROM \`${TABLE}\` ` +
                'WHERE `app_uid` = ? AND `name` = ?',
            [appUid, name],
        );
        return rows.length > 0 ? toRow(rows[0]) : null;
    }

    /**
     * What an app has published, with how many subscriptions each name is
     * carrying. Bounded by the per-app cap, so the whole set is one page.
     *
     * The counts come from one grouped read rather than a join, because the
     * subscription side has to count names an app never published — a handler
     * removed while subscriptions still pointed at it leaves exactly that.
     */
    async listForApp(appUid: string): Promise<EventHandlerSummary[]> {
        const rows = await this.clients.db.read(
            'SELECT `name`, `source_hash`, `updated_at` ' +
                `FROM \`${TABLE}\` WHERE \`app_uid\` = ? ` +
                'ORDER BY `name` LIMIT ?',
            [appUid, EVENTS_HANDLERS_PER_APP],
        );

        const counts = await this.countSubscriptionsByHandler(appUid);
        return rows.map((row) => ({
            name: String(row.name),
            hash: String(row.source_hash),
            updatedAt: Number(row.updated_at) || 0,
            subscriptions: counts.get(String(row.name)) ?? 0,
        }));
    }

    async countForApp(appUid: string): Promise<number> {
        const [row] = await this.clients.db.pread(
            `SELECT COUNT(*) AS \`total\` FROM \`${TABLE}\` WHERE \`app_uid\` = ?`,
            [appUid],
        );
        return Number(row?.total ?? 0);
    }

    /**
     * How many subscriptions each of an app's handler names is carrying,
     * suspended rows included — a suspended subscription is still a dependent,
     * and it is the reason a removal is not a delete.
     */
    async countSubscriptionsByHandler(
        appUid: string,
    ): Promise<Map<string, number>> {
        const rows = await this.clients.db.read(
            'SELECT `handler_name`, COUNT(*) AS `total` ' +
                `FROM \`${SUBSCRIPTION_TABLE}\` ` +
                'WHERE `app_uid` = ? AND `handler_name` IS NOT NULL ' +
                'GROUP BY `handler_name`',
            [appUid],
        );
        return new Map(
            rows.map((row) => [
                String(row.handler_name),
                Number(row.total) || 0,
            ]),
        );
    }

    // -- Internals ---------------------------------------------------

    async #insert(
        appUid: string,
        name: string,
        source: string,
        sourceHash: string,
    ): Promise<EventHandler> {
        if ((await this.countForApp(appUid)) >= EVENTS_HANDLERS_PER_APP)
            throw tooManyHandlers();

        const at = nowSeconds();
        try {
            await this.clients.db.insert(TABLE, {
                app_uid: appUid,
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
        return {
            appUid,
            name,
            source,
            sourceHash,
            createdAt: at,
            updatedAt: at,
        };
    }

    async #update(
        existing: EventHandler,
        source: string,
        sourceHash: string,
    ): Promise<EventHandler> {
        const at = nowSeconds();
        // The `source_hash` predicate is what makes the check-then-write a
        // compare-and-set: a publish that raced past the read above updates
        // nothing here, and its caller is told.
        const updated = await this.clients.db.write(
            `UPDATE \`${TABLE}\` SET \`source\` = ?, \`source_hash\` = ?, ` +
                '`updated_at` = ? WHERE `app_uid` = ? AND `name` = ? ' +
                'AND `source_hash` = ?',
            [
                source,
                sourceHash,
                at,
                existing.appUid,
                existing.name,
                existing.sourceHash,
            ],
        );
        if (updated?.anyRowsAffected === false)
            throw publishConflict(existing.name);

        return { ...existing, source, sourceHash, updatedAt: at };
    }

    #assertName(name: unknown): string {
        if (typeof name !== 'string' || !isValidHandlerName(name))
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
