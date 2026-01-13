import { createTestKernel } from '../../../tools/test.mjs';
import helpers from '../../helpers.js';
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
import { VirtualGroupService } from '../../services/auth/VirtualGroupService';
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

const testWithEachService = async (fnToRunOnBoth, {
    fnToRunOnTheOther,
} = {}) => {
    return await fixContextInitialization(async () => {
        const setupUserAndRunWithContext = async (params, fn) => {
            const { kernel, key } = params;
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
                await fn({ ...params, user, actor });
            });
        };

        const esAppTestKernel = await createTestKernel({
            testCore: true,
            initLevelString: 'init',
            serviceMap: {
                'app-information': AppInformationService,
                'app-icon': AppIconService,
                'old-app-name': OldAppNameService,
                'virtual-group': VirtualGroupService,
                'es:app': EntityStoreService,
            },
            serviceMapArgs: {
                'es:app': ES_APP_ARGS,
            },
        });
        await helpers.tmp_provide_services(esAppTestKernel.services);

        const appTestKernel = await createTestKernel({
            testCore: true,
            initLevelString: 'init',
            serviceMap: {
                'app-information': AppInformationService,
                'app-icon': AppIconService,
                'old-app-name': OldAppNameService,
                'virtual-group': VirtualGroupService,
                'app': AppService,
            },
        });
        await helpers.tmp_provide_services(appTestKernel.services);

        helpers.tmp_provide_services(appTestKernel.services);
        await setupUserAndRunWithContext({ kernel: appTestKernel, key: 'app' }, fnToRunOnBoth);
        helpers.tmp_provide_services(esAppTestKernel.services);
        if ( fnToRunOnTheOther ) {
            await setupUserAndRunWithContext({ kernel: esAppTestKernel, key: 'es:app' }, fnToRunOnTheOther);
        } else {
            await setupUserAndRunWithContext({ kernel: esAppTestKernel, key: 'es:app' }, fnToRunOnBoth);
        }

        // Expect these tables to have the same values:
        const relevant_tables = ['apps', 'app_filetype_association'];
        // Fields that are expected to differ (auto-generated UUIDs, timestamps)
        const volatile_fields = ['uid', 'uuid', 'timestamp'];
        const stripVolatile = (rows) => rows.map(row => {
            const copy = { ...row };
            for ( const field of volatile_fields ) {
                delete copy[field];
            }
            return copy;
        });

        const db_esApp = esAppTestKernel.services.get('database').get('write', 'test');
        const db_app = appTestKernel.services.get('database').get('write', 'test');
        for ( const table_name of relevant_tables ) {
            const rows_esApp = await db_esApp.read(`SELECT * FROM ${table_name}`);
            const rows_app = await db_app.read(`SELECT * FROM ${table_name}`);
            expect(stripVolatile(rows_app)).toEqual(stripVolatile(rows_esApp));
        }
    });
};

describe('AppService Regression Prevention Tests', () => {
    it('should be testable with two test kernels', async () => {
        await testWithEachService(() => {
        });
    });
    it('test utility detects database deviations as expected', async () => {
        // This should fail because we create apps with different names
        let assertionErrorThrown = false;
        try {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];
                await crudQ.create.call(service, {
                    object: {
                        name: 'test-app',
                        title: 'Test App',
                        index_url: 'https://example.com',
                    },
                });
            },
            {
                fnToRunOnTheOther: async ({ kernel, key }) => {
                    const service = kernel.services.get(key);
                    const crudQ = service.constructor.IMPLEMENTS['crud-q'];
                    // Create app with DIFFERENT name to cause deviation
                    await crudQ.create.call(service, {
                        object: {
                            name: 'different-app', // Different name!
                            title: 'Different Test App',
                            index_url: 'https://example.com',
                        },
                    });
                },
            });
        } catch ( error ) {
            // Vitest assertion errors are thrown when expect() fails
            // Check if it's an AssertionError or has assertion-related properties
            if ( error.name === 'AssertionError' ||
                error.constructor.name === 'AssertionError' ||
                (error.message && error.message.includes('toEqual')) ) {
                assertionErrorThrown = true;
            } else {
                // Re-throw if it's not an assertion error
                throw error;
            }
        }
        // Verify that the assertion error was thrown (meaning deviation was detected)
        expect(assertionErrorThrown).toBe(true);
    });

    describe('create', () => {
        it('should create the app', async () => {
            await testWithEachService(async ({ kernel, key }) => {
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

    describe('read', () => {
        it('should read app by uid', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create an app
                const created = await crudQ.create.call(service, {
                    object: {
                        name: 'read-test-app',
                        title: 'Read Test App',
                        index_url: 'https://example.com',
                    },
                });

                // Read it back by uid
                const read = await crudQ.read.call(service, { uid: created.uid });
                expect(read).toBeDefined();
                expect(read.name).toBe('read-test-app');
                expect(read.title).toBe('Read Test App');
            });
        });

        it('should read app by name', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create an app
                await crudQ.create.call(service, {
                    object: {
                        name: 'named-app',
                        title: 'Named App',
                        index_url: 'https://example.com',
                    },
                });

                // Read it back by name
                const read = await crudQ.read.call(service, { id: { name: 'named-app' } });
                expect(read).toBeDefined();
                expect(read.name).toBe('named-app');
                expect(read.title).toBe('Named App');
            });
        });

        it('should throw error for non-existent app', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Try to read a non-existent app - should throw entity_not_found
                let errorThrown = false;
                try {
                    await crudQ.read.call(service, { uid: 'app-nonexistent-uid' });
                } catch ( error ) {
                    errorThrown = true;
                    const code = error.fields?.code || error.code;
                    expect(code).toBe('entity_not_found');
                }
                expect(errorThrown).toBe(true);
            });
        });
    });

    describe('update', () => {
        it('should update title and description', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create an app
                const created = await crudQ.create.call(service, {
                    object: {
                        name: 'update-test-app',
                        title: 'Original Title',
                        description: 'Original description',
                        index_url: 'https://example.com',
                    },
                });

                // Update it
                const updated = await crudQ.update.call(service, {
                    object: { uid: created.uid },
                    id: { name: 'update-test-app' },
                    options: {},
                });

                // Verify update worked - the object fields should be merged
                await crudQ.update.call(service, {
                    object: {
                        uid: created.uid,
                        title: 'Updated Title',
                        description: 'Updated description',
                    },
                    id: { name: 'update-test-app' },
                });

                const read = await crudQ.read.call(service, { uid: created.uid });
                expect(read.title).toBe('Updated Title');
                expect(read.description).toBe('Updated description');
            });
        });

        it('should update index_url', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create an app
                const created = await crudQ.create.call(service, {
                    object: {
                        name: 'url-update-app',
                        title: 'URL Update App',
                        index_url: 'https://old-url.com',
                    },
                });

                // Update index_url
                await crudQ.update.call(service, {
                    object: {
                        uid: created.uid,
                        index_url: 'https://new-url.com',
                    },
                    id: { name: 'url-update-app' },
                });

                const read = await crudQ.read.call(service, { uid: created.uid });
                expect(read.index_url).toBe('https://new-url.com');
            });
        });

        it('should update with filetype_associations', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create an app
                const created = await crudQ.create.call(service, {
                    object: {
                        name: 'filetype-app',
                        title: 'Filetype App',
                        index_url: 'https://example.com',
                    },
                });

                // Update with filetype associations
                await crudQ.update.call(service, {
                    object: {
                        uid: created.uid,
                        filetype_associations: ['txt', 'md', 'json'],
                    },
                    id: { name: 'filetype-app' },
                });

                const read = await crudQ.read.call(service, { uid: created.uid });
                expect(read.filetype_associations).toEqual(
                                expect.arrayContaining(['txt', 'md', 'json']));
            });
        });

        it('should update name with dedupe_name option', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create two apps
                await crudQ.create.call(service, {
                    object: {
                        name: 'taken-name',
                        title: 'First App',
                        index_url: 'https://example.com',
                    },
                });

                const second = await crudQ.create.call(service, {
                    object: {
                        name: 'second-app',
                        title: 'Second App',
                        index_url: 'https://example.com',
                    },
                });

                // Try to update second app to use first app's name with dedupe
                await crudQ.update.call(service, {
                    object: {
                        uid: second.uid,
                        name: 'taken-name',
                    },
                    id: { name: 'second-app' },
                    options: { dedupe_name: true },
                });

                const read = await crudQ.read.call(service, { uid: second.uid });
                // Should have been deduped to taken-name-1
                expect(read.name).toBe('taken-name-1');
            });
        });

        it('should throw error when updating non-existent app', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                let errorThrown = false;
                try {
                    await crudQ.update.call(service, {
                        object: {
                            uid: 'app-nonexistent',
                            title: 'New Title',
                        },
                        id: { name: 'nonexistent-app' },
                    });
                } catch ( error ) {
                    errorThrown = true;
                    // Error code is in fields.code for APIError
                    const code = error.fields?.code || error.code;
                    expect(code).toBe('entity_not_found');
                }
                expect(errorThrown).toBe(true);
            });
        });
    });

    describe('upsert', () => {
        it('should create when app does not exist', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Upsert a new app (should create)
                const result = await crudQ.upsert.call(service, {
                    object: {
                        name: 'upsert-new-app',
                        title: 'Upsert New App',
                        index_url: 'https://example.com',
                    },
                });

                expect(result).toBeDefined();
                expect(result.name).toBe('upsert-new-app');

                // Verify it was created
                const read = await crudQ.read.call(service, { id: { name: 'upsert-new-app' } });
                expect(read).toBeDefined();
                expect(read.title).toBe('Upsert New App');
            });
        });

        it('should update when app exists', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create an app first
                const created = await crudQ.create.call(service, {
                    object: {
                        name: 'upsert-existing-app',
                        title: 'Original Title',
                        index_url: 'https://example.com',
                    },
                });

                // Upsert with same uid (should update)
                await crudQ.upsert.call(service, {
                    object: {
                        uid: created.uid,
                        title: 'Updated via Upsert',
                    },
                    id: { name: 'upsert-existing-app' },
                });

                // Verify it was updated
                const read = await crudQ.read.call(service, { uid: created.uid });
                expect(read.title).toBe('Updated via Upsert');
            });
        });
    });

    describe('select', () => {
        it('should select all apps', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create multiple apps
                await crudQ.create.call(service, {
                    object: {
                        name: 'select-app-1',
                        title: 'Select App 1',
                        index_url: 'https://example.com',
                    },
                });
                await crudQ.create.call(service, {
                    object: {
                        name: 'select-app-2',
                        title: 'Select App 2',
                        index_url: 'https://example.com',
                    },
                });
                await crudQ.create.call(service, {
                    object: {
                        name: 'select-app-3',
                        title: 'Select App 3',
                        index_url: 'https://example.com',
                    },
                });

                // Select all
                const apps = await crudQ.select.call(service, {});
                expect(apps.length).toBeGreaterThanOrEqual(3);

                const names = apps.map(app => app.name);
                expect(names).toContain('select-app-1');
                expect(names).toContain('select-app-2');
                expect(names).toContain('select-app-3');
            });
        });

        it('should select with user-can-edit predicate', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create an app
                await crudQ.create.call(service, {
                    object: {
                        name: 'editable-app',
                        title: 'Editable App',
                        index_url: 'https://example.com',
                    },
                });

                // Select with user-can-edit predicate
                const apps = await crudQ.select.call(service, {
                    predicate: ['user-can-edit'],
                });

                // Should return the app since it's owned by the current user
                const names = apps.map(app => app.name);
                expect(names).toContain('editable-app');
            });
        });
    });

    describe('delete', () => {
        it('should delete app by uid', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create an app
                const created = await crudQ.create.call(service, {
                    object: {
                        name: 'delete-test-app',
                        title: 'Delete Test App',
                        index_url: 'https://example.com',
                    },
                });

                // Delete it
                await crudQ.delete.call(service, { uid: created.uid });

                // Verify it's gone - should throw entity_not_found
                let errorThrown = false;
                try {
                    await crudQ.read.call(service, { uid: created.uid });
                } catch ( error ) {
                    errorThrown = true;
                    const code = error.fields?.code || error.code;
                    expect(code).toBe('entity_not_found');
                }
                expect(errorThrown).toBe(true);
            });
        });

        it('should throw error when deleting non-existent app', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                let errorThrown = false;
                try {
                    await crudQ.delete.call(service, { uid: 'app-nonexistent' });
                } catch ( error ) {
                    errorThrown = true;
                    // Error code is in fields.code for APIError
                    const code = error.fields?.code || error.code;
                    expect(code).toBe('entity_not_found');
                }
                expect(errorThrown).toBe(true);
            });
        });
    });

    describe('edge cases', () => {
        it('should throw validation error for invalid app name', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                let errorThrown = false;
                try {
                    await crudQ.create.call(service, {
                        object: {
                            name: 'invalid name with spaces!',
                            title: 'Invalid App',
                            index_url: 'https://example.com',
                        },
                    });
                } catch ( error ) {
                    errorThrown = true;
                    // Validation errors have specific codes in fields.code
                    const code = error.fields?.code || error.code;
                    expect(code).toBeDefined();
                }
                expect(errorThrown).toBe(true);
            });
        });

        it('should throw error for missing required field', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                let errorThrown = false;
                try {
                    await crudQ.create.call(service, {
                        object: {
                            name: 'missing-title-app',
                            // Missing title!
                            index_url: 'https://example.com',
                        },
                    });
                } catch ( error ) {
                    errorThrown = true;
                    const code = error.fields?.code || error.code;
                    expect(code).toBe('field_missing');
                }
                expect(errorThrown).toBe(true);
            });
        });

        it('should throw error for name conflict without dedupe', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create first app
                await crudQ.create.call(service, {
                    object: {
                        name: 'conflict-name',
                        title: 'First App',
                        index_url: 'https://example.com',
                    },
                });

                // Try to create second app with same name
                let errorThrown = false;
                try {
                    await crudQ.create.call(service, {
                        object: {
                            name: 'conflict-name',
                            title: 'Second App',
                            index_url: 'https://example.com',
                        },
                    });
                } catch ( error ) {
                    errorThrown = true;
                    const code = error.fields?.code || error.code;
                    expect(code).toBe('app_name_already_in_use');
                }
                expect(errorThrown).toBe(true);
            });
        });

        it('should dedupe name with dedupe_name option', async () => {
            await testWithEachService(async ({ kernel, key }) => {
                const service = kernel.services.get(key);
                const crudQ = service.constructor.IMPLEMENTS['crud-q'];

                // Create first app
                await crudQ.create.call(service, {
                    object: {
                        name: 'dedupe-name',
                        title: 'First App',
                        index_url: 'https://example.com',
                    },
                });

                // Create second app with same name but dedupe option
                const second = await crudQ.create.call(service, {
                    object: {
                        name: 'dedupe-name',
                        title: 'Second App',
                        index_url: 'https://example.com',
                    },
                    options: { dedupe_name: true },
                });

                // Should be deduped to dedupe-name-1
                expect(second.name).toBe('dedupe-name-1');
            });
        });
    });
});
