import type { BaseDatabaseAccessService } from '@heyputer/backend/src/services/database/BaseDatabaseAccessService.js';
import type { MeteringService } from '@heyputer/backend/src/services/MeteringService/MeteringService.js';

const { Controller, Get, ExtensionController } = extension.import('extensionController');

@Controller('/metering')
export class UsageController extends ExtensionController {
    #meteringService: MeteringService;
    #sqlClient: BaseDatabaseAccessService;

    constructor (
        meteringService: MeteringService,
        sqlClient: BaseDatabaseAccessService,
    ) {
        super();
        this.#meteringService = meteringService;
        this.#sqlClient = sqlClient;
    }

    @Get('usage', { subdomain: 'api' })
    async getUsage (req, res) {
        const actor = req.actor;
        if ( ! actor ) {
            throw Error('actor not found in context');
        }
        const actorUsagePromise = this.#meteringService.getActorCurrentMonthUsageDetails(actor);
        const actorAllowanceInfoPromise = this.#meteringService.getAllowedUsage(actor);

        const [actorUsage, allowanceInfo] = await Promise.all([
            actorUsagePromise,
            actorAllowanceInfoPromise,
        ]);
        res.status(200).json({ ...actorUsage, allowanceInfo });
        return;
    }

    @Get('usage/:appIdOrName', { subdomain: 'api' })
    async getUsageByApp (req, res) {
        const actor = req.actor;
        if ( ! actor ) {
            throw Error('actor not found in context');
        }
        const appIdOrName = req.params.appIdOrName;
        if ( ! appIdOrName ) {
            res.status(400).json({ error: 'appId parameter is required' });
            return;
        }

        let appId = appIdOrName;
        if ( !appIdOrName.startsWith('app-') || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appIdOrName.split('app-')[1]) ) {
            // Check if the part after 'app-' is a valid UUID (v4)
            const appRows = await this.#sqlClient.read('SELECT `uid` FROM `apps` WHERE `name` = ? LIMIT 1',
                            [appIdOrName]);
            if ( appRows.length > 0 ) {
                appId = appRows[0].uid;
            } else {
                res.status(404).json({ error: 'App not found' });
                return;
            }
        } else {
            appId = appIdOrName;
        }

        const appUsage =
            await this.#meteringService.getActorCurrentMonthAppUsageDetails(actor,
                            appId);

        res.status(200).json(appUsage);
        return;
    }

    @Get('globalUsage', { subdomain: 'api' }, extension.config.allowedGlobalUsageUsers || [])
    async getGlobalUsage (req, res) {
        const actor = req.actor;
        if ( ! actor ) {
            throw Error('actor not found in context');
        }

        const globalUsage = await this.#meteringService.getGlobalUsage();
        res.status(200).json(globalUsage);
        return;
    }
}
