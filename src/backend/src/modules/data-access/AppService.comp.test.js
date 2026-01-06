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

/*
// CRITICAL: Mock BOTH Context modules (CommonJS and ESM) BEFORE any other imports
// CommonJS modules use '../../util/context', ESM modules use '../../util/esmcontext.js'
vi.mock('../../util/context', async () => {
    const actual = await vi.importActual('../../util/context');
    const { Context: OriginalContext } = actual;

    // Store original get method BEFORE patching
    const originalGet = OriginalContext.get;

    // Store test values
    let testContext = null;
    let testActor = null;
    let testUser = null;

    // Patch Context.get to use test values
    OriginalContext.get = function(key, options) {
        // Check test values FIRST
        if (key === 'actor' && testActor) {
            return testActor;
        }
        if (key === 'user' && testUser) {
            return testUser;
        }

        // Call original get method
        return originalGet.call(this, key, options);
    };

    // Export patched Context with setters for test values
    return {
        ...actual,
        Context: OriginalContext,
        __setTestValues: (ctx, actor, user) => {
            testContext = ctx;
            testActor = actor;
            testUser = user;
        },
        __clearTestValues: () => {
            testContext = null;
            testActor = null;
            testUser = null;
        },
    };
});

vi.mock('../../util/esmcontext.js', async () => {
    const actual = await vi.importActual('../../util/esmcontext.js');
    const { Context: OriginalContext } = actual;

    // Store original get method BEFORE patching
    const originalGet = OriginalContext.get;

    // Store test values
    let testContext = null;
    let testActor = null;
    let testUser = null;

    // Patch Context.get to use test values
    OriginalContext.get = function(key, options) {
        // Check test values FIRST
        if (key === 'actor' && testActor) {
            return testActor;
        }
        if (key === 'user' && testUser) {
            return testUser;
        }

        // Call original get method
        return originalGet.call(this, key, options);
    };

    // Export patched Context with setters for test values
    return {
        ...actual,
        Context: OriginalContext,
        __setTestValues: (ctx, actor, user) => {
            testContext = ctx;
            testActor = actor;
            testUser = user;
        },
        __clearTestValues: () => {
            testContext = null;
            testActor = null;
            testUser = null;
        },
    };
});

// Store test values globally - this is the most reliable approach
let globalTestActor = null;
let globalTestUser = null;

// Patch Context.get directly (after imports) - this MUST work
// We patch it on the actual Context class that's imported
const originalContextGet = Context.get;
Context.get = function(key, options) {
    // ALWAYS check global test values FIRST - this is the most reliable
    if (key === 'actor' && globalTestActor) {
        return globalTestActor;
    }
    if (key === 'user' && globalTestUser) {
        return globalTestUser;
    }
    // Call original
    return originalContextGet.call(this, key, options);
};

// Also patch the Context class that CommonJS modules might have cached
// Intercept require() calls to context.js and ensure they get our patched version
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    const result = originalRequire.call(this, id);
    // If this is context.js, patch its Context.get
    if (id.includes('util/context') && result && result.Context) {
        const originalGet = result.Context.get;
        result.Context.get = function(key, options) {
            if (key === 'actor' && globalTestActor) {
                return globalTestActor;
            }
            if (key === 'user' && globalTestUser) {
                return globalTestUser;
            }
            return originalGet.call(this, key, options);
        };
    }
    return result;
};
*/

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

const fixContextInitialization = async (callback) => {
    process.stdout.write(`contextAsyncLocalStorage:${ Context.contextAsyncLocalStorage }\n`);
    try {
        return Context.contextAsyncLocalStorage.run(Context.root, () => {
            Context.contextAsyncLocalStorage.getStore().set('context', Context.root);
            callback();
        });
    } catch (e) {
        process.stdout.write(e.stack);
    }
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
                // Context initialization fix

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
                    // Set test values in BOTH mocked Context modules AND globally
                    // globalTestActor = actor;
                    // globalTestUser = user;

                    const contextCJS = require('../../util/context');
                    const contextESM = await import('../../util/esmcontext.js');
                    if ( contextCJS.__setTestValues ) contextCJS.__setTestValues(userContext, actor, user);
                    if ( contextESM.__setTestValues ) contextESM.__setTestValues(userContext, actor, user);

                    process.stdout.write(`actor: ${actor}\n`);
                    process.stdout.write(`context root from test: ${Context.get('rootContextUUID')}\n`);

                    try {
                        const service = kernel.services.get(key);
                        const crudQ = service.constructor.IMPLEMENTS['crud-q'];
                        await crudQ.create.call(service, {
                            object: {
                                name: 'test-app',
                                title: 'Test App',
                                index_url: 'https://example.com',
                            },
                        });
                    } finally {
                        // Clear after test
                        // globalTestActor = null;
                        // globalTestUser = null;

                        const contextCJS = require('../../util/context');
                        const contextESM = await import('../../util/esmcontext.js');
                        if ( contextCJS.__clearTestValues ) contextCJS.__clearTestValues();
                        if ( contextESM.__clearTestValues ) contextESM.__clearTestValues();
                    }
                });
            });
        });
    });
});
