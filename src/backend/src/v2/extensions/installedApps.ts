import { extension } from '../extensions';
import { HttpError } from '../core/http/HttpError';
import { Context } from '../core/context';

const clients = extension.import('client');

const ALLOWED_ORDER_BY = ['id', 'name', 'uid', 'title', 'installed_at'] as const;
const ORDER_BY_FIELD_MAP: Record<string, string> = {
    id: 'apps.id',
    name: 'apps.name',
    uid: 'apps.uid',
    title: 'apps.title',
    installed_at: 'installed_at',
};

extension.get('/installedApps', { subdomain: 'api', requireUserActor: true }, async (req, res) => {
    const actor = Context.get('actor');
    if ( ! actor?.user?.id ) throw new HttpError(401, 'Authentication required');

    const orderBy = String(req.query.orderBy ?? 'installed_at');
    if ( ! (ALLOWED_ORDER_BY as readonly string[]).includes(orderBy) ) {
        throw new HttpError(400, `Invalid orderBy. Allowed: ${ALLOWED_ORDER_BY.join(', ')}`);
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 100);
    const offset = (page - 1) * limit;
    const orderByField = ORDER_BY_FIELD_MAP[orderBy];
    const sortDirection = req.query.desc ? 'DESC' : 'ASC';

    const installedApps = await clients.db.read(
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
    );

    res.json(installedApps);
});
