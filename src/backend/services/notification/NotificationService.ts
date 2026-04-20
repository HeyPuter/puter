import { v4 as uuidv4 } from 'uuid';
import { PuterService } from '../types.js';

/**
 * Notification orchestration — glues the NotificationStore (DB) to the
 * event bus (socket push) and handles lifecycle events (user connects →
 * send unreads, notification shown/acked → socket event).
 *
 * Other services push notifications via `notify(userIds, notification)`.
 * The driver (`puter-notifications`) handles read/select/mark for API
 * consumers; this service handles the write-and-push side.
 */
export class NotificationService extends PuterService {
    #pendingWrites = new Map<string, Promise<unknown>>();
    /** user.id → debounce timeout */
    #connectTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

    override onServerStart(): void {
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

    // ── Public API ──────────────────────────────────────────────────

    /**
     * Push a notification to one or more users. The notification is
     * emitted to the socket bus immediately (real-time), then persisted
     * to the DB asynchronously.
     *
     * @param userIds  Target user ids
     * @param notification  Payload — { source, title, text?, icon?, template?, fields? }
     */
    async notify(
        userIds: number[],
        notification: Record<string, unknown>,
    ): Promise<string> {
        const uid = uuidv4();

        // Immediate socket push (before DB write completes)
        this.clients.event.emit(
            'outer.gui.notif.message',
            {
                user_id_list: userIds,
                response: { uid, notification },
            },
            {},
        );

        // Async DB inserts — one row per user.
        const writePromise = (async () => {
            for (const userId of userIds) {
                try {
                    await this.stores.notification.create({
                        userId,
                        value: notification,
                    });
                } catch (err) {
                    console.warn(
                        `[notification] persist failed for user ${userId}`,
                        err,
                    );
                }
            }
        })();
        this.#pendingWrites.set(uid, writePromise);
        writePromise.finally(() => this.#pendingWrites.delete(uid));

        // Fire persisted event after all writes complete
        writePromise
            .then(() => {
                this.clients.event.emit(
                    'outer.gui.notif.persisted',
                    {
                        user_id_list: userIds,
                        response: { uid },
                    },
                    {},
                );
            })
            .catch(() => {
                /* already logged per-user above */
            });

        return uid;
    }

    /**
     * Mark a notification as acknowledged (user dismissed it) and push
     * the ack event to sockets so other tabs update.
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
     * Mark a notification as shown (user saw it) and push the ack event.
     */
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

    // ── Internals ───────────────────────────────────────────────────

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

        const unreads = rows.map((r: Record<string, unknown>) => ({
            uid: r.uid,
            notification: r.value,
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
