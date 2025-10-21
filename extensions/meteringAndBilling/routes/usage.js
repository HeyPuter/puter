/** @type {import('@heyputer/backend/src/services/MeteringService/MeteringServiceWrapper.mjs').MeteringServiceWrapper} */
const meteringServiceWrapper = extension.import('service:meteringService');

// TODO DS: move this to its own router and just use under this path
extension.get('/metering/usage', { subdomain: 'api' }, async (req, res) => {
    const meteringService = meteringServiceWrapper.meteringService;

    const actor = req.actor;
    if ( !actor ) {
        throw Error('actor not found in context');
    }
    const actorUsagePromise = meteringService.getActorCurrentMonthUsageDetails(actor);
    const actorAllowanceInfoPromise = meteringService.getAllowedUsage(actor);

    const [actorUsage, allowanceInfo] = await Promise.all([actorUsagePromise, actorAllowanceInfoPromise]);
    res.status(200).json({ ...actorUsage, allowanceInfo });
    return;
});

extension.get('/metering/usage/:appId', { subdomain: 'api' }, async (req, res) => {
    const meteringService = meteringServiceWrapper.meteringService;

    const actor = req.actor;
    if ( !actor ) {
        throw Error('actor not found in context');
    }
    const appId = req.params.appId;
    if ( !appId ) {
        res.status(400).json({ error: 'appId parameter is required' });
        return;
    }

    const appUsage = await meteringService.getActorCurrentMonthAppUsageDetails(actor, appId);
    res.status(200).json(appUsage);
    return;
});

console.debug('Loaded /metering/usage route');