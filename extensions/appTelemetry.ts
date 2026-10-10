import { Context } from '@heyputer/backend/src/core';
import { HttpError } from '@heyputer/backend/src/core/http';
import { PuterDriver } from '@heyputer/backend/src/drivers/types';
import type {
    DriverConcurrentConfig,
    DriverRateLimitConfig,
} from '@heyputer/backend/src/drivers/meta';
import {
    DEFAULT_FREE_SUBSCRIPTION,
    DEFAULT_TEMP_SUBSCRIPTION,
} from '@heyputer/backend/src/services/metering/consts';
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
 * `service:app-telemetry:ii:app-telemetry`, which every actor already holds via
 * the blanket `service` grant (hardcoded-permissions.js +
 * `default_implicit_user_app_permissions`). The real authorization — "is the
 * caller the app owner?" — is enforced inside `get_users` below, exactly as v1
 * did.
 */
export class AppTelemetryDriver extends PuterDriver {
    readonly driverInterface = 'app-telemetry';
    readonly driverName = 'app-telemetry';
    readonly isDefault = true;

    // Declaring nothing here would leave both methods on the generic
    // 600/minute driver default, which does not fit a paginated scan that
    // can ask for MAX_LIMIT rows at MAX_OFFSET. This is a dashboard read —
    // nobody calls it in a loop.
    readonly rateLimit: DriverRateLimitConfig = {
        default: {
            limit: 60,
            window: 60_000,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 30,
                [DEFAULT_TEMP_SUBSCRIPTION]: 10,
            },
        },
    };

    readonly concurrent: DriverConcurrentConfig = {
        default: {
            limit: 5,
            bySubscription: {
                [DEFAULT_FREE_SUBSCRIPTION]: 2,
                [DEFAULT_TEMP_SUBSCRIPTION]: 2,
            },
        },
    };

    /** Users who have authenticated into the given app (owner-only). */
    async get_users({
        app_uuid,
        limit,
        offset,
    }: {
        app_uuid?: string;
        limit?: unknown;
        offset?: unknown;
    } = {}): Promise<
        Array<{ user: string; user_uuid: string; user_email?: string | null }>
    > {
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

        // `/drivers/call` requires auth, so there is always an actor.
        const actor = Context.get('actor')!;
        let ownsApp = false;
        try {
            ownsApp = await this.services.permission.check(
                actor,
                `apps-of-user:${owner.uuid}:write`,
            );
        } catch {
            // A failed check is a denial.
        }
        if (!ownsApp) throw new HttpError(403, 'Permission denied');

        // An email surfaces only for a user who granted *this app*
        // `user:<their-uuid>:email:read` — the grant `puter.perms.requestEmail()`
        // obtains and `whoami` honours. Authenticating alone doesn't share it.
        const users = await this.stores.permission.listAppAuthenticatedUsers(
            (app as { id: number }).id,
            { limit: safeLimit, offset: safeOffset },
        );
        return users.map((u) =>
            u.emailShared
                ? { user: u.username, user_uuid: u.uuid, user_email: u.email }
                : { user: u.username, user_uuid: u.uuid },
        );
    }

    /** Count of users who have authenticated into the given app. */
    async user_count({
        app_uuid,
    }: { app_uuid?: string } = {}): Promise<number> {
        if (!app_uuid) throw new HttpError(400, 'Missing `app_uuid`');

        const app = await this.stores.app.getByUid(app_uuid);
        if (!app) throw new HttpError(404, 'App not found');

        return this.stores.permission.countAppUsers((app as { id: number }).id);
    }
}

extension.registerDriver('appTelemetry', AppTelemetryDriver);
