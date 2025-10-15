/** @type {import('@heyputer/backend/src/services/MeteringService/MeteringServiceWrapper.mjs').MeteringAndBillingServiceWrapper} */
const meteringAndBillingServiceWrapper = extension.import('service:meteringService');

// TODO DS: move this to its own router and just use under this path
extension.get('/meteringAndBilling/usage', { subdomain: 'api' }, async (req, res) => {
    const meteringAndBillingService = meteringAndBillingServiceWrapper.meteringAndBillingService;

    const actor = req.actor;
    if ( !actor ) {
        throw Error('actor not found in context');
    }
    const actorUsagePromise = meteringAndBillingService.getActorCurrentMonthUsageDetails(actor);
    const actorAllowenceInfoPromise = meteringAndBillingService.getAllowedUsage(actor);

    const [actorUsage, allowenceInfo] = await Promise.all([actorUsagePromise, actorAllowenceInfoPromise]);
    res.status(200).json({ ...actorUsage, allowenceInfo });
    return;
});

extension.get('/meteringAndBilling/usage/:appId', { subdomain: 'api' }, async (req, res) => {
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

console.debug('Loaded /meteringAndBilling/usage route');