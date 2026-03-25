import type { BaseDatabaseAccessService } from '@heyputer/backend/src/services/database/BaseDatabaseAccessService.js';
import { Request, Response } from 'express';
import type { } from '../../../api.js';

const { Controller, Get, ExtensionController, HttpError } = extension.import('extensionController');

const getAppIconUrl = extension.import('core').util.helpers.get_app_icon_url;

@Controller('/installedApps')
export class InstalledAppsController extends ExtensionController {

    static ALLOWED_ORDER_BY = ['id', 'name', 'uid', 'title', 'installed_at'];
    static ORDER_BY_FIELD_MAP: Record<string, string> = {
        id: 'apps.id',
        name: 'apps.name',
        uid: 'apps.uid',
        title: 'apps.title',
        installed_at: 'installed_at',
    };
    #db: BaseDatabaseAccessService;
    constructor (db: BaseDatabaseAccessService) {
        super();
        this.#db = db;
    }

    @Get('/', { subdomain: 'api' })
    async getInstalledApps (req: Request<null, null, null, { orderBy: string, desc: boolean, page: number, limit: number }>, res: Response): Promise<void> {
        const actor = req.actor;
        if ( ! actor ) {
            throw Error('actor not found in context');
        }
        if ( actor.type.app ) {
            throw new HttpError(403, 'Apps are not allowed to access this resource');
        }
        req.query.orderBy ??= 'installed_at';
        if ( ! InstalledAppsController.ALLOWED_ORDER_BY.includes(req.query.orderBy) ) {
            throw new HttpError(400, `Invalid orderBy field. Allowed fields are: ${InstalledAppsController.ALLOWED_ORDER_BY.join(', ')}`);
        }

        const page = Math.max(req.query.page || 1, 1);
        const limit = Math.min(Math.max(req.query.limit || 100, 1), 100);
        const offset = (page - 1) * limit;
        const orderByField = InstalledAppsController.ORDER_BY_FIELD_MAP[req.query.orderBy];
        const sortDirection = req.query.desc ? 'DESC' : 'ASC';

        const installedApps = await this.#db.read(
            `SELECT
                apps.id,
                apps.name,
                apps.uid,
                apps.title,
                apps.description,
                MIN(perm.dt) AS installed_at,
                MAX(app_opens.ts) AS last_opened
            FROM apps
            LEFT JOIN user_to_app_permissions AS perm ON apps.id = perm.app_id
            LEFT JOIN app_opens ON app_opens.app_uid = apps.uid AND app_opens.user_id = ?
            WHERE perm.user_id = ?
            GROUP BY apps.id, apps.name, apps.uid, apps.title, apps.description
            ORDER BY ${orderByField} ${sortDirection}
            LIMIT ?
            OFFSET ?`,
            [actor.type.user.id, actor.type.user.id, limit, offset],
        ) as {
            id: number;
            name: string;
            uid: string;
            title: string;
            description: string;
            installed_at: Date;
            last_opened: Date | null;
        }[];

        res.send(installedApps.map((app) => ({ ...app, iconUrl: getAppIconUrl(app) })));
    }
}
