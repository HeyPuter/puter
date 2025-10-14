/** @type {import('@heyputer/backend/src/services/MeteringService/MeteringServiceWrapper.mjs').MeteringAndBillingServiceWrapper} */
const meteringAndBillingServiceWrapper = extension.import('service:meteringService');

// TODO DS: move this to its own router and just use under this path
extension.get('/v2/usage', { subdomain: 'api' }, async (req, res) => {
    const meteringAndBillingService = meteringAndBillingServiceWrapper.meteringAndBillingService;

    const actor = req.actor;
    if ( !actor ) {
        throw Error('actor not found in context');
    }
    const actorUsage = await meteringAndBillingService.getActorCurrentMonthUsageDetails(actor);
    res.status(200).json(actorUsage);
    return;
});

extension.get('/v2/usage/:appId', { subdomain: 'api' }, async (req, res) => {
    const meteringAndBillingService = meteringAndBillingServiceWrapper.meteringAndBillingService;

    const actor = req.actor;
    if ( !actor ) {
        throw Error('actor not found in context');
    }
    const appId = req.params.appId;
    if ( !appId ) {
        res.status(400).json({ error: 'appId parameter is required' });
        return;
    }

    const appUsage = await meteringAndBillingService.getActorCurrentMonthAppUsageDetails(actor, appId);
    res.status(200).json(appUsage);
    return;
});

console.debug('Loaded /v2/usage route');