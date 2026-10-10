import type { Request, Response } from 'express';
import { Context } from '@heyputer/backend/src/core';
import { HttpError } from '@heyputer/backend/src/core/http';
import { extension } from '@heyputer/backend/src/extensions';
import {
    INSTALLED_APPS_ORDERS,
    type InstalledAppsOrder,
} from '@heyputer/backend/src/stores/permission/PermissionStore.js';
import {
    getAppIconCdnUrl,
    getAppIconUrl,
} from '@heyputer/backend/src/util/appIcon.js';

const stores = extension.import('store');

export const handleInstalledApps = async (
    req: Request,
    res: Response,
): Promise<void> => {
    // Behind `requireUserActor`, so there is always an actor.
    const actor = Context.get('actor')!;

    const orderBy = String(
        req.query.orderBy ?? 'installed_at',
    ) as InstalledAppsOrder;
    if (!INSTALLED_APPS_ORDERS.includes(orderBy)) {
        throw new HttpError(
            400,
            `Invalid orderBy. Allowed: ${INSTALLED_APPS_ORDERS.join(', ')}`,
        );
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 100);
    const offset = (page - 1) * limit;
    const installedApps = await stores.permission.listAppsGrantedByUser(
        actor.user.id!,
        { orderBy, descending: Boolean(req.query.desc), limit, offset },
    );

    const apiBaseUrl = extension.config.api_base_url as string | undefined;
    res.json(
        installedApps.map((app) => {
            // An app with no owner_user_id (null/empty) isn't owned by a Puter
            // user — it's an "external" app. Derive a flag and don't leak the
            // raw owner id to the client.
            const { owner_user_id, ...rest } = app;
            const external = owner_user_id == null || owner_user_id === '';
            return {
                ...rest,
                iconUrl: getAppIconUrl(app, { apiBaseUrl }),
                // Direct subdomain URL for the client to try before iconUrl.
                iconCdnUrl: getAppIconCdnUrl(app, extension.config),
                external,
            };
        }),
    );
};

extension.get(
    '/installedApps',
    {
        subdomain: 'api',
        requireUserActor: true,
        allowFullAccessToken: true,
        rateLimit: {
            scope: 'installed-apps',
            limit: 120,
            window: 60_000,
            key: 'user',
        },
    },
    handleInstalledApps,
);
