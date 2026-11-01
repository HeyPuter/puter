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

import { v4 as uuidv4 } from 'uuid';
import type { EventMap } from '../../clients/event/types.js';
import { handlerDepthOf, type Actor } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import type { NotifEventContext } from '../events/registry.js';
import { PuterService } from '../types.js';
import {
    NotificationSocketAdapter,
    notificationAckTimeoutMs,
    notificationsFoldInEnabled,
    type ReceiptScope,
} from './notificationSocket.js';
import {
    findNotificationType,
    inAccountMailbox,
    OUTSIDE_ACCOUNT_MAILBOX_TYPES,
    resolveNotificationWrite,
} from './notificationTypes.js';
import type { NotificationTypeName } from './notificationTypes.js';

export {
    NOTIFICATION_TYPES,
    findNotificationType,
} from './notificationTypes.js';
export type {
    NotificationAudience,
    NotificationType,
    NotificationTypeName,
} from './notificationTypes.js';
export { canViewNotification } from './notificationAudience.js';

/** How often the retention sweep runs. */
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Rows one delete takes. Small enough not to hold a lock anyone waits on. */
const RETENTION_BATCH_SIZE = 500;
/** Batches one sweep takes, so a large backlog drains over several passes. */
const RETENTION_MAX_BATCHES = 50;
/** Unread notifications one reconnect replays. */
const UNREAD_REPLAY_LIMIT = 200;

/**
 * Notification orchestration — glues the NotificationStore (DB) to the socket
 * adapter that carries the desktop's wire, and handles lifecycle events (user
 * connects → send unreads, notification acked → socket event).
 *
 * Other services push notifications via `notify(userIds, notification)`. The
 * driver (`puter-notifications`) handles read/select/mark for API consumers;
 * this service handles the write-and-push side.
 */
export class NotificationService extends PuterService {
    /** User.id → debounce timeout */
    #connectTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
    #retentionSweep: ReturnType<typeof setInterval> | null = null;
    #adapter: NotificationSocketAdapter | null = null;

    override onServerStart(): void {
        this.#armRetentionSweep();
        this.#socket().attach();

        // When a user opens the GUI, send their pending unreads.
        this.clients.event.on(
            'web.socket.user-connected',
            (_key: string, data: unknown) => {
                const d = data as { user?: { id?: number } } | undefined;
                const userId = d?.user?.id;
                if (!userId) return;

                // Debounce: multiple tabs may fire user-connected in rapid succession.
                const existing = this.#connectTimeouts.get(userId);
                if (existing) clearTimeout(existing);
                this.#connectTimeouts.set(
                    userId,
                    setTimeout(() => {
                        this.#connectTimeouts.delete(userId);
                        void this.#sendUnreads(userId).catch((err) => {
                            console.warn(
                                '[notification] sendUnreads failed',
                                err,
                            );
                        });
                    }, 2000),
                );
            },
        );
    }

    override onServerPrepareShutdown(): void {
        if (this.#retentionSweep) clearInterval(this.#retentionSweep);
        this.#retentionSweep = null;
    }

    // -- Public API --------------------------------------------------

    /**
     * Push a notification to one or more users. The row is written first and
     * pushed second: a uid a client is holding always names a row, so its
     * dismiss (`/notif/mark-ack`) has something to match and a failed insert
     * reaches nobody.
     *
     * Each recipient gets their own row, and `notification.uid` is unique
     * table-wide, so the uid is minted per recipient and each push carries the
     * uid naming _that_ recipient's row.
     *
     * `silent` persists without pushing: the recipient finds it when they next
     * look, but nothing interrupts them now. For callers that budget how often
     * they may interrupt someone and must still keep the record straight.
     *
     * `type` names a registry entry and decides the row's audience; an
     * unregistered one, or an app uid the entry does not allow, throws before
     * anything is written or pushed. The type rides along in the payload too,
     * so a client reading only the socket message can tell what it received.
     *
     * @param userIds Target user ids
     * @param notification Payload — { title, text?, icon?, fields? }
     * @param opts `{ type }` from the registry, `{ appUid }` for a row about an
     *   app, `{ silent }` to skip the socket push, `{ group }` to make the row
     *   findable by its group later.
     * @returns The uid of the first recipient's row, or `null` when nothing was
     *   written — there is no uid to hand back that would name anything.
     */
    async notify(
        userIds: number[],
        notification: Record<string, unknown>,
        opts: {
            type: NotificationTypeName;
            appUid?: string | null;
            silent?: boolean;
            group?: string | null;
        },
    ): Promise<string | null> {
        const appUid = opts.appUid ?? null;
        const registered = resolveNotificationWrite(opts.type, appUid);
        const payload = { ...notification, type: registered.type };

        // Recipients in parallel, each one persist-then-push in order.
        const written = await Promise.all(
            userIds.map(async (userId) => {
                const uid = uuidv4();
                try {
                    await this.stores.notification.insert({
                        userId,
                        value: payload,
                        uid,
                        type: registered.type,
                        audience: registered.audience,
                        appUid,
                        group: opts.group ?? null,
                    });
                } catch (err) {
                    // One recipient's row failing is not the others' problem,
                    // and nothing was pushed to this one — no uid is loose.
                    console.warn(
                        `[notification] persist failed for user ${userId}`,
                        err,
                    );
                    return null;
                }

                if (!opts.silent) {
                    await this.emitWritten(
                        {
                            userId,
                            uid,
                            type: registered.type,
                            audience: registered.audience,
                            appUid,
                            value: payload,
                        },
                        { sendId: uuidv4() },
                    );
                }
                return uid;
            }),
        );

        return written.find((uid) => uid !== null) ?? null;
    }

    /**
     * Rewrite a notification the recipient hasn't dismissed and deliver it
     * again — for a story that grows rather than repeats, where a second
     * notification would just be noise. Only a `groupable` type may be folded
     * this way; the scope columns are the original row's and don't move.
     *
     * `replace` is a newer notification standing in for the old one: it takes
     * only a row that was never shown, and records the replacement time, which
     * live and fetched copies carry as their version.
     *
     * False when there was nothing to rewrite (dismissed in between), which is
     * the caller's signal to send a fresh one.
     */
    async notifyUpdate(
        uid: string,
        userId: number,
        notification: Record<string, unknown>,
        opts: {
            type: NotificationTypeName;
            silent?: boolean;
            replace?: boolean;
        },
    ): Promise<boolean> {
        const registered = findNotificationType(opts.type);
        if (!registered?.groupable) {
            throw new Error(`notification type is not groupable: ${opts.type}`);
        }
        const payload = { ...notification, type: registered.type };
        const replacedAt = opts.replace ? Date.now() : undefined;
        const updated = await this.stores.notification.updateValue(
            uid,
            userId,
            payload,
            replacedAt === undefined ? {} : { onlyUnseen: true, replacedAt },
        );
        if (!updated) return false;
        if (opts.silent) return true;

        // Before the read, so the desktop copy updates even if it fails.
        const desktop = inAccountMailbox(registered.type);
        if (desktop) this.#sendRewrite(userId, uid, payload);
        const row = await this.stores.notification.getByUid(uid, { userId });
        const app = notification.app as { uid?: unknown } | undefined;
        const appUid =
            row?.app_uid ?? (typeof app?.uid === 'string' ? app.uid : null);
        await this.emitWritten(
            {
                userId,
                uid,
                type: registered.type,
                audience: registered.audience,
                appUid,
                value: payload,
                updated: true,
                replacedAt,
            },
            { sendId: uuidv4(), rewriteSent: desktop },
        );
        return true;
    }

    /**
     * Deliver a notification already written: `notif.written` for listeners,
     * then the live copy. `sendId` names this one send; a delayed send passes
     * the same one each time it delivers, so a listener can tell a repeat. An
     * `updated` row is an earlier notification rewritten in place, and
     * `replacedAt` marks it a replacement. `handlerDepth` is the depth the
     * write was made at, when no actor in context carries it. `rewriteSent`
     * says the caller already sent a desktop rewrite.
     */
    async emitWritten(
        written: {
            userId: number;
            uid: string;
            type: string;
            audience: string;
            appUid: string | null;
            value: Record<string, unknown>;
            updated?: boolean;
            replacedAt?: number;
        },
        opts: { sendId: string; handlerDepth?: number; rewriteSent?: boolean },
    ): Promise<void> {
        const { userId, uid, value: payload, updated } = written;
        const scope = {
            type: written.type,
            audience: written.audience,
            appUid: written.appUid,
        };
        const desktop = inAccountMailbox(scope.type);
        if (updated && desktop && !opts.rewriteSent)
            this.#sendRewrite(userId, uid, payload);
        // Listeners get their own copy; the socket sends `payload`.
        this.clients.event.emit(
            'notif.written',
            {
                userId,
                uid,
                ...scope,
                value: structuredClone(payload),
                ...(updated ? { updated: true as const } : {}),
                sendId: opts.sendId,
            },
            {},
        );
        // A rewrite of a type kept off the desktop has dispatch as its only
        // live path, so it goes out there again, under the same uid.
        if (!updated || !desktop)
            await this.#push(
                userId,
                uid,
                payload,
                scope,
                written.replacedAt,
                opts.handlerDepth,
            );
    }

    /**
     * Same uid as the original: the client replaces what it is already showing
     * rather than stacking another copy. It goes straight to the wire rather
     * than through dispatch — the row was already published, and republishing
     * it under its own id is a duplicate to anything deduplicating on
     * `event.id`.
     */
    #sendRewrite(
        userId: number,
        uid: string,
        payload: Record<string, unknown>,
    ): void {
        this.#socket().message(userId, uid, payload);
        this.#markDelivered(uid, userId);
    }

    /**
     * Mark a notification as acknowledged (user dismissed it) and push the ack
     * event to sockets so other tabs update.
     *
     * @returns Whether a row was actually acknowledged — false for one already
     *   acknowledged, or naming nobody's row. Callers use it to decide whether
     *   the ack happened at all, and it is also why no event goes out for
     *   either: there is nothing for another tab to update on.
     */
    async markAcknowledged(uid: string, userId: number): Promise<boolean> {
        const acknowledged = await this.stores.notification.markAcknowledged(
            uid,
            userId,
        );
        if (acknowledged) this.#socket().ack(userId, uid);
        return acknowledged;
    }

    /**
     * Delete one of the user's notifications and tell their other tabs, so it
     * leaves every open list at once.
     *
     * @returns Whether a row was deleted; false for a uid naming none of the
     *   user's rows, which also sends nothing.
     */
    async remove(uid: string, userId: number): Promise<boolean> {
        const removed = await this.stores.notification.deleteByUid(uid, userId);
        if (removed) this.#socket().removed(userId, uid);
        return removed;
    }

    /**
     * Deliver one dispatched notification over the desktop's wire. The events
     * layer decides who is owed a delivery; this turns that decision into the
     * message the GUI has always listened for.
     */
    deliverOverSocket(context: NotifEventContext): void {
        if (!inAccountMailbox(context.type)) return;
        this.#socket().message(
            context.userId,
            context.uid,
            context.notification,
        );
    }

    /**
     * Ask the desktop's sockets, or with `appUid` the app's own, whether the
     * live copy of a notification reached a page, and settle it as
     * `notif.delivery.settled`. Costs a round trip to every node, so callers
     * ask only when the answer changes what they do. Null when asking failed.
     */
    receipt(
        scope: ReceiptScope,
    ): Promise<EventMap['notif.delivery.settled'] | null> {
        return this.#socket().receipt(scope);
    }

    /**
     * Drop notifications past the retention window, in batches, and report how
     * many went. Deleting is all there is to it: nothing is pushed, because a
     * two-week-old row is not news, and a client listing again simply stops
     * seeing it.
     *
     * Every node sweeps. Batches are small and the delete is idempotent, so two
     * nodes overlapping costs a few empty batches, not correctness.
     */
    async sweepExpired(): Promise<number> {
        const days = this.#retentionDays();
        if (days <= 0) return 0;

        let removed = 0;
        for (let pass = 0; pass < RETENTION_MAX_BATCHES; pass++) {
            const batch = await this.stores.notification.deleteCreatedBefore(
                days,
                RETENTION_BATCH_SIZE,
            );
            removed += batch;
            // A short batch means the window is clean; the next sweep picks up
            // whatever aged into it meanwhile.
            if (batch < RETENTION_BATCH_SIZE) break;
        }
        return removed;
    }

    // -- Internals ---------------------------------------------------

    #socket(): NotificationSocketAdapter {
        this.#adapter ??= new NotificationSocketAdapter({
            event: this.clients.event,
            socket: this.services.socket,
            foldIn: () => notificationsFoldInEnabled(this.config),
            ackTimeoutMs: () => notificationAckTimeoutMs(this.config),
            heldInPeerRegion: (userId, appUid) =>
                this.#heldInPeerRegion(userId, appUid),
        });
        return this.#adapter;
    }

    /** A presence read that errors counts as no peer socket. */
    async #heldInPeerRegion(
        userId: number,
        appUid: string | null,
    ): Promise<boolean> {
        const eventForward = this.services.eventForward;
        if (!eventForward?.active) return false;
        try {
            return (await eventForward.regionsFor(userId, appUid)).length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Publish one persisted notification. With the fold-in on, the events layer
     * owns the delivery and feeds the socket adapter; without it, the adapter
     * pushes straight to the wire. `replacedAt` marks a replacement and is its
     * time.
     */
    async #push(
        userId: number,
        uid: string,
        payload: Record<string, unknown>,
        scope: { type: string; audience: string; appUid: string | null },
        replacedAt?: number,
        depth?: number,
    ): Promise<void> {
        const desktop = inAccountMailbox(scope.type);
        if (!notificationsFoldInEnabled(this.config)) {
            if (!desktop) return;
            this.#socket().message(userId, uid, payload);
            this.#markDelivered(uid, userId);
            return;
        }

        // The token is the recipient's mailbox, so dispatch needs their uuid —
        // looked up only on this path, and user rows are cached.
        const user = await this.stores.user.getById(userId);
        if (!user?.uuid) {
            if (!desktop) return;
            this.#socket().message(userId, uid, payload);
            this.#markDelivered(uid, userId);
            return;
        }

        const handlerDepth =
            depth ?? handlerDepthOf(Context.get('actor') as Actor | undefined);
        this.clients.event.emit(
            'notif.created',
            {
                userId,
                userUuid: user.uuid,
                uid,
                type: scope.type,
                audience: scope.audience,
                appUid: scope.appUid,
                value: payload,
                createdAt: replacedAt ?? Date.now(),
                ...(replacedAt !== undefined
                    ? { replaced: true as const }
                    : {}),
                ...(handlerDepth > 0 ? { handlerDepth } : {}),
            },
            {},
        );
        if (desktop) this.#markDelivered(uid, userId);
    }

    /**
     * A notification pushed to a connected recipient counts as shown, so the
     * reconnect replay carries what they actually missed. Only this region's
     * own sockets are visible, so the answer errs towards replaying a
     * notification twice rather than dropping it.
     */
    #markDelivered(uid: string, userId: number): void {
        if (!this.#socket().hasSocket(userId)) return;
        void this.stores.notification.markShown(uid, userId).catch(() => {});
    }

    #retentionDays(): number {
        const configured = Number(this.config.notificationRetentionDays ?? 0);
        return Number.isFinite(configured) && configured > 0 ? configured : 0;
    }

    #armRetentionSweep(): void {
        if (this.#retentionDays() <= 0) return;
        const sweep = setInterval(() => {
            void this.sweepExpired().catch((err) => {
                console.warn('[notification] retention sweep failed', err);
            });
        }, RETENTION_SWEEP_INTERVAL_MS);
        sweep.unref?.();
        this.#retentionSweep = sweep;
    }

    /**
     * What a reconnecting client missed. One statement marks the batch shown —
     * a per-row update is a round trip per notification on a path that runs
     * every time anyone opens the desktop — and no ack goes out for any of it:
     * an ack means "stop showing this", which is the opposite of a replay.
     */
    async #sendUnreads(userId: number): Promise<void> {
        const rows = await this.stores.notification.listByUserId(userId, {
            filter: 'unseen',
            limit: UNREAD_REPLAY_LIMIT,
            excludeTypes: OUTSIDE_ACCOUNT_MAILBOX_TYPES,
        });
        if (rows.length === 0) return;

        const uids = rows
            .map((r: Record<string, unknown>) => r.uid)
            .filter((uid: unknown): uid is string => typeof uid === 'string');
        await this.stores.notification
            .markShownByUids(uids, userId)
            .catch(() => {});

        // `created_at` rides along so a client listing these can date them;
        // without it everything delivered on connect would read as "now".
        const unreads = rows.map((r: Record<string, unknown>) => ({
            uid: r.uid as string,
            notification: r.value,
            created_at: r.created_at ?? null,
        }));

        this.#socket().unreads(userId, unreads);
    }
}
