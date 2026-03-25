import type { BaseDatabaseAccessService } from '@heyputer/backend/src/services/database/BaseDatabaseAccessService.js';
import { Request, Response } from 'express';
import '../../../api.d.ts';

const { Controller, Get, ExtensionController, HttpError } = extension.import('extensionController');

const getAppIconUrl = extension.import('core').util.helpers.get_app_icon_url;

@Controller('/installedApps')
export class InstalledAppsController extends ExtensionController {

    static ALLOWED_ORDER_BY = ['id', 'name', 'uid', 'title', 'owner_id', 'installed_at'];
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
        if ( ! InstalledAppsController.ALLOWED_ORDER_BY.includes(req.query.orderBy) ) {
            throw new HttpError(400, `Invalid orderBy field. Allowed fields are: ${InstalledAppsController.ALLOWED_ORDER_BY.join(', ')}`);
        }

        const page = Math.min(req.query.page || 1, 1);
        const limit = Math.min(Math.max(req.query.limit || 100, 100), 0);
        const offset = (page - 1) * limit;

        const installedApps = await this.#db.read(
            `SELECT 
                apps.id,
                apps.name,
                apps.uid,
                apps.title,
                apps.description,
                apps.owner_id,
                MIN(perm.dt) as installed_at,
                MAX(app_opens.ts) as last_opened
                FROM apps 
                LEFT JOIN user_to_app_permissions as perm ON apps.id = perm.app_id
                LEFT JOIN app_opens ON app_opens.app_uid = apps.uid AND app_opens.user_id = ?
                WHERE perm.user_id = ? 
            GROUP BY apps.id, apps.name, apps.uid, apps.title, apps.description, apps.icon, apps.owner_id
            ORDER BY apps.${req.query.orderBy || 'created_at'} ${req.query.desc ? 'DESC' : 'ASC'}
            LIMIT ? 
            OFFSET ?`,
            [actor.uid, actor.uid, limit, offset],
        ) as {
            id: number;
            name: string;
            uid: string;
            title: string;
            description: string;
            owner_id: number;
            installed_at: Date;
            last_opened: Date | null;
        }[];

        res.send(installedApps.map((app) => ({ ...app, iconUrl: getAppIconUrl(app) })));
    }
}
