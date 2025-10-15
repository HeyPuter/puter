extension.on('metering:overrideDefaultSubscription', async (/** @type {{actor: import('@heyputer/backend/src/services/auth/Actor').Actor, defaultSubscription: string}} */event) => {
    // bit of a stub implementation for OSS, technically can be always free if you set this config true
    if ( config.unlimitedUsage ) {
        console.warn('WARNING!!! unlimitedUsage is enabled, this is not recommended for production use');
        event.defaultSubscriptionId = 'unlimited';
    }
});

extension.on('metering:registerAvailablePolicies', async (
    /** @type {{actor: import('@heyputer/backend/src/services/auth/Actor').Actor, availablePolicies: unknown[]}} */event) => {
    // bit of a stub implementation for OSS, technically can be always free if you set this config true
    if ( config.unlimitedUsage ) {
        console.warn('WARNING!!! unlimitedUsage is enabled, this is not recommended for production use');
        event.availablePolicies.push({
            id: 'unlimited',
            monthUsageAllowance: 500_000_000 * 100_000_000, // unless you're like, jeff's, mark's and elon's illegitamate son, you probably won't hit $5m a month
            monthlyStorageAllowance: 100_000 * 1024 * 1024, // 100MiB
        });
    }
});

extension.on('metering:getUserSubscription', async (/** @type {{actor: import('@heyputer/backend/src/services/auth/Actor').Actor, userSubscription: string}} */event) => {
    event.userSubscriptionId = event.actor.type.user.subscription.tier;
});
