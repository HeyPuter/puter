const meteringAndBillingService = extension.import('service:meteringService');

extension.get('/v2/usage', { subdomain: 'api' }, async (req, res) => {
    const actor = req.actor;
    if ( !actor ) {
        throw Error('actor not found in context');
    }
    const actorUsage = await meteringAndBillingService.getActorCurrentMonthUsageSummary(actor);
    res.json(actorUsage);
});
