import { MeteringService } from '@heyputer/backend/src/services/MeteringService/MeteringService.js';

const { Controller, Get, ExtensionController } = extension.import('extensionController');

@Controller('/metering')
export class UsageController extends ExtensionController {

    #meteringService: MeteringService;

    constructor (meteringService: MeteringService) {
        super();
        this.#meteringService = meteringService;
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

    @Get('usage/:appId', { subdomain: 'api' })
    async getUsageByApp (req, res) {
        const actor = req.actor;
        if ( ! actor ) {
            throw Error('actor not found in context');
        }
        const appId = req.params.appId;
        if ( ! appId ) {
            res.status(400).json({ error: 'appId parameter is required' });
            return;
        }

        const appUsage = await this.#meteringService.getActorCurrentMonthAppUsageDetails(actor, appId);
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

export const registerUsageController = () => {
    const controller = new UsageController(extension.import('service:meteringService'));
    controller.registerRoutes();
    console.debug('Loaded /metering/usage routes');
};
