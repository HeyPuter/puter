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

import { assertResolvedActor } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { resolveNotifFetch } from '../../services/events/notifFetch.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import {
    APP_READABLE_AUDIENCES,
    canViewNotification,
    notificationRowScope,
    ownedAppUids,
} from '../../services/notification/notificationAudience.js';
import {
    NOTIFICATION_VALUE_MAX_BYTES,
    resolveNotificationWrite,
    type NotificationTypeName,
} from '../../services/notification/notificationTypes.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';
import type { DriverConcurrentConfig, DriverRateLimitConfig } from '../meta.js';

const MAX_SELECT_LIMIT = 200;

/** The mailbox slice a call named, in the terms the query takes it. */
interface MailboxScope {
    audiences: readonly string[];
    /** `null` is the rows naming no app; `undefined` is any app. */
    appUid: string | null | undefined;
}

/** Whether a row belongs to the slice, as the same SQL scope selected it. */
const inScope = (
    row: Record<string, unknown>,
    scope: MailboxScope,
): boolean => {
    const { audience, appUid } = notificationRowScope(row);
    if (!scope.audiences.includes(audience)) return false;
    return scope.appUid === undefined || appUid === scope.appUid;
};

/**
 * Driver exposing the `puter-notifications` interface.
 *
 * Wraps NotificationStore with owner-scoped permission checks. Methods follow
 * the `crud-q` shape: create, read, select.
 *
 * Read-only for clients — `update` and `delete` are not exposed. `create` is
 * available for server-internal callers (other services push notifications via
 * `/drivers/call` with a system token or directly through the store). `read`
 * and `select` accept predicates.
 *
 * Permission model:
 *
 * - Strictly owner-limited — each user can only see their own notifications.
 * - The holder reads their whole mailbox; an actor holding an app reads the
 *   `app-user` rows naming that app, plus its `developer` rows when the holder
 *   owns the app. `account` rows never reach an actor holding an app, and no
 *   grant changes that. A slice an actor may not see comes back empty rather
 *   than refused — the mailbox is not an oracle.
 * - `create` stays holder-only.
 *
 * `read` and `select` also take an optional `subject` naming one slice
 * (`notif:<appUid>:<audience>`); the two-segment form expands from the actor's
 * own app, so an app never names an app uid.
 *
 * Predicates:
 *
 * - `'unseen'` — shown IS NULL AND acknowledged IS NULL
 * - `'unacknowledged'` — acknowledged IS NULL (may be shown)
 * - `'acknowledged'` — acknowledged IS NOT NULL
 */
export class NotificationDriver extends PuterDriver {
    readonly driverInterface = 'puter-notifications';
    // Matches origin/main's `iface_to_driver['puter-notifications']` and the
    // hardcoded `service:es\Cnotification:…` permission keys.
    readonly driverName = 'es:notification';
    readonly isDefault = true;

    // Same crud-q envelope as AppDriver / SubdomainDriver — these three
    // shared the pre-v2 `temp.es` / `user.es` policy on permission grants.
    readonly rateLimit: DriverRateLimitConfig = {
        default: {
            limit: 3_000,
            window: 30_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 3_000,
                [DEFAULT_TEMP_SUBSCRIPTION]: 1_000,
            },
        },
    };

    readonly concurrent: DriverConcurrentConfig = {
        default: {
            limit: 20,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 10,
                [DEFAULT_TEMP_SUBSCRIPTION]: 5,
            },
        },
    };

    // -- Driver methods ----------------------------------------------

    async create(args: Record<string, unknown>): Promise<unknown> {
        const object = args.object as Record<string, unknown> | undefined;
        if (!object || typeof object !== 'object') {
            throw new HttpError(400, 'Missing or invalid `object`', {
                legacyCode: 'bad_request',
            });
        }
        const actor = this.#requireUserActor();

        const value = (object.value ?? {}) as Record<string, unknown>;
        const type = value.type;
        if (typeof type !== 'string' || type === '') {
            throw new HttpError(400, 'Missing or invalid `value.type`', {
                legacyCode: 'bad_request',
            });
        }
        if (
            Buffer.byteLength(JSON.stringify(value), 'utf8') >
            NOTIFICATION_VALUE_MAX_BYTES
        ) {
            throw new HttpError(
                400,
                `\`value\` may not exceed ${NOTIFICATION_VALUE_MAX_BYTES} bytes`,
                { legacyCode: 'notification_value_too_large' },
            );
        }

        const appUid = (object.appUid ?? null) as string | null;
        // The registry rejects with a plain Error — unregistered, or a type
        // wrong for the audience it names. Both are caller input, so neither
        // is a server fault.
        let registered;
        try {
            registered = resolveNotificationWrite(type, appUid);
        } catch (err) {
            throw new HttpError(400, (err as Error).message, {
                legacyCode: 'bad_request',
                cause: err,
            });
        }
        // Narrowed by the registry lookup above: `registered` names one of its
        // own entries, so its `type` is one of the names it was resolved from.
        const registeredType = registered.type as NotificationTypeName;

        // Silent: a driver `create` has never pushed to the live socket, only
        // ever written the row — moving through the registry does not change
        // that.
        const uid = await this.services.notification.notify(
            [actor.user.id],
            value,
            { type: registeredType, appUid, silent: true },
        );
        if (!uid) {
            throw new HttpError(500, 'Notification could not be created', {
                legacyCode: 'internal_error',
            });
        }
        return this.#toClient(
            await this.stores.notification.getByUid(uid, {
                userId: actor.user.id,
            }),
        );
    }

    async read(args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireActor();
        const uid = (args.uid ?? args.id) as string | undefined;
        if (!uid)
            throw new HttpError(400, 'Missing `uid`', {
                legacyCode: 'bad_request',
            });

        const scope = this.#resolveScope(actor, args.subject);
        const row = await this.stores.notification.getByUid(String(uid), {
            userId: actor.user.id,
        });
        if (!row || !(await this.#readable(actor, row, scope)))
            throw new HttpError(404, 'Notification not found', {
                legacyCode: 'not_found',
            });
        return this.#toClient(row);
    }

    async select(args: Record<string, unknown>): Promise<unknown[]> {
        const actor = this.#requireActor();
        const limit = Math.min(
            Number(args.limit ?? MAX_SELECT_LIMIT),
            MAX_SELECT_LIMIT,
        );
        const predicate = args.predicate as string | string[] | undefined;

        const predicateName = Array.isArray(predicate)
            ? predicate[0]
            : predicate;

        const scope = this.#resolveScope(actor, args.subject);
        const query: {
            limit: number;
            scope: MailboxScope | null;
            filter?: string;
            onlyUnacknowledged?: boolean;
        } = { limit, scope };

        switch (predicateName) {
            case 'unseen':
                query.filter = 'unseen';
                break;
            case 'unacknowledged':
            case 'unacknowledge': // client compat alias
                query.onlyUnacknowledged = true;
                break;
            case 'acknowledged':
            case 'acknowledge': // client compat alias
                query.filter = 'acknowledged';
                break;
        }

        const rows = await this.stores.notification.listByUserId(
            actor.user.id,
            query,
        );
        const visible =
            scope === null ? rows : await this.#visibleRows(actor, rows);
        return visible.map((r) => this.#toClient(r));
    }

    /**
     * Mark a notification as shown. Part of the driver's mailbox surface: the
     * desktop marks over HTTP, but a client reading through `/drivers/call`
     * needs a way to mark what it read.
     */
    async mark_shown(args: Record<string, unknown>): Promise<unknown> {
        const { actor, uid, markable } = await this.#resolveMark(args);
        const ok =
            markable &&
            (await this.stores.notification.markShown(uid, actor.user.id));
        return { success: !!ok };
    }

    /** Mark a notification as acknowledged (user dismissed it), same surface. */
    async mark_acknowledged(args: Record<string, unknown>): Promise<unknown> {
        const { actor, uid, markable } = await this.#resolveMark(args);
        // Through the service, not the store directly, so other tabs get
        // `notif.ack` the same as a mark through `/notif/mark-ack` does.
        const ok =
            markable &&
            (await this.services.notification.markAcknowledged(
                uid,
                actor.user.id,
            ));
        return { success: !!ok };
    }

    // -- Permissions -------------------------------------------------

    #requireActor(): Actor & {
        user: { id: number; uuid: string; username: string };
    } {
        const actor = Context.get('actor') as Actor | undefined;
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        if (!actor.user?.id)
            throw new HttpError(403, 'User actor required', {
                legacyCode: 'forbidden',
            });
        // Unresolved is not "no app", and reading it that way here is what
        // would hand an app the account-wide mailbox.
        assertResolvedActor(actor);
        return actor as Actor & {
            user: { id: number; uuid: string; username: string };
        };
    }

    /** Writing a notification stays the holder's, per the token table. */
    #requireUserActor(): Actor & {
        user: { id: number; uuid: string; username: string };
    } {
        const actor = this.#requireActor();
        if (actor.effectiveApp)
            throw new HttpError(403, 'App actors cannot create notifications', {
                legacyCode: 'forbidden',
            });
        return actor;
    }

    /**
     * The slice a call named, or `null` for the holder's whole mailbox. An
     * actor holding an app always has a slice — its own — so `null` only ever
     * means the holder asked for everything of theirs.
     */
    #resolveScope(actor: Actor, subject: unknown): MailboxScope | null {
        const appUid = actor.effectiveApp?.uid ?? null;
        if (subject !== undefined && subject !== null && subject !== '') {
            const named = resolveNotifFetch(String(subject), {
                userUuid: String(actor.user.uuid),
                appUid,
            });
            return { audiences: [named.audience], appUid: named.appUid };
        }
        if (appUid === null) return null;
        return { audiences: APP_READABLE_AUDIENCES, appUid };
    }

    /** The audience predicate over a page, with the developer fact resolved. */
    async #visibleRows(
        actor: Actor,
        rows: Array<Record<string, unknown>>,
    ): Promise<Array<Record<string, unknown>>> {
        if (rows.length === 0) return rows;
        const scopes = rows.map(notificationRowScope);
        const owned = await ownedAppUids(
            this.stores.app,
            Number(actor.user.id),
            scopes.flatMap((s) =>
                s.audience === 'developer' && s.appUid ? [s.appUid] : [],
            ),
        );

        return rows.filter((_row, i) =>
            canViewNotification(scopes[i], actor, {
                recipientOwnsApp: owned.has(scopes[i].appUid ?? ''),
            }),
        );
    }

    /**
     * Whether one row may be shown. A `null` scope is the holder asking for
     * their own mailbox with nothing named — all of it is theirs, and the
     * audience rule is about what an app may be shown.
     */
    async #readable(
        actor: Actor,
        row: Record<string, unknown>,
        scope: MailboxScope | null,
    ): Promise<boolean> {
        if (scope === null) return true;
        if (!inScope(row, scope)) return false;
        return (await this.#visibleRows(actor, [row])).length === 1;
    }

    /**
     * A mark is bounded by what the same actor could read: a row it may not be
     * shown reads as absent, which is the answer marking a uid that does not
     * exist already gives.
     */
    async #resolveMark(args: Record<string, unknown>): Promise<{
        actor: Actor & { user: { id: number } };
        uid: string;
        markable: boolean;
    }> {
        const actor = this.#requireActor();
        const uid = String(args.uid ?? '');
        if (!uid)
            throw new HttpError(400, 'Missing `uid`', {
                legacyCode: 'bad_request',
            });
        const row = await this.stores.notification.getByUid(uid, {
            userId: actor.user.id,
        });
        const scope = this.#resolveScope(actor, undefined);
        return {
            actor,
            uid,
            markable: !!row && (await this.#readable(actor, row, scope)),
        };
    }

    // -- Serialization -----------------------------------------------

    #toClient(
        row: Record<string, unknown> | null,
    ): Record<string, unknown> | null {
        if (!row) return null;
        return {
            uid: row.uid,
            value: row.value,
            shown: row.shown ?? null,
            acknowledged: row.acknowledged ?? null,
            created_at: row.created_at ?? null,
        };
    }
}
