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

import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import {
    EVENTS_SCHEDULE_DEFERRED_MAX_ATTEMPTS,
    EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
} from '../../controllers/events/limits.js';
import {
    assertResolvedActor,
    requireContextActor,
    type UserActor,
} from '../../core/actor.js';
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import {
    checkRateLimit,
    peekRateLimit,
} from '../../core/http/middleware/rateLimit.js';
import { resolveNotifFetch } from '../../services/events/notifFetch.js';
import type {
    ScheduleActionOutcome,
    ScheduleActionRun,
} from '../../services/events/scheduleActions.js';
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
    NOTIFICATION_VALUE_MAX_BYTES,
    OUTSIDE_ACCOUNT_MAILBOX_TYPES,
    resolveNotificationWrite,
    type NotificationTypeName,
} from '../../services/notification/notificationTypes.js';
import type { ScheduleRow } from '../../stores/events/ScheduleStore.js';
import { withRedisLock } from '../../util/redisLock.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';
import type { DriverRateLimitConfig } from '../meta.js';
import { CRUD_CONCURRENT } from '../util/crudLimits.js';

const MAX_SELECT_LIMIT = 200;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// A group's sends queue for up to ~1 s; a stalled holder blocks them for the TTL.
const GROUP_LOCK_MS = 5_000;
const GROUP_LOCK_ATTEMPTS = 40;
const GROUP_LOCK_RETRY_MS = 25;

type AppMessageWindow = 'minute' | 'day';

/** The schedule action a delayed app message runs as. */
export const APP_MESSAGE_SEND_ACTION = 'notifications.appMessage';
/** How long one attempt holds a delayed send before another may take it over. */
const SEND_CLAIM_MS = 120_000;
/**
 * A send another attempt holds is looked at again this long after its claim
 * lapses.
 */
const SEND_CLAIM_SLACK_MS = 1_000;
/** Answers that will be the same on every attempt: the send is dropped. */
const DROPPED_STATUSES = new Set([400, 403, 404]);
/** Delayed sends' keys are named under this. Never change it. */
const SEND_KEY_NAMESPACE = '561a0386-c290-49aa-8951-9a2d783c8eba';

/**
 * The key of one delayed send's one slot: the uid of the row it writes, the
 * `send_key` of the row it writes or replaces, and the `sendId` it is delivered
 * under, every time it is delivered.
 */
export const sendKeyOf = (scheduleId: string, scheduledFor: number): string =>
    uuidv5(`${scheduleId}:${scheduledFor}`, SEND_KEY_NAMESPACE);

/** What a delayed app message stores until it is sent. */
interface DelayedAppMessage {
    message: AppMessage;
    /** A KV share handle naming the recipient. */
    to?: string;
}

/** How a delayed send's write stood when it stopped. */
type DelayedWrite = 'delivered' | 'dropped' | 'lost' | 'senderSuspended';

/** The mailbox slice a call named, in the terms the query takes it. */
interface MailboxScope {
    audiences: readonly string[];
    /** `null` is the rows naming no app; `undefined` is any app. */
    appUid: string | null | undefined;
}

const assertValueFits = (value: Record<string, unknown>): void => {
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
};

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
): DelayedAppMessage | null => {
    try {
        const stored = JSON.parse(payload ?? 'null') as DelayedAppMessage;
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

    override onServerStart(): void {
        this.services.schedule.actions.register(
            APP_MESSAGE_SEND_ACTION,
            (run) => this.#sendDelayedAppMessage(run),
        );
    }

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
        assertValueFits(value);
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
        const uid = await this.#write(actor.user.id, value, {
            type: registeredType,
            appUid,
            silent: true,
        });
        return this.#readBack(uid, actor.user.id);
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
            excludeTypes?: readonly string[];
        } = { limit, scope };
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
        assertValueFits(value);
        const timing =
            sendAt === undefined || sendAt === null
                ? null
                : this.services.schedule.parseSendAt(sendAt);
        if (timing && !timing.immediate)
            return this.#scheduleAppMessage(
                actor,
                message,
                handle,
                timing.sendAt,
            );

        if (handle === undefined) {
            const uid = await this.#sendAppMessage(
                actor.user.id,
                appUid,
                message,
            );
            return this.#readBack(uid, actor.user.id);
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
    ): Promise<string> {
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

    /**
     * Store an app's message to go out at `sendAt`. A recipient named through a
     * share is checked now without spending its budget; every limit is spent
     * when it goes, and the share is checked again then.
     */
    async #scheduleAppMessage(
        actor: UserActor,
        message: AppMessage,
        handle: string | undefined,
        sendAt: number,
    ): Promise<{ scheduled: { scheduleId: string; sendAt: number } }> {
        if (handle !== undefined)
            await this.services.kvShare.resolveNotifyRecipient(actor, handle, {
                spendBudget: false,
            });
        const payload: DelayedAppMessage =
            handle === undefined ? { message } : { message, to: handle };
        const row = await this.services.schedule.createDeferred(actor, {
            action: APP_MESSAGE_SEND_ACTION,
            payload: JSON.stringify(payload),
            sendAt,
        });
        return { scheduled: { scheduleId: row.uid, sendAt: row.startAt } };
    }

    /**
     * Send a delayed app message when it comes due. The row is claimed first,
     * and the mailbox row is written in one transaction with the row marked
     * delivered, so a slot writes at most one row however often it runs. Each
     * delivery of it carries the slot's key as its `sendId`.
     */
    async #sendDelayedAppMessage(
        run: ScheduleActionRun,
    ): Promise<ScheduleActionOutcome> {
        const schedules = this.stores.schedule;
        const sendKey = sendKeyOf(run.scheduleId, run.scheduledFor);
        const token = uuidv4();
        const claimed = await schedules.claimDeferred(
            run.rowId,
            this.services.schedule.namespace,
            token,
            SEND_CLAIM_MS,
        );
        if (!claimed) return this.#resumeDelayedSend(run, sendKey);
        const row = (await schedules.getDeferred(run.rowId))?.row;
        if (!row || row.sendToken !== token)
            return this.#resumeDelayedSend(run, sendKey);
        if (run.attempts >= EVENTS_SCHEDULE_DEFERRED_MAX_ATTEMPTS)
            return this.#finishDelayedSend(run, token, 'dropped');

        let written: DelayedWrite;
        try {
            written = await this.#writeDelayedAppMessage(
                row,
                token,
                sendKey,
                run.signal,
            );
        } catch (err) {
            if (isHttpError(err) && DROPPED_STATUSES.has(err.statusCode))
                return this.#finishDelayedSend(run, token, 'dropped');
            if (!isHttpError(err) || err.statusCode >= 500)
                console.warn(
                    '[notification] delayed send failed',
                    run.scheduleId,
                    err,
                );
            await this.#releaseDelayedSend(run, token);
            return { type: 'retry' };
        }
        switch (written) {
            case 'dropped':
                return this.#finishDelayedSend(run, token, 'dropped');
            case 'senderSuspended':
                await this.#releaseDelayedSend(run, token);
                return {
                    type: 'defer',
                    delayMs: EVENTS_SCHEDULE_SUSPENDED_HOLDER_DEFER_MS,
                };
            case 'lost':
                // Another attempt took the claim over and carries the send.
                return { type: 'defer', delayMs: SEND_CLAIM_MS };
            case 'delivered':
                return this.#emitDelayedSend(
                    run,
                    sendKey,
                    token,
                    row.handlerDepth,
                );
        }
    }

    /**
     * Check the sender and recipient as they stand now, spend the recipient's
     * limits, and write the mailbox row with the send marked delivered.
     */
    async #writeDelayedAppMessage(
        row: ScheduleRow,
        token: string,
        sendKey: string,
        signal: AbortSignal,
    ): Promise<DelayedWrite> {
        const sender = await this.services.events.resolveScheduleActor(
            row.holderUserId,
            row.appUid,
        );
        if (!sender) return 'dropped';
        if (sender.user?.suspended) return 'senderSuspended';
        const stored = parseDelayedAppMessage(row.payload);
        if (!stored) return 'dropped';
        const { message } = stored;

        let recipientId = row.holderUserId;
        let appUid = row.appUid;
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
            const delivered = await this.stores.schedule.deliverDeferred(
                row.id,
                token,
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
                    this.stores.schedule.deliveredGuard(row.id, token),
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

    /**
     * Deliver what a send wrote, under its key, and finish it. Run again by the
     * next attempt when a crash came between the write and the finish, so a
     * delivery may repeat; its `sendId` never changes.
     */
    async #emitDelayedSend(
        run: ScheduleActionRun,
        sendKey: string,
        token: string,
        handlerDepth: number,
    ): Promise<ScheduleActionOutcome> {
        // Gone when the recipient deleted it, or a later send replaced it.
        const written = await this.stores.notification.getBySendKey(sendKey);
        if (written) {
            // The uid of a row this send wrote fresh is its key; any other row
            // is one it replaced.
            const replaced = written.uid !== sendKey;
            await this.services.notification.emitWritten(
                {
                    userId: Number(written.user_id),
                    uid: String(written.uid),
                    type: String(written.type),
                    audience: String(written.audience),
                    appUid: (written.app_uid as string | null) ?? null,
                    value: written.value as Record<string, unknown>,
                    ...(replaced
                        ? {
                              updated: true,
                              replacedAt: Number(written.replaced_at),
                          }
                        : {}),
                },
                { sendId: sendKey, handlerDepth },
            );
        }
        return this.#finishDelayedSend(run, token, 'delivered');
    }

    /** The claim was refused: carry on from where the row stands. */
    async #resumeDelayedSend(
        run: ScheduleActionRun,
        sendKey: string,
    ): Promise<ScheduleActionOutcome> {
        const current = await this.stores.schedule.getDeferred(run.rowId);
        if (!current) return { type: 'finished', version: run.version + 1 };
        const { row, nowMs } = current;
        if (row.deletedAt !== null || row.state === 'done')
            return { type: 'finished', version: row.version };
        if (row.state === 'delivered' && row.sendToken !== null)
            return this.#emitDelayedSend(
                run,
                sendKey,
                row.sendToken,
                row.handlerDepth,
            );
        const claimLeft =
            row.state === 'sending' && row.sendUntil !== null
                ? row.sendUntil - nowMs
                : 0;
        return {
            type: 'defer',
            delayMs: Math.max(0, claimLeft) + SEND_CLAIM_SLACK_MS,
        };
    }

    async #finishDelayedSend(
        run: ScheduleActionRun,
        token: string,
        reason: 'delivered' | 'dropped',
    ): Promise<ScheduleActionOutcome> {
        const row = await this.stores.schedule.finishDeferred(
            run.rowId,
            token,
            reason,
        );
        if (!row) return { type: 'finished', version: run.version + 1 };
        if (row.deletedAt !== null)
            return { type: 'finished', version: row.version };
        // Another claim holds it.
        return { type: 'defer', delayMs: SEND_CLAIM_MS };
    }

    /** Hand the claim back; one that can't be lapses at its expiry. */
    async #releaseDelayedSend(
        run: ScheduleActionRun,
        token: string,
    ): Promise<void> {
        try {
            await this.stores.schedule.releaseDeferred(run.rowId, token);
        } catch (err) {
            console.warn(
                '[notification] could not release a delayed send',
                run.scheduleId,
                err,
            );
        }
    }

    async #replaceOrWriteAppMessage(
        recipientId: number,
        appUid: string,
        message: AppMessage,
    ): Promise<string> {
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
            const uid = String(open.uid);
            if (
                await this.services.notification.notifyUpdate(
                    uid,
                    recipientId,
                    message,
                    { type: APP_MESSAGE_TYPE, replace: true },
                )
            ) {
                return uid;
            }
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

    /** Writes for `userId`, who need not be the actor, and names the row. */
    async #write(
        userId: number,
        value: Record<string, unknown>,
        opts: {
            type: NotificationTypeName;
            appUid: string | null;
            silent: boolean;
            group?: string | null;
        },
    ): Promise<string> {
        const uid = await this.services.notification.notify(
            [userId],
            value,
            opts,
        );
        if (!uid) {
            throw new HttpError(500, 'Notification could not be created', {
                legacyCode: 'internal_error',
            });
        }
        return uid;
    }

    /** The service hands back only the uid; the primary has the rest. */
    async #readBack(
        uid: string,
        userId: number,
    ): Promise<Record<string, unknown> | null> {
        return this.#toClient(
            await this.stores.notification.getByUid(uid, {
                userId,
                primary: true,
            }),
        );
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
