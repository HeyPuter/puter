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
import { PuterService } from '../types.js';
import {
    findNotificationType,
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

/**
 * Notification orchestration — glues the NotificationStore (DB) to the event
 * bus (socket push) and handles lifecycle events (user connects → send unreads,
 * notification shown/acked → socket event).
 *
 * Other services push notifications via `notify(userIds, notification)`. The
 * driver (`puter-notifications`) handles read/select/mark for API consumers;
 * this service handles the write-and-push side.
 */
export class NotificationService extends PuterService {
    #pendingWrites = new Map<string, Promise<unknown>>();
    /** User.id → debounce timeout */
    #connectTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
    #retentionSweep: ReturnType<typeof setInterval> | null = null;

    override onServerStart(): void {
        this.#armRetentionSweep();

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

        // Track when a notification is actually delivered to a socket so
        // we can mark it as shown.
        this.clients.event.on(
            'sent-to-user.notif.message',
            (_key: string, data: unknown) => {
                const d = data as
                    | { user_id?: number; response?: { uid?: string } }
                    | undefined;
                const uid = d?.response?.uid;
                const userId = d?.user_id;
                if (!uid || !userId) return;
                void this.#markShownAfterWrite(uid, userId);
            },
        );
    }

    override onServerPrepareShutdown(): void {
        if (this.#retentionSweep) clearInterval(this.#retentionSweep);
        this.#retentionSweep = null;
    }

    // -- Public API --------------------------------------------------

    /**
     * Push a notification to one or more users. The notification is emitted to
     * the socket bus immediately (real-time), then persisted to the DB
     * asynchronously.
     *
     * Each recipient gets their own row, and `notification.uid` is unique
     * table-wide, so the uid is minted per recipient and each push carries the
     * uid naming _that_ recipient's row. The client echoes it back on dismiss
     * (`/notif/mark-ack`), and the delivery receipt below marks it shown —
     * neither can find a row otherwise.
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
     *   app, `{ silent }` to skip the socket push.
     * @returns The uid of the first recipient's notification.
     */
    async notify(
        userIds: number[],
        notification: Record<string, unknown>,
        opts: {
            type: NotificationTypeName;
            appUid?: string | null;
            silent?: boolean;
        },
    ): Promise<string> {
        const appUid = opts.appUid ?? null;
        const registered = resolveNotificationWrite(opts.type, appUid);
        const payload = { ...notification, type: registered.type };
        const uidByIndex = userIds.map(() => uuidv4());

        // Immediate socket push (before DB write completes)
        if (!opts.silent) {
            userIds.forEach((userId, i) => {
                this.clients.event.emit(
                    'outer.gui.notif.message',
                    {
                        user_id_list: [userId],
                        response: {
                            uid: uidByIndex[i],
                            notification: payload,
                        },
                    },
                    {},
                );
            });
        }

        // Async DB inserts — one row per user.
        userIds.forEach((userId, i) => {
            const uid = uidByIndex[i];
            const writePromise = (async () => {
                try {
                    await this.stores.notification.create({
                        userId,
                        value: payload,
                        uid,
                        type: registered.type,
                        audience: registered.audience,
                        appUid,
                    });
                } catch (err) {
                    console.warn(
                        `[notification] persist failed for user ${userId}`,
                        err,
                    );
                }
            })();
            this.#pendingWrites.set(uid, writePromise);
            writePromise.finally(() => this.#pendingWrites.delete(uid));

            // Nothing was pushed when silent, so there is no delivery to
            // confirm.
            if (opts.silent) return;
            writePromise.then(() => {
                this.clients.event.emit(
                    'outer.gui.notif.persisted',
                    {
                        user_id_list: [userId],
                        response: { uid },
                    },
                    {},
                );
            });
        });

        return uidByIndex[0] ?? uuidv4();
    }

    /**
     * Rewrite a notification the recipient hasn't dismissed and deliver it
     * again — for a story that grows rather than repeats, where a second
     * notification would just be noise. Only a `groupable` type may be folded
     * this way; the scope columns are the original row's and don't move.
     *
     * False when there was nothing to rewrite (dismissed in between), which is
     * the caller's signal to send a fresh one.
     */
    async notifyUpdate(
        uid: string,
        userId: number,
        notification: Record<string, unknown>,
        opts: { type: NotificationTypeName; silent?: boolean },
    ): Promise<boolean> {
        const registered = findNotificationType(opts.type);
        if (!registered?.groupable) {
            throw new Error(`notification type is not groupable: ${opts.type}`);
        }
        const payload = { ...notification, type: registered.type };
        const updated = await this.stores.notification.updateValue(
            uid,
            userId,
            payload,
        );
        if (!updated) return false;

        if (!opts.silent) {
            // Same uid as the original: the client replaces what it is already
            // showing rather than stacking another copy.
            this.clients.event.emit(
                'outer.gui.notif.message',
                {
                    user_id_list: [userId],
                    response: { uid, notification: payload },
                },
                {},
            );
        }
        return true;
    }

    /**
     * Mark a notification as acknowledged (user dismissed it) and push the ack
     * event to sockets so other tabs update.
     */
    async markAcknowledged(uid: string, userId: number): Promise<void> {
        await this.stores.notification.markAcknowledged(uid, userId);
        this.clients.event.emit(
            'outer.gui.notif.ack',
            {
                user_id_list: [userId],
                response: { uid },
            },
            {},
        );
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

    /** Mark a notification as shown (user saw it) and push the ack event. */
    async markShown(uid: string, userId: number): Promise<void> {
        await this.stores.notification.markShown(uid, userId);
        this.clients.event.emit(
            'outer.gui.notif.ack',
            {
                user_id_list: [userId],
                response: { uid },
            },
            {},
        );
    }

    // -- Internals ---------------------------------------------------

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

    async #sendUnreads(userId: number): Promise<void> {
        // Fetch all unseen + unacknowledged notifications
        const rows = await this.stores.notification.listByUserId(userId, {
            filter: 'unseen',
            limit: 200,
        });
        if (rows.length === 0) return;

        // Mark them shown now that we're delivering them
        for (const row of rows) {
            if (row.uid) {
                await this.stores.notification
                    .markShown(row.uid, userId)
                    .catch(() => {});
            }
        }

        // `created_at` rides along so a client listing these can date them;
        // without it everything delivered on connect would read as "now".
        const unreads = rows.map((r: Record<string, unknown>) => ({
            uid: r.uid,
            notification: r.value,
            created_at: r.created_at ?? null,
        }));

        this.clients.event.emit(
            'outer.gui.notif.unreads',
            {
                user_id_list: [userId],
                response: { unreads },
            },
            {},
        );
    }

    async #markShownAfterWrite(uid: string, userId: number): Promise<void> {
        // Wait for the pending write to finish before trying to mark shown
        const pending = this.#pendingWrites.get(uid);
        if (pending) await pending.catch(() => {});
        await this.stores.notification.markShown(uid, userId).catch(() => {});
    }
}
