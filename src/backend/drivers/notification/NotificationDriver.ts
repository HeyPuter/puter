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

import {
    assertResolvedActor,
    requireContextActor,
    type UserActor,
} from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import {
    checkRateLimit,
    peekRateLimit,
} from '../../core/http/middleware/rateLimit.js';
import { resolveNotifFetch } from '../../services/events/notifFetch.js';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '../../services/metering/consts.js';
import {
    APP_MESSAGE_RATE_LIMITS,
    APP_MESSAGE_TYPE,
    appMessageSender,
    parseAppMessage,
    type AppMessage,
} from '../../services/notification/appMessage.js';
import {
    APP_READABLE_AUDIENCES,
    canViewNotification,
    notificationRowScope,
    ownedAppUids,
} from '../../services/notification/notificationAudience.js';
import {
    assertNotificationValueFits,
    OUTSIDE_ACCOUNT_MAILBOX_TYPES,
    resolveNotificationWrite,
    type NotificationTypeName,
} from '../../services/notification/notificationTypes.js';
import {
    schedulesUnavailable,
    type DeferredAppMessage,
    type DeferredSendPlan,
    type ScheduleServiceContract,
    type SqlGuard,
} from '../../core/schedules.js';
import type { BatchEntry } from '../../clients/database/DatabaseClient.js';
import { withRedisLock } from '../../util/redisLock.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';
import type { DriverRateLimitConfig } from '../meta.js';
import { CRUD_CONCURRENT } from '../util/crudLimits.js';
import type { NotificationRow } from '../../services/notification/NotificationService.js';

const MAX_SELECT_LIMIT = 200;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// A group's sends queue for up to ~1 s; a stalled holder blocks them for the TTL.
const GROUP_LOCK_MS = 5_000;
const GROUP_LOCK_ATTEMPTS = 40;
const GROUP_LOCK_RETRY_MS = 25;

type AppMessageWindow = 'minute' | 'day';

export type { SqlGuard };

/** What a delayed app message's fire-time write needs from its row. */
export interface DeferredWriteInput {
    holderUserId: number;
    appUid: string;
    /** The stored {@link DeferredAppMessage}, as JSON text. */
    payload: string | null;
    /** The slot's key: the written row's uid or `send_key`, and its `sendId`. */
    sendKey: string;
    /** Aborted when the caller's claim is lost. */
    signal: AbortSignal;
}

/**
 * The caller's transaction the mailbox write commits in. Atomicity is the
 * caller's to keep; the type can't enforce it.
 */
export interface DeferredWriteTx {
    /**
     * What every mailbox statement is fenced on: the caller's row marked
     * delivered by this claim.
     */
    guard: SqlGuard;
    /**
     * Must be the whole delivery in one step: the caller's guarded transition
     * of its row to delivered and `entries`, in that order, in one
     * `batchWrite`, then a read of the row on the primary. True only when that
     * read shows this claim holding the row as delivered. Splitting the
     * transition from `entries` lets one slot write two rows.
     */
    commit(entries: readonly BatchEntry[]): Promise<boolean>;
}

/** How a delayed send's write stood when it stopped. */
export type DeferredWriteOutcome =
    'delivered' | 'dropped' | 'lost' | 'senderSuspended';

/** The mailbox slice a call named, in the terms the query takes it. */
interface MailboxScope {
    audiences: readonly string[];
    /** `null` is the rows naming no app; `undefined` is any app. */
    appUid: string | null | undefined;
}

const typeNotAllowed = (message: string): HttpError =>
    new HttpError(403, message, {
        legacyCode: 'forbidden',
        code: 'notification_type_not_allowed',
    });

const tooManyAppMessages = (): HttpError =>
    new HttpError(429, 'Too many notifications from this app.', {
        legacyCode: 'too_many_requests',
    });

/** One refusal for either limit a notification through a share can hit. */
const tooManySharedNotifications = (): HttpError =>
    new HttpError(429, 'Too many notifications.', {
        legacyCode: 'too_many_requests',
    });

/** The handle in `to`, which must be `{ handle }` and nothing else. */
const parseNotifyTarget = (to: unknown): string => {
    const target = to as Record<string, unknown> | null;
    if (
        !target ||
        typeof target !== 'object' ||
        Array.isArray(target) ||
        Object.keys(target).length !== 1 ||
        typeof target.handle !== 'string' ||
        target.handle === ''
    ) {
        throw new HttpError(
            400,
            '`to` must be an object with only a string `handle`',
            { legacyCode: 'bad_request', fields: { field: 'to' } },
        );
    }
    return target.handle;
};

/** A stored delayed message, or `null` for one that can't be read back. */
const parseDelayedAppMessage = (
    payload: string | null,
): DeferredAppMessage | null => {
    try {
        const stored = JSON.parse(payload ?? 'null') as DeferredAppMessage;
        if (typeof stored?.message?.title !== 'string') return null;
        if (stored.to !== undefined && typeof stored.to !== 'string')
            return null;
        return stored;
    } catch {
        return null;
    }
};

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
 * - The holder creates any registered type but `app.message`, silently. An actor
 *   holding an app creates `app.message` only, for its own user or, through a
 *   KV share handle, for the share's other party, and it is delivered live.
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

    readonly concurrent = CRUD_CONCURRENT;

    // -- Driver methods ----------------------------------------------

    async create(args: Record<string, unknown>): Promise<unknown> {
        const object = args.object as Record<string, unknown> | undefined;
        if (!object || typeof object !== 'object') {
            throw new HttpError(400, 'Missing or invalid `object`', {
                legacyCode: 'bad_request',
            });
        }
        const actor = this.#requireActor();

        const value = (object.value ?? {}) as Record<string, unknown>;
        const type = value.type;
        if (typeof type !== 'string' || type === '') {
            throw new HttpError(400, 'Missing or invalid `value.type`', {
                legacyCode: 'bad_request',
            });
        }
        // Its own field checks come first, so an app hears which field is wrong.
        if (actor.effectiveApp) {
            return this.#createAppMessage(
                actor,
                actor.effectiveApp.uid,
                object,
                value,
            );
        }
        assertNotificationValueFits(value);
        if (type === APP_MESSAGE_TYPE) {
            throw typeNotAllowed(`Only apps can create ${APP_MESSAGE_TYPE}`);
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
        const row = await this.#write(actor.user.id, value, {
            type: registeredType,
            appUid,
            silent: true,
        });
        return this.#toClient(row);
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
        const uids = args.uids;
        if (
            uids !== undefined &&
            (!Array.isArray(uids) ||
                uids.length > 50 ||
                uids.some(
                    (uid) =>
                        typeof uid !== 'string' ||
                        uid.length === 0 ||
                        uid.length > 128,
                ))
        ) {
            throw new HttpError(
                400,
                'uids must contain at most 50 notification ids',
                {
                    legacyCode: 'bad_request',
                },
            );
        }
        const query: {
            limit: number;
            scope: MailboxScope | null;
            filter?: string;
            onlyUnacknowledged?: boolean;
            excludeTypes?: readonly string[];
            uids?: string[];
        } = { limit, scope, ...(uids ? { uids: uids as string[] } : {}) };
        // The whole mailbox, or a slice naming no app, is the desktop's view of
        // it, which leaves out the types only an app has a use for. A slice
        // naming the app still returns them.
        if (scope === null || scope.appUid === undefined)
            query.excludeTypes = OUTSIDE_ACCOUNT_MAILBOX_TYPES;

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

    /**
     * An app's message to its own user, or with `to.handle` to the other party
     * of a KV share. The actor names the app; the share names the recipient.
     */
    async #createAppMessage(
        actor: UserActor,
        appUid: string,
        object: Record<string, unknown>,
        value: Record<string, unknown>,
    ): Promise<unknown> {
        const { type, to, sendAt, ...fields } = value;
        if (type !== APP_MESSAGE_TYPE) {
            throw typeNotAllowed(`Apps can create only ${APP_MESSAGE_TYPE}`);
        }
        for (const key of Object.keys(object)) {
            if (key !== 'value') {
                throw new HttpError(
                    400,
                    `\`${key}\` is set by the server for app notifications`,
                    { legacyCode: 'bad_request', fields: { field: key } },
                );
            }
        }
        const handle = to === undefined ? undefined : parseNotifyTarget(to);
        const message = parseAppMessage(fields);
        assertNotificationValueFits(value);
        const timing =
            sendAt === undefined || sendAt === null
                ? null
                : await this.#schedules().prepareSendAt(actor, sendAt);
        if (timing && !timing.immediate)
            return this.#scheduleAppMessage(actor, message, handle, timing);

        if (handle === undefined) {
            return this.#toClient(
                await this.#sendAppMessage(actor.user.id, appUid, message),
            );
        }
        try {
            const recipient =
                await this.services.kvShare.resolveNotifyRecipient(
                    actor,
                    handle,
                );
            await this.#sendAppMessage(
                recipient.recipientUserId,
                recipient.appUid,
                message,
            );
        } catch (err) {
            // Which limit refused would say how much the recipient is sent.
            if (err instanceof HttpError && err.statusCode === 429)
                throw tooManySharedNotifications();
            throw err;
        }
        // Even a uid would say whether the recipient's last one was replaced.
        return {};
    }

    /**
     * A message with a `group` replaces the newest one in that group unless it
     * was shown or dismissed, which spends a minute slot but no day slot.
     * Limits are keyed on the recipient, who need not be the actor.
     */
    async #sendAppMessage(
        recipientId: number,
        appUid: string,
        message: AppMessage,
    ): Promise<NotificationRow> {
        return this.#oneSendPerGroup(recipientId, appUid, message, () =>
            this.#replaceOrWriteAppMessage(recipientId, appUid, message),
        );
    }

    /**
     * One send per group at a time, so a burst into an empty group writes one
     * row that the rest replace. A lock that is busy past the wait or
     * unreachable still sends: the race costs a second row and its day slot.
     */
    #oneSendPerGroup<T>(
        recipientId: number,
        appUid: string,
        message: AppMessage,
        send: () => Promise<T>,
    ): Promise<T> {
        if (!message.group) return send();
        return withRedisLock(
            this.clients.redis,
            `notif:app-message:group:${recipientId}:${appUid}:${message.group}`,
            send,
            {
                ttlMs: GROUP_LOCK_MS,
                attempts: GROUP_LOCK_ATTEMPTS,
                retryMs: GROUP_LOCK_RETRY_MS,
                onUnavailable: 'run',
                onBusy: send,
            },
        );
    }

    // -- Delayed sends -----------------------------------------------

    #schedules(): ScheduleServiceContract {
        const schedules = this.services.schedules;
        if (!schedules) throw schedulesUnavailable();
        return schedules;
    }

    /**
     * Store an app's message to go out at `sendAt`. A recipient named through a
     * share is checked now without spending its budget; every limit is spent
     * when it goes, and the share is checked again then.
     */
    async #scheduleAppMessage(
        actor: UserActor,
        message: AppMessage,
        handle: string | undefined,
        plan: DeferredSendPlan,
    ): Promise<{ scheduled: { scheduleId: string; sendAt: number } }> {
        if (handle !== undefined)
            await this.services.kvShare.resolveNotifyRecipient(actor, handle, {
                spendBudget: false,
            });
        return {
            scheduled: await this.#schedules().createDeferredAppMessage(
                plan,
                handle === undefined ? { message } : { message, to: handle },
            ),
        };
    }

    /** For extensions. A field, not a method, so `/drivers/call` can't reach it. */
    readonly deferredAppMessages = {
        write: (input: DeferredWriteInput, tx: DeferredWriteTx) =>
            this.#writeDeferredAppMessage(input, tx),
    };

    /**
     * Check the sender and recipient as they stand now, spend the recipient's
     * limits, and write the mailbox row through `tx`, fenced on its guard.
     * Refusals are the same `HttpError`s an immediate send throws.
     */
    async #writeDeferredAppMessage(
        input: DeferredWriteInput,
        tx: DeferredWriteTx,
    ): Promise<DeferredWriteOutcome> {
        const { holderUserId, sendKey, signal } = input;
        const sender = await this.services.events.resolveScheduleActor(
            holderUserId,
            input.appUid,
        );
        if (!sender) {
            // A lagging replica can miss an app the primary has: retried.
            const there =
                (await this.stores.app.uidExistsOnPrimary(input.appUid)) &&
                (await this.stores.user.getById(holderUserId)) !== null;
            if (there) throw new Error('the sender could not be resolved');
            return 'dropped';
        }
        if (sender.user?.suspended) return 'senderSuspended';
        // Uninstalled since, and the cancel at uninstall missed it.
        const appId = sender.effectiveApp?.id;
        if (
            typeof appId !== 'number' ||
            !(await this.stores.permission.hasAnyUserAppPerm(
                holderUserId,
                appId,
            ))
        )
            return 'dropped';
        const stored = parseDelayedAppMessage(input.payload);
        if (!stored) return 'dropped';
        const { message } = stored;

        let recipientId = holderUserId;
        let appUid = input.appUid;
        if (stored.to !== undefined) {
            const recipient =
                await this.services.kvShare.resolveNotifyRecipient(
                    sender,
                    stored.to,
                );
            recipientId = recipient.recipientUserId;
            appUid = recipient.appUid;
        }

        return this.#oneSendPerGroup(recipientId, appUid, message, async () => {
            // Primary, as for an immediate send.
            const open = message.group
                ? await this.stores.notification.getUnseenByGroup(
                      recipientId,
                      appUid,
                      message.group,
                      { primary: true },
                  )
                : null;
            await this.#spendAppMessageLimits(
                recipientId,
                appUid,
                open ? ['minute'] : ['minute', 'day'],
            );
            message.app = appMessageSender(
                appUid,
                await this.stores.app.getByUid(appUid),
            );
            // Another attempt may hold the lease now; hand the claim back.
            if (signal.aborted) throw new Error('delayed send lost its lease');

            const registered = resolveNotificationWrite(
                APP_MESSAGE_TYPE,
                appUid,
            );
            const delivered = await tx.commit(
                this.stores.notification.sendEntries(
                    {
                        sendKey,
                        userId: recipientId,
                        value: { ...message, type: registered.type },
                        type: registered.type,
                        audience: registered.audience,
                        appUid,
                        group: message.group ?? null,
                        replaceUid: open ? String(open.uid) : null,
                        at: Date.now(),
                    },
                    tx.guard,
                ),
            );
            if (!delivered) return 'lost';
            if (open)
                await this.#spendDayIfFresh(recipientId, appUid, open, sendKey);
            return 'delivered';
        });
    }

    /**
     * A replacement that found its row shown since the lookup wrote a new one,
     * which costs a day slot. Already written, so a full day is not a refusal.
     */
    async #spendDayIfFresh(
        recipientId: number,
        appUid: string,
        open: Record<string, unknown>,
        sendKey: string,
    ): Promise<void> {
        try {
            const written =
                await this.stores.notification.getBySendKey(sendKey);
            if (written && written.uid !== open.uid)
                await this.#spendAppMessageLimits(recipientId, appUid, ['day']);
        } catch {
            // The row is written; a slot not spent is the only loss.
        }
    }

    async #replaceOrWriteAppMessage(
        recipientId: number,
        appUid: string,
        message: AppMessage,
    ): Promise<NotificationRow> {
        // Primary: a lagging replica would turn a replacement into a new
        // notification, which spends a day slot.
        const open = message.group
            ? await this.stores.notification.getUnseenByGroup(
                  recipientId,
                  appUid,
                  message.group,
                  { primary: true },
              )
            : null;
        await this.#spendAppMessageLimits(
            recipientId,
            appUid,
            open ? ['minute'] : ['minute', 'day'],
        );

        message.app = appMessageSender(
            appUid,
            await this.stores.app.getByUid(appUid),
        );

        if (open) {
            const replaced = await this.services.notification.replaceUnseen(
                open,
                recipientId,
                message,
                { type: APP_MESSAGE_TYPE },
            );
            if (replaced) return replaced;
            // Shown or dismissed since the lookup, so this one is new after all.
            await this.#spendAppMessageLimits(recipientId, appUid, ['day']);
        }

        return this.#write(recipientId, message, {
            type: APP_MESSAGE_TYPE,
            appUid,
            silent: false,
            group: message.group ?? null,
        });
    }

    /**
     * Every window named is read before any is spent, so a refusal costs none.
     * The minute window is spent first: it is the one most likely to run out
     * between the read and the spend, and a refusal there leaves the day
     * alone.
     */
    async #spendAppMessageLimits(
        userId: number,
        appUid: string,
        spend: readonly AppMessageWindow[],
    ): Promise<void> {
        const configured = this.config.notificationAppMessageLimits ?? {};
        const all: Record<AppMessageWindow, [string, number, number]> = {
            minute: [
                `notif:app-message:minute:${userId}:${appUid}`,
                configured.perMinute ?? APP_MESSAGE_RATE_LIMITS.perMinute,
                MINUTE_MS,
            ],
            day: [
                `notif:app-message:day:${userId}:${appUid}`,
                configured.perDay ?? APP_MESSAGE_RATE_LIMITS.perDay,
                DAY_MS,
            ],
        };
        const windows = spend
            .map((name) => all[name])
            .filter(([, limit]) => limit > 0);
        for (const [key, limit, windowMs] of windows) {
            if (!(await peekRateLimit(key, limit, windowMs))) {
                throw tooManyAppMessages();
            }
        }
        for (const [key, limit, windowMs] of windows) {
            if (!(await checkRateLimit(key, limit, windowMs))) {
                throw tooManyAppMessages();
            }
        }
    }

    /** Writes for `userId`, who need not be the actor, and returns the row. */
    async #write(
        userId: number,
        value: Record<string, unknown>,
        opts: {
            type: NotificationTypeName;
            appUid: string | null;
            silent: boolean;
            group?: string | null;
        },
    ): Promise<NotificationRow> {
        const [row] = await this.services.notification.notifyRows(
            [userId],
            value,
            opts,
        );
        if (!row) {
            throw new HttpError(500, 'Notification could not be created', {
                legacyCode: 'internal_error',
            });
        }
        return row;
    }

    // -- Permissions -------------------------------------------------

    #requireActor(): UserActor {
        const actor = requireContextActor();
        if (!actor.user?.id)
            throw new HttpError(403, 'User actor required', {
                legacyCode: 'forbidden',
            });
        // Unresolved is not "no app", and reading it that way here is what
        // would hand an app the account-wide mailbox.
        assertResolvedActor(actor);
        return actor as UserActor;
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
            app_uid: row.app_uid ?? null,
            shown: row.shown ?? null,
            acknowledged: row.acknowledged ?? null,
            created_at: row.created_at ?? null,
        };
    }
}
