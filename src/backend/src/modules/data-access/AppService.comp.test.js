import { createTestKernel } from '../../../tools/test.mjs';
import { tmp_provide_services } from '../../helpers.js';
import AppES from '../../om/entitystorage/AppES';
import { AppLimitedES } from '../../om/entitystorage/AppLimitedES';
import { ESBuilder } from '../../om/entitystorage/ESBuilder';
import { MaxLimitES } from '../../om/entitystorage/MaxLimitES';
import { ProtectedAppES } from '../../om/entitystorage/ProtectedAppES';
import { SetOwnerES } from '../../om/entitystorage/SetOwnerES';
import SQLES from '../../om/entitystorage/SQLES';
import ValidationES from '../../om/entitystorage/ValidationES';
import WriteByOwnerOnlyES from '../../om/entitystorage/WriteByOwnerOnlyES';
import { Eq, Or } from '../../om/query/query';
import { Actor, UserActorType } from '../../services/auth/Actor';
import { EntityStoreService } from '../../services/EntityStoreService';
import { Context } from '../../util/esmcontext.js';
import { AppIconService } from '../apps/AppIconService';
import { AppInformationService } from '../apps/AppInformationService';
import { OldAppNameService } from '../apps/OldAppNameService';
import AppService from './AppService';

import { describe, expect, it } from 'vitest';

const ES_APP_ARGS = {
    entity: 'app',
    upstream: ESBuilder.create([
        SQLES, { table: 'app', debug: true },
        AppES,
        AppLimitedES, {
            permission_prefix: 'apps-of-user',
            exception: async () => {
                const actor = Context.get('actor');
                return new Or({
                    children: [
                        new Eq({
                            key: 'approved_for_listing',
                            value: 1,
                        }),
                        new Eq({
                            key: 'uid',
                            value: actor.type.app.uid,
                        }),
                    ],
                });
            },
        },
        WriteByOwnerOnlyES,
        ValidationES,
        SetOwnerES,
        ProtectedAppES,
        MaxLimitES, { max: 5000 },
    ]),
};

// Fix: Manually initialize AsyncLocalStorage store for Vitest
// Under Vitest, AsyncLocalStorage may not have a store initialized, causing Context.get() to fail.
// This manually creates a store and sets the root context, ensuring Context operations work.
// This may be a side-effect of OpenTelemetry's own use of AsyncLocalStorage.
const fixContextInitialization = async (callback) => {
    return await Context.contextAsyncLocalStorage.run(Context.root, async () => {
        Context.contextAsyncLocalStorage.getStore().set('context', Context.root);
        return await callback();
    });
};

const testWithEachService = async (fnToRunOnBoth) => {
    const esAppTestKernel = await createTestKernel({
        testCore: true,
        initLevelString: 'init',
        serviceMap: {
            'app-information': AppInformationService,
            'app-icon': AppIconService,
            'old-app-name': OldAppNameService,
            'es:app': EntityStoreService,
        },
        serviceMapArgs: {
            'es:app': ES_APP_ARGS,
        },
    });
    await tmp_provide_services(esAppTestKernel.services);

    const appTestKernel = await createTestKernel({
        testCore: true,
        initLevelString: 'init',
        serviceMap: {
            'app-information': AppInformationService,
            'app-icon': AppIconService,
            'old-app-name': OldAppNameService,
            'app': AppService,
        },
    });
    await tmp_provide_services(appTestKernel.services);

    await fnToRunOnBoth({ kernel: esAppTestKernel, key: 'es:app' });
    await fnToRunOnBoth({ kernel: appTestKernel, key: 'app' });

    // Expect these tables to have the same values:
    const relevant_tables = ['apps', 'app_filetype_association'];
    const db_esApp = esAppTestKernel.services.get('database').get('write', 'test');
    const db_app = appTestKernel.services.get('database').get('write', 'test');
    for ( const table_name of relevant_tables ) {
        const rows_esApp = db_esApp.read(`SELECT * FROM ${table_name}`);
        const rows_app = db_app.read(`SELECT * FROM ${table_name}`);
        expect(rows_app).toEqual(rows_esApp);
    }
};

describe('AppService Regression Prevention Tests', () => {
    it('should be testable with two test kernels', async () => {
        await testWithEachService(() => {
        });
    });
    it('should create the app', async () => {
        await fixContextInitialization(async () => {
            await testWithEachService(async ({ kernel, key }) => {
                // Create a test user and context
                const db = kernel.services.get('database').get('write', 'test');
                const userId = 1;
                const username = 'testuser';
                const uuid = `user-uuid-${userId}`;

                // Insert the user into the database if not exists
                const existingUser = await kernel.services.get('database')
                    .get('read', 'test')
                    .read('SELECT * FROM user WHERE uuid = ?', [uuid]);

                if ( existingUser.length === 0 ) {
                    await db.write('INSERT INTO user (uuid, username, free_storage) VALUES (?, ?, ?)',
                                    [uuid, username, 1024 * 1024 * 1024]);
                }

                // Read the user back to get the actual id
                const users = await kernel.services.get('database')
                    .get('read', 'test')
                    .read('SELECT * FROM user WHERE uuid = ?', [uuid]);

                const user = users[0];
                if ( ! user ) {
                    throw new Error('Failed to create or retrieve test user');
                }

                const actor = await Actor.create(UserActorType, { user });
                if ( !actor || !actor.type ) {
                    throw new Error('Failed to create actor');
                }

                const userContext = kernel.root_context.sub({
                    user,
                    actor,
                });

                await userContext.arun(async () => {
                    Context.set('actor', actor);
                    const service = kernel.services.get(key);
                    const crudQ = service.constructor.IMPLEMENTS['crud-q'];
                    await crudQ.create.call(service, {
                        object: {
                            name: 'test-app',
                            title: 'Test App',
                            index_url: 'https://example.com',
                        },
                    });
                });
            });
        });
    });
});
