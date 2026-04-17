import { Context } from "@heyputer/backend/src/core";
import { HttpError } from "@heyputer/backend/src/core/http";
import { extension } from "@heyputer/backend/src/extensions";


const clients  = extension.import('client');
const stores   = extension.import('store');
const services = extension.import('service');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_OFFSET = 100_000;

const parseIntParam = (
    value: unknown,
    { key, min, max, fallback }: { key: string; min: number; max: number; fallback: number },
): number => {
    if ( value === undefined || value === null ) return fallback;
    const parsed = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    if ( !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max ) {
        throw new HttpError(400, `${key} must be an integer between ${min} and ${max}`);
    }
    return parsed;
};

extension.get('/app-telemetry/users', { subdomain: 'api', requireAuth: true }, async (req, res) => {
    const { app_uuid } = req.query as Record<string, string>;
    if ( ! app_uuid ) throw new HttpError(400, 'Missing `app_uuid`');

    const safeLimit = parseIntParam(req.query.limit, { key: 'limit', min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
    const safeOffset = parseIntParam(req.query.offset, { key: 'offset', min: 0, max: MAX_OFFSET, fallback: 0 });

    const app = await stores.app.getByUid(app_uuid);
    if ( ! app ) throw new HttpError(404, 'App not found');

    const actor = Context.get('actor');
    const ownsApp = await services.permission.check(actor!, `apps-of-user:${(app as Record<string, unknown>).owner_user_id}:write`).catch(() => false);
    if ( ! ownsApp ) throw new HttpError(403, 'Permission denied');

    const users = await clients.db.read(
        `SELECT u.username, u.uuid FROM user_to_app_permissions p
         INNER JOIN user u ON p.user_id = u.id
         WHERE p.permission = 'flag:app-is-authenticated' AND p.app_id = ?
         ORDER BY (p.dt IS NOT NULL), p.dt, p.user_id
         LIMIT ? OFFSET ?`,
        [(app as Record<string, unknown>).id, safeLimit, safeOffset],
    );

    res.json((users as Array<{ username: string; uuid: string }>).map(e => ({
        user: e.username,
        user_uuid: e.uuid,
    })));
});

extension.get('/app-telemetry/user-count', { subdomain: 'api', requireAuth: true }, async (req, res) => {
    const { app_uuid } = req.query as Record<string, string>;
    if ( ! app_uuid ) throw new HttpError(400, 'Missing `app_uuid`');

    const app = await stores.app.getByUid(app_uuid);
    if ( ! app ) throw new HttpError(404, 'App not found');

    const [row] = await clients.db.read(
        `SELECT COUNT(*) AS n FROM user_to_app_permissions
         WHERE permission = 'flag:app-is-authenticated' AND app_id = ?`,
        [(app as Record<string, unknown>).id],
    ) as Array<{ n: number }>;

    res.json({ count: row?.n ?? 0 });
});
