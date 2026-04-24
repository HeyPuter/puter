import { Context } from '@heyputer/backend/src/core';
import { HttpError } from '@heyputer/backend/src/core/http';
import { extension } from '@heyputer/backend/src/extensions';
import { getAppIconUrl } from '@heyputer/backend/src/util/appIcon.js';

const clients = extension.import('client');
const services = extension.import('service');

const ALLOWED_ORDER_BY = [
    'id',
    'name',
    'uid',
    'title',
    'installed_at',
] as const;
const ORDER_BY_FIELD_MAP: Record<string, string> = {
    id: 'apps.id',
    name: 'apps.name',
    uid: 'apps.uid',
    title: 'apps.title',
    installed_at: 'installed_at',
};

extension.get(
    '/installedApps',
    { subdomain: 'api', requireUserActor: true },
    async (req, res) => {
        const actor = Context.get('actor');
        if (!actor?.user?.id)
            throw new HttpError(401, 'Authentication required');

        const orderBy = String(req.query.orderBy ?? 'installed_at');
        if (!(ALLOWED_ORDER_BY as readonly string[]).includes(orderBy)) {
            throw new HttpError(
                400,
                `Invalid orderBy. Allowed: ${ALLOWED_ORDER_BY.join(', ')}`,
            );
        }

        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(
            Math.max(Number(req.query.limit) || 100, 1),
            100,
        );
        const offset = (page - 1) * limit;
        const orderByField = ORDER_BY_FIELD_MAP[orderBy];
        const sortDirection = req.query.desc ? 'DESC' : 'ASC';

        const installedApps = (await clients.db.read(
            `SELECT
            apps.name,
            apps.uid,
            apps.title,
            apps.description,
            apps.icon,
            MIN(perm.dt) AS installed_at
        FROM apps
        LEFT JOIN user_to_app_permissions AS perm ON apps.id = perm.app_id
        WHERE perm.user_id = ?
        GROUP BY apps.id, apps.name, apps.uid, apps.title, apps.description
        ORDER BY ${orderByField} ${sortDirection}
        LIMIT ?
        OFFSET ?`,
            [actor.user.id, limit, offset],
        )) as Array<Record<string, unknown>>;

        const apiBaseUrl = extension.config.api_base_url as string | undefined;
        res.json(
            installedApps.map((app) => ({
                ...app,
                iconUrl: getAppIconUrl(app, { apiBaseUrl, services }),
            })),
        );
    },
);
