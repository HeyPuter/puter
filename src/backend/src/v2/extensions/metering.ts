import { extension } from '../extensions';
import { HttpError } from '../core/http/HttpError';
import { Context } from '../core/context';

const services = extension.import('service');
const clients  = extension.import('client');

extension.get('/metering/usage', { subdomain: 'api', requireAuth: true }, async (req, res) => {
    const actor = Context.get('actor');
    if ( ! actor?.user ) throw new HttpError(401, 'Authentication required');

    const [actorUsage, allowanceInfo] = await Promise.all([
        services.metering.getActorCurrentMonthUsageDetails(actor),
        services.metering.getAllowedUsage(actor),
    ]);
    res.json({ ...actorUsage, allowanceInfo });
});

extension.get('/metering/usage/:appIdOrName', { subdomain: 'api', requireAuth: true }, async (req, res) => {
    const actor = Context.get('actor');
    if ( ! actor?.user ) throw new HttpError(401, 'Authentication required');

    let appId = String(req.params.appIdOrName ?? '');
    if ( ! appId ) throw new HttpError(400, 'appId parameter is required');

    // If not a UUID-shaped app UID, look up by name
    if ( ! appId.startsWith('app-') ) {
        const appRows = await clients.db.read(
            'SELECT `uid` FROM `apps` WHERE `name` = ? LIMIT 1',
            [appId],
        ) as Array<{ uid: string }>;
        if ( appRows.length > 0 ) {
            appId = appRows[0].uid;
        } else {
            throw new HttpError(404, 'App not found');
        }
    }

    const appUsage = await services.metering.getActorCurrentMonthAppUsageDetails(actor, appId);
    res.json(appUsage);
});

extension.get('/metering/globalUsage', { subdomain: 'api', adminOnly: true }, async (_req, res) => {
    const globalUsage = await services.metering.getGlobalUsage();
    res.json(globalUsage);
});
