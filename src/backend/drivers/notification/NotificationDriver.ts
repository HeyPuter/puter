import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterDriver } from '../types.js';
import type { Actor } from '../../core/actor.js';

const MAX_SELECT_LIMIT = 200;

/**
 * Driver exposing the `puter-notifications` interface.
 *
 * Wraps NotificationStore with owner-scoped permission checks.
 * Methods follow the `crud-q` shape: create, read, select.
 *
 * Read-only for clients — `update` and `delete` are not exposed. `create`
 * is available for server-internal callers (other services push
 * notifications via `/drivers/call` with a system token or directly
 * through the store). `read` and `select` accept predicates.
 *
 * Permission model:
 *   - Strictly owner-limited — each user can only see their own notifications
 *   - No app-actor access (user tokens only)
 *
 * Predicates:
 *   - `'unseen'` — shown IS NULL AND acknowledged IS NULL
 *   - `'unacknowledged'` — acknowledged IS NULL (may be shown)
 *   - `'acknowledged'` — acknowledged IS NOT NULL
 */
export class NotificationDriver extends PuterDriver {
    readonly driverInterface = 'puter-notifications';
    readonly driverName = 'notifications';
    readonly isDefault = true;

    // ── Driver methods ──────────────────────────────────────────────

    async create (args: Record<string, unknown>): Promise<unknown> {
        const object = args.object as Record<string, unknown> | undefined;
        if ( !object || typeof object !== 'object' ) {
            throw new HttpError(400, 'Missing or invalid `object`');
        }
        const actor = this.#requireUserActor();

        const value = object.value ?? {};
        const created = await this.stores.notification.create({
            userId: actor.user.id,
            value,
        });
        return this.#toClient(created);
    }

    async read (args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireUserActor();
        const uid = (args.uid ?? args.id) as string | undefined;
        if ( ! uid ) throw new HttpError(400, 'Missing `uid`');

        const row = await this.stores.notification.getByUid(String(uid), { userId: actor.user.id });
        if ( ! row ) throw new HttpError(404, 'Notification not found');
        return this.#toClient(row);
    }

    async select (args: Record<string, unknown>): Promise<unknown[]> {
        const actor = this.#requireUserActor();
        const limit = Math.min(Number(args.limit ?? MAX_SELECT_LIMIT), MAX_SELECT_LIMIT);
        const predicate = args.predicate as string | string[] | undefined;

        const predicateName = Array.isArray(predicate) ? predicate[0] : predicate;

        // Route predicate → store query params
        let rows: Array<Record<string, unknown>>;
        switch ( predicateName ) {
            case 'unseen':
                rows = await this.stores.notification.listByUserId(actor.user.id, {
                    limit,
                    filter: 'unseen',
                });
                break;
            case 'unacknowledged':
            case 'unacknowledge': // client compat alias
                rows = await this.stores.notification.listByUserId(actor.user.id, {
                    limit,
                    onlyUnacknowledged: true,
                });
                break;
            case 'acknowledged':
            case 'acknowledge': // client compat alias
                rows = await this.stores.notification.listByUserId(actor.user.id, {
                    limit,
                    filter: 'acknowledged',
                });
                break;
            default:
                rows = await this.stores.notification.listByUserId(actor.user.id, { limit });
                break;
        }

        return rows.map(r => this.#toClient(r));
    }

    /** Mark a notification as shown. Used by GUI when notification is displayed. */
    async mark_shown (args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireUserActor();
        const uid = String(args.uid ?? '');
        if ( ! uid ) throw new HttpError(400, 'Missing `uid`');
        const ok = await this.stores.notification.markShown(uid, actor.user.id);
        return { success: ok };
    }

    /** Mark a notification as acknowledged (user dismissed it). */
    async mark_acknowledged (args: Record<string, unknown>): Promise<unknown> {
        const actor = this.#requireUserActor();
        const uid = String(args.uid ?? '');
        if ( ! uid ) throw new HttpError(400, 'Missing `uid`');
        const ok = await this.stores.notification.markAcknowledged(uid, actor.user.id);
        return { success: ok };
    }

    // ── Permissions ─────────────────────────────────────────────────

    #requireUserActor (): Actor & { user: { id: number; uuid: string; username: string } } {
        const actor = Context.get('actor') as Actor | undefined;
        if ( ! actor ) throw new HttpError(401, 'Authentication required');
        if ( ! actor.user?.id ) throw new HttpError(403, 'User actor required');
        // App-under-user actors are not allowed for notifications.
        if ( actor.app ) throw new HttpError(403, 'App actors cannot access notifications');
        return actor as Actor & { user: { id: number; uuid: string; username: string } };
    }

    // ── Serialization ───────────────────────────────────────────────

    #toClient (row: Record<string, unknown> | null): Record<string, unknown> | null {
        if ( ! row ) return null;
        return {
            uid: row.uid,
            value: row.value,
            shown: row.shown ?? null,
            acknowledged: row.acknowledged ?? null,
            created_at: row.created_at ?? null,
        };
    }
}
