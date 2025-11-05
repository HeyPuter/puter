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
    if ( config.unlimitedUsage || config.unlimitedAllowList?.length ) {
        event.availablePolicies.push({
            id: 'unlimited',
            monthUsageAllowance: 5_000_000 * 1_000_000 * 100, // unless you're like, jeff's, mark's, and elon's illegitamate son, you probably won't hit $5m a month
            monthlyStorageAllowance: 100_000 * 1024 * 1024, // 100MiB but ignored in local dev
        });
    }
});

extension.on('metering:getUserSubscription', async (/** @type {{actor: import('@heyputer/backend/src/services/auth/Actor').Actor, userSubscriptionId: string}} */event) => {
    const userName = event?.actor?.type?.user?.username;
    if ( config.unlimitedAllowList?.includes(userName) ) {
        event.userSubscriptionId;
    }
    else {
        event.userSubscriptionId = event?.actor?.type?.user?.subscription?.active ? event.actor.type.user.subscription?.tier : undefined;
    }
    // default location for user sub, but can techinically be anywhere else or fetched on request
});
