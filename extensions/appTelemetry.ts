import { Context } from '@heyputer/backend/src/core';
import type { Actor } from '@heyputer/backend/src/core/actor';
import { HttpError } from '@heyputer/backend/src/core/http';
import { PuterDriver } from '@heyputer/backend/src/drivers/types';
import { extension } from '@heyputer/backend/src/extensions';

// App-telemetry lets an app owner enumerate the users who have
// authenticated into their app. v1 shipped this as a driver on the
// `app-telemetry` interface (methods `get_users` / `user_count`) and
// puter-js's `puter.apps(...).getUsers()` still calls it that way
// (`puter.drivers.call('app-telemetry', 'app-telemetry', 'get_users', …)`).
// This is the v2 port of that driver — same interface/method/return shapes
// so existing puter-js callers work unchanged.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_OFFSET = 100_000;

const parseIntParam = (
    value: unknown,
    {
        key,
        min,
        max,
        fallback,
    }: { key: string; min: number; max: number; fallback: number },
): number => {
    if (value === undefined || value === null) return fallback;
    const parsed =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : NaN;
    if (
        !Number.isFinite(parsed) ||
        !Number.isInteger(parsed) ||
        parsed < min ||
        parsed > max
    ) {
        throw new HttpError(
            400,
            `${key} must be an integer between ${min} and ${max}`,
        );
    }
    return parsed;
};

/**
 * Driver exposing the `app-telemetry` interface.
 *
 * The `/drivers/call` permission gate checks
 * `service:app-telemetry:ii:app-telemetry`, which every actor already holds
 * via the blanket `service` grant (hardcoded-permissions.js +
 * `default_implicit_user_app_permissions`). The real authorization — "is the
 * caller the app owner?" — is enforced inside `get_users` below, exactly as
 * v1 did.
 */
export class AppTelemetryDriver extends PuterDriver {
    readonly driverInterface = 'app-telemetry';
    readonly driverName = 'app-telemetry';
    readonly isDefault = true;

    /** Users who have authenticated into the given app (owner-only). */
    async get_users({
        app_uuid,
        limit,
        offset,
    }: {
        app_uuid?: string;
        limit?: unknown;
        offset?: unknown;
    } = {}): Promise<Array<{ user: string; user_uuid: string }>> {
        if (!app_uuid) throw new HttpError(400, 'Missing `app_uuid`');

        const safeLimit = parseIntParam(limit, {
            key: 'limit',
            min: 1,
            max: MAX_LIMIT,
            fallback: DEFAULT_LIMIT,
        });
        const safeOffset = parseIntParam(offset, {
            key: 'offset',
            min: 0,
            max: MAX_OFFSET,
            fallback: 0,
        });

        const app = await this.stores.app.getByUid(app_uuid);
        if (!app) throw new HttpError(404, 'App not found');

        // The `apps-of-user:<uuid>:write` implicator keys on the owner's
        // UUID, not the numeric id. Look up the owner explicitly — the raw
        // app row only carries `owner_user_id`. (v1 got the owner for free
        // because its entity-storage layer eager-joined the owner row.)
        const ownerId = (app as { owner_user_id?: number }).owner_user_id;
        if (!ownerId) throw new HttpError(404, 'App owner not found');
        const owner = await this.stores.user.getById(ownerId);
        if (!owner?.uuid) throw new HttpError(404, 'App owner not found');

        const actor = Context.get('actor');
        if (!actor) throw new HttpError(401, 'Authentication required');
        const ownsApp = await this.services.permission
            .check(actor as Actor, `apps-of-user:${owner.uuid}:write`)
            .catch(() => false);
        if (!ownsApp) throw new HttpError(403, 'Permission denied');

        const users = (await this.clients.db.read(
            `SELECT u.username, u.uuid FROM user_to_app_permissions p
             INNER JOIN ${this.clients.db.quoteIdentifier('user')} u ON p.user_id = u.id
             WHERE p.permission = 'flag:app-is-authenticated' AND p.app_id = ?
             ORDER BY (p.dt IS NOT NULL), p.dt, p.user_id
             LIMIT ? OFFSET ?`,
            [(app as { id: number }).id, safeLimit, safeOffset],
        )) as Array<{ username: string; uuid: string }>;

        return users.map((e) => ({ user: e.username, user_uuid: e.uuid }));
    }

    /** Count of users who have authenticated into the given app. */
    async user_count({
        app_uuid,
    }: { app_uuid?: string } = {}): Promise<number> {
        if (!app_uuid) throw new HttpError(400, 'Missing `app_uuid`');

        const app = await this.stores.app.getByUid(app_uuid);
        if (!app) throw new HttpError(404, 'App not found');

        const [row] = (await this.clients.db.read(
            `SELECT COUNT(*) AS n FROM user_to_app_permissions
             WHERE permission = 'flag:app-is-authenticated' AND app_id = ?`,
            [(app as { id: number }).id],
        )) as Array<{ n: number }>;

        return row?.n ?? 0;
    }
}

extension.registerDriver('appTelemetry', AppTelemetryDriver);
