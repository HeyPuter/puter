// Augments returned `App` objects with the `getUsers()` page fetcher and the
// `users()` async iterator, backed by the app-telemetry driver. Shared by
// every method that returns apps (create/update/get/list).

/** @typedef {import('../../../../types/puter').Puter} Puter */
/** @typedef {import('../../../../types/modules/apps').App} App */

/**
 * @param {Puter} puter
 * @param {App} app
 * @returns {App}
 */
export const addUserIteration = (puter, app) => {
    app.getUsers = async (params) => {
        params = params ?? {};
        return (await puter.drivers.call('app-telemetry', 'app-telemetry', 'get_users', {
            app_uuid: app.uid,
            limit: params.limit,
            offset: params.offset,
        })).result;
    };

    app.users = async function* (pageSize = 100) {
        let offset = 0;
        while ( true ) {
            const users = await app.getUsers({ limit: pageSize, offset });
            if ( !users || users.length === 0 ) return;
            for ( const user of users ) yield user;
            offset += users.length;
            if ( users.length < pageSize ) return;
        }
    };

    return app;
};

/**
 * @param {Puter} puter
 * @param {App[]} apps
 * @returns {App[]}
 */
export const addUserIterationToApps = (puter, apps) => {
    apps.forEach(app => addUserIteration(puter, app));
    return apps;
};
