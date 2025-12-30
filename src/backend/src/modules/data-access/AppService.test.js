import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppService from './AppService.js';

// Mock the Context module
vi.mock('../../util/context.js', () => ({
    Context: {
        get: vi.fn(),
    },
}));

// Mock the helpers module
vi.mock('../../helpers.js', () => ({
    app_name_exists: vi.fn(),
    refresh_apps_cache: vi.fn(),
}));

// Mock the Actor module
vi.mock('../../services/auth/Actor.js', () => ({
    UserActorType: class UserActorType {},
    AppUnderUserActorType: class AppUnderUserActorType {},
}));

// Mock the validation module
vi.mock('./lib/validation.js', () => ({
    validate_string: vi.fn(),
    validate_url: vi.fn(),
    validate_image_base64: vi.fn(),
    validate_json: vi.fn(),
    validate_array_of_strings: vi.fn(),
}));

// Mock config
vi.mock('../../config.js', () => ({
    default: {
        app_name_max_length: 100,
        app_name_regex: /^[a-z0-9-]+$/,
        app_title_max_length: 200,
        static_hosting_domain: 'puter.site',
    },
}));

import { app_name_exists, refresh_apps_cache } from '../../helpers.js';
import { AppUnderUserActorType, UserActorType } from '../../services/auth/Actor.js';
import { Context } from '../../util/context.js';
import {
    validate_string,
    validate_url
} from './lib/validation.js';

describe('AppService', () => {
    let appService;
    let mockDb;
    let mockDbWrite;
    let mockServices;
    let mockEventService;
    let mockPermissionService;
    let mockPuterSiteService;
    let mockOldAppNameService;

    // Helper to create a mock database row
    const createMockAppRow = (overrides = {}) => ({
        id: 1,
        uid: 'app-uid-123',
        name: 'test-app',
        title: 'Test App',
        description: 'A test application',
        icon: 'icon.png',
        index_url: 'https://example.com/app',
        created_at: '2024-01-01T00:00:00Z',
        created_from_origin: 'localhost',
        metadata: '{}',
        stats: '{}',
        approved_for_incentive_program: 0,
        approved_for_listing: 1,
        approved_for_opening_items: 1,
        background: 0,
        godmode: 0,
        maximize_on_start: 0,
        protected: 0,
        owner_user_id: 1,
        owner_user_username: 'testuser',
        owner_user_uuid: 'user-uuid-456',
        app_owner_uid: 'owner-app-uid-789',
        filetypes: '["txt", "doc"]',
        ...overrides,
    });

    // Helper to create a mock actor
    const createMockUserActor = (userId = 1) => ({
        type: Object.assign(new UserActorType(), { user: { id: userId } }),
    });

    const createMockAppUnderUserActor = (userId = 1, appId = 100) => ({
        type: Object.assign(new AppUnderUserActorType(), {
            user: { id: userId },
            app: { id: appId, uid: 'creator-app-uid' },
        }),
    });

    // Helper to setup Context.get mock for create/update tests
    const setupContextForWrite = (actor, user = { id: 1 }) => {
        Context.get.mockImplementation((key) => {
            if ( key === 'actor' ) return actor;
            if ( key === 'user' ) return user;
            return null;
        });
    };

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Reset helper mocks
        app_name_exists.mockResolvedValue(false);
        refresh_apps_cache.mockReturnValue(undefined);

        // Mock database (read)
        mockDb = {
            read: vi.fn(),
            case: vi.fn().mockImplementation(({ sqlite }) => sqlite),
        };

        // Mock database (write)
        mockDbWrite = {
            write: vi.fn().mockResolvedValue({ insertId: 1 }),
        };

        // Mock event service
        mockEventService = {
            emit: vi.fn().mockResolvedValue(undefined),
        };

        // Mock permission service
        mockPermissionService = {
            check: vi.fn().mockResolvedValue(false),
        };

        // Mock puter-site service
        mockPuterSiteService = {
            get_subdomain: vi.fn().mockResolvedValue(null),
        };

        // Mock old-app-name service
        mockOldAppNameService = {
            check_app_name: vi.fn().mockResolvedValue(null),
            remove_name: vi.fn().mockResolvedValue(undefined),
        };

        // Mock services
        mockServices = {
            get: vi.fn().mockImplementation((serviceName) => {
                if ( serviceName === 'database' ) {
                    return {
                        get: vi.fn().mockImplementation((mode) => {
                            if ( mode === 'write' ) return mockDbWrite;
                            return mockDb;
                        }),
                    };
                }
                if ( serviceName === 'event' ) return mockEventService;
                if ( serviceName === 'permission' ) return mockPermissionService;
                if ( serviceName === 'puter-site' ) return mockPuterSiteService;
                if ( serviceName === 'old-app-name' ) return mockOldAppNameService;
                return null;
            }),
        };

        // Create AppService instance
        appService = new AppService({
            services: mockServices,
            config: {},
            name: 'app-service',
            args: {},
            context: {
                get: vi.fn().mockReturnValue(mockServices),
            },
        });

        // Manually call _init to set up the service
        appService.repository = {};
        appService.db = mockDb;
        appService.db_write = mockDbWrite;
    });

    describe('#read', () => {
        it('should read an app by uid', async () => {
            const mockRow = createMockAppRow();
            mockDb.read.mockResolvedValue([mockRow]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { uid: 'app-uid-123' });

            expect(mockDb.read).toHaveBeenCalledTimes(1);
            expect(mockDb.read).toHaveBeenCalledWith(
                expect.stringContaining('WHERE apps.uid = ?'),
                ['app-uid-123']
            );
            expect(result).toBeDefined();
            expect(result.uid).toBe('app-uid-123');
            expect(result.name).toBe('test-app');
            expect(result.title).toBe('Test App');
        });

        it('should read an app by complex id (name)', async () => {
            const mockRow = createMockAppRow();
            mockDb.read.mockResolvedValue([mockRow]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { id: { name: 'test-app' } });

            expect(mockDb.read).toHaveBeenCalledTimes(1);
            expect(mockDb.read).toHaveBeenCalledWith(
                expect.stringContaining('WHERE apps.name = ?'),
                ['test-app']
            );
            expect(result).toBeDefined();
            expect(result.name).toBe('test-app');
        });

        it('should return undefined when no app is found', async () => {
            mockDb.read.mockResolvedValue([]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { uid: 'nonexistent-uid' });

            expect(result).toBeUndefined();
        });

        it('should throw an error when neither uid nor id is provided', async () => {
            const crudQ = AppService.IMPLEMENTS['crud-q'];
            
            await expect(crudQ.read.call(appService, {})).rejects.toThrow(
                'read requires either uid or id'
            );
        });

        it('should throw an error for invalid complex id keys', async () => {
            const crudQ = AppService.IMPLEMENTS['crud-q'];
            
            await expect(
                crudQ.read.call(appService, { id: { invalidKey: 'value' } })
            ).rejects.toThrow('Invalid complex id keys');
        });

        it('should correctly coerce boolean fields from database', async () => {
            const mockRow = createMockAppRow({
                approved_for_incentive_program: 1,
                approved_for_listing: '1',
                approved_for_opening_items: 0,
                background: '0',
                godmode: 1,
                maximize_on_start: '1',
                protected: 0,
            });
            mockDb.read.mockResolvedValue([mockRow]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { uid: 'app-uid-123' });

            expect(result.approved_for_incentive_program).toBe(true);
            expect(result.approved_for_listing).toBe(true);
            expect(result.approved_for_opening_items).toBe(false);
            expect(result.background).toBe(false);
            expect(result.godmode).toBe(true);
            expect(result.maximize_on_start).toBe(true);
            expect(result.protected).toBe(false);
        });

        it('should parse filetypes JSON and strip leading dots', async () => {
            const mockRow = createMockAppRow({
                filetypes: '[".txt", ".doc", "pdf"]',
            });
            mockDb.read.mockResolvedValue([mockRow]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { uid: 'app-uid-123' });

            expect(result.filetype_associations).toEqual(['txt', 'doc', 'pdf']);
        });

        it('should filter out null values in filetypes array', async () => {
            const mockRow = createMockAppRow({
                filetypes: '[".txt", null, "pdf"]',
            });
            mockDb.read.mockResolvedValue([mockRow]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { uid: 'app-uid-123' });

            expect(result.filetype_associations).toEqual(['txt', 'pdf']);
        });

        it('should have owner parameter', async () => {
            const mockRow = createMockAppRow();
            mockDb.read.mockResolvedValue([mockRow]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { uid: 'app-uid-123' });

            expect(result.owner).toEqual({
                username: 'testuser',
                uuid: 'user-uuid-456',
            });
        });

        it('should include app_owner in the result', async () => {
            const mockRow = createMockAppRow();
            mockDb.read.mockResolvedValue([mockRow]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { uid: 'app-uid-123' });

            expect(result.app_owner).toEqual({
                uid: 'owner-app-uid-789',
            });
        });

        it('should fetch icon with size when icon_size param is provided', async () => {
            const mockRow = createMockAppRow();
            mockDb.read.mockResolvedValue([mockRow]);

            const mockIconService = {
                get_icon_stream: vi.fn().mockResolvedValue({
                    get_data_url: vi.fn().mockResolvedValue('data:image/png;base64,abc123'),
                }),
            };

            appService.context = {
                get: vi.fn().mockImplementation((key) => {
                    if ( key === 'services' ) {
                        return {
                            get: vi.fn().mockImplementation((name) => {
                                if ( name === 'app-icon' ) return mockIconService;
                                return null;
                            }),
                        };
                    }
                    return null;
                }),
            };

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, {
                uid: 'app-uid-123',
                params: { icon_size: 64 },
            });

            expect(mockIconService.get_icon_stream).toHaveBeenCalledWith({
                app_uid: 'app-uid-123',
                app_icon: 'icon.png',
                size: 64,
            });
            expect(result.icon).toBe('data:image/png;base64,abc123');
        });

        it('should keep original icon when icon service throws', async () => {
            const mockRow = createMockAppRow();
            mockDb.read.mockResolvedValue([mockRow]);

            const mockErrorService = {
                report: vi.fn(),
            };

            const mockIconService = {
                get_icon_stream: vi.fn().mockRejectedValue(new Error('Icon fetch failed')),
            };

            appService.context = {
                get: vi.fn().mockImplementation((key) => {
                    if ( key === 'services' ) {
                        return {
                            get: vi.fn().mockImplementation((name) => {
                                if ( name === 'app-icon' ) return mockIconService;
                                if ( name === 'error-service' ) return mockErrorService;
                                return null;
                            }),
                        };
                    }
                    return null;
                }),
            };

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, {
                uid: 'app-uid-123',
                params: { icon_size: 64 },
            });

            expect(mockErrorService.report).toHaveBeenCalledWith(
                'AppES:read_transform',
                expect.objectContaining({ source: expect.any(Error) })
            );
            expect(result.icon).toBe('icon.png');
        });

    });

    describe('#select', () => {
        it('should select all apps with default parameters', async () => {
            const mockRows = [
                createMockAppRow({ id: 1, uid: 'app-1', name: 'app-one' }),
                createMockAppRow({ id: 2, uid: 'app-2', name: 'app-two' }),
            ];
            mockDb.read.mockResolvedValue(mockRows);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.select.call(appService, {});

            expect(mockDb.read).toHaveBeenCalledTimes(1);
            expect(mockDb.read).toHaveBeenCalledWith(
                expect.not.stringContaining('WHERE'),
                []
            );
            expect(result).toHaveLength(2);
            expect(result[0].uid).toBe('app-1');
            expect(result[1].uid).toBe('app-2');
        });

        it('should filter by user-can-edit predicate', async () => {
            const mockUser = { id: 42 };
            Context.get.mockReturnValue(mockUser);

            const mockRows = [createMockAppRow()];
            mockDb.read.mockResolvedValue(mockRows);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.select.call(appService, {
                predicate: ['user-can-edit'],
            });

            expect(mockDb.read).toHaveBeenCalledWith(
                expect.stringContaining('WHERE apps.owner_user_id=?'),
                [42]
            );
            expect(result).toHaveLength(1);
        });

        it('should throw error when predicate is not an array', async () => {
            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(
                crudQ.select.call(appService, { predicate: 'invalid' })
            ).rejects.toThrow('predicate must be an array');
        });

        it('should correctly coerce boolean fields for all selected apps', async () => {
            const mockRows = [
                createMockAppRow({
                    id: 1,
                    approved_for_listing: 1,
                    godmode: 0,
                }),
                createMockAppRow({
                    id: 2,
                    approved_for_listing: '0',
                    godmode: '1',
                }),
            ];
            mockDb.read.mockResolvedValue(mockRows);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.select.call(appService, {});

            expect(result[0].approved_for_listing).toBe(true);
            expect(result[0].godmode).toBe(false);
            expect(result[1].approved_for_listing).toBe(false);
            expect(result[1].godmode).toBe(true);
        });

        it('should parse filetypes for all selected apps', async () => {
            const mockRows = [
                createMockAppRow({ id: 1, filetypes: '[".txt"]' }),
                createMockAppRow({ id: 2, filetypes: '[".pdf", ".doc"]' }),
            ];
            mockDb.read.mockResolvedValue(mockRows);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.select.call(appService, {});

            expect(result[0].filetype_associations).toEqual(['txt']);
            expect(result[1].filetype_associations).toEqual(['pdf', 'doc']);
        });

        it('should fetch icons with size for all apps when icon_size is provided', async () => {
            const mockRows = [
                createMockAppRow({ id: 1, uid: 'app-1', icon: 'icon1.png' }),
                createMockAppRow({ id: 2, uid: 'app-2', icon: 'icon2.png' }),
            ];
            mockDb.read.mockResolvedValue(mockRows);

            const mockIconService = {
                get_icon_stream: vi.fn().mockImplementation(({ app_uid }) => ({
                    get_data_url: vi.fn().mockResolvedValue(`data:image/png;base64,${app_uid}`),
                })),
            };

            appService.context = {
                get: vi.fn().mockImplementation((key) => {
                    if ( key === 'services' ) {
                        return {
                            get: vi.fn().mockImplementation((name) => {
                                if ( name === 'app-icon' ) return mockIconService;
                                return null;
                            }),
                        };
                    }
                    return null;
                }),
            };

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.select.call(appService, {
                params: { icon_size: 32 },
            });

            expect(mockIconService.get_icon_stream).toHaveBeenCalledTimes(2);
            expect(result[0].icon).toBe('data:image/png;base64,app-1');
            expect(result[1].icon).toBe('data:image/png;base64,app-2');
        });

        it('should return empty array when no apps exist', async () => {
            mockDb.read.mockResolvedValue([]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.select.call(appService, {});

            expect(result).toEqual([]);
        });

        it('should have owner parameter for all selected apps', async () => {
            const mockRows = [
                createMockAppRow({
                    id: 1,
                    owner_user_username: 'user1',
                    owner_user_uuid: 'uuid-1',
                }),
                createMockAppRow({
                    id: 2,
                    owner_user_username: 'user2',
                    owner_user_uuid: 'uuid-2',
                }),
            ];
            mockDb.read.mockResolvedValue(mockRows);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.select.call(appService, {});

            expect(result[0].owner).toEqual({
                username: 'user1',
                uuid: 'uuid-1',
            });
            expect(result[1].owner).toEqual({
                username: 'user2',
                uuid: 'uuid-2',
            });
        });

        it('should handle filetypes that are not strings', async () => {
            const mockRows = [
                createMockAppRow({ id: 1, filetypes: '[".txt", 123]' }),
            ];
            mockDb.read.mockResolvedValue(mockRows);

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.select.call(appService, {})).rejects.toThrow(
                'expected filetypesAsJSON[1] to be a string'
            );
        });

        it('should handle malformed filetypes JSON', async () => {
            const mockRows = [
                createMockAppRow({ id: 1, filetypes: 'not valid json' }),
            ];
            mockDb.read.mockResolvedValue(mockRows);

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.select.call(appService, {})).rejects.toThrow(
                'failed to get app filetype associations'
            );
        });

        it('should use database case for SQL dialect differences', async () => {
            mockDb.read.mockResolvedValue([]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.select.call(appService, {});

            expect(mockDb.case).toHaveBeenCalledWith({
                mysql: expect.stringContaining('JSON_ARRAYAGG'),
                sqlite: expect.stringContaining('json_group_array'),
            });
        });
    });

    describe('#build_complex_id_where (via #read)', () => {
        it('should accept "name" as a valid redundant identifier', async () => {
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.read.call(appService, { id: { name: 'test' } });

            expect(mockDb.read).toHaveBeenCalledWith(
                expect.stringContaining('apps.name = ?'),
                ['test']
            );
        });

        it('should reject identifiers not in REDUNDANT_IDENTIFIERS', async () => {
            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(
                crudQ.read.call(appService, { id: { title: 'test' } })
            ).rejects.toThrow('Invalid complex id keys: title');
        });
    });

    describe('#create', () => {
        it('should create an app with valid input', async () => {
            setupContextForWrite(createMockUserActor(1));

            // Mock the read after insert
            mockDb.read.mockResolvedValue([createMockAppRow({
                uid: expect.stringContaining('app-'),
                name: 'new-app',
                title: 'New App',
                index_url: 'https://example.com/new',
            })]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.create.call(appService, {
                object: {
                    name: 'new-app',
                    title: 'New App',
                    index_url: 'https://example.com/new',
                },
            });

            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO apps'),
                expect.arrayContaining(['new-app', 'New App', 'https://example.com/new'])
            );
            expect(refresh_apps_cache).toHaveBeenCalled();
        });

        it('should throw forbidden for non-user actors', async () => {
            // Mock an invalid actor type
            Context.get.mockImplementation((key) => {
                if ( key === 'actor' ) return { type: {} };
                return null;
            });

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                    index_url: 'https://example.com',
                },
            })).rejects.toThrow();
        });

        it('should throw field_missing when name is not provided', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.create.call(appService, {
                object: {
                    title: 'Test',
                    index_url: 'https://example.com',
                },
            })).rejects.toThrow();
        });

        it('should throw field_missing when title is not provided', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    index_url: 'https://example.com',
                },
            })).rejects.toThrow();
        });

        it('should throw field_missing when index_url is not provided', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                },
            })).rejects.toThrow();
        });

        it('should remove protected fields from input', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                    index_url: 'https://example.com',
                    last_review: '2024-01-01', // protected field
                },
            });

            // The INSERT should not include last_review
            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO apps'),
                expect.not.arrayContaining(['2024-01-01'])
            );
        });

        it('should remove read_only fields from input', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                    index_url: 'https://example.com',
                    approved_for_listing: true, // read_only field
                    godmode: true, // read_only field
                },
            });

            // These fields should not appear in the INSERT
            const writeCall = mockDbWrite.write.mock.calls[0];
            expect(writeCall[0]).not.toContain('approved_for_listing');
            expect(writeCall[0]).not.toContain('godmode');
        });

        it('should handle name conflict with dedupe_name option', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            // First check returns true (name exists), second returns false
            app_name_exists
                .mockResolvedValueOnce(true)  // 'new-app' exists
                .mockResolvedValueOnce(false); // 'new-app-1' doesn't exist

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'new-app',
                    title: 'New App',
                    index_url: 'https://example.com',
                },
                options: { dedupe_name: true },
            });

            // Should have inserted with deduped name
            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO apps'),
                expect.arrayContaining(['new-app-1'])
            );
        });

        it('should throw error when name conflict without dedupe_name', async () => {
            setupContextForWrite(createMockUserActor(1));
            app_name_exists.mockResolvedValue(true);

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.create.call(appService, {
                object: {
                    name: 'existing-app',
                    title: 'Test',
                    index_url: 'https://example.com',
                },
            })).rejects.toThrow();
        });

        it('should set app_owner when actor is AppUnderUserActorType', async () => {
            setupContextForWrite(createMockAppUnderUserActor(1, 100));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                    index_url: 'https://example.com',
                },
            });

            // Should include app_owner in the INSERT
            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('app_owner'),
                expect.arrayContaining([100])
            );
        });

        it('should emit app.new-icon event when icon is provided', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                    index_url: 'https://example.com',
                    icon: 'data:image/png;base64,abc123',
                },
            });

            expect(mockEventService.emit).toHaveBeenCalledWith(
                'app.new-icon',
                expect.objectContaining({
                    data_url: 'data:image/png;base64,abc123',
                })
            );
        });

        it('should handle filetype_associations', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                    index_url: 'https://example.com',
                    filetype_associations: ['txt', 'pdf'],
                },
            });

            // Should have three write calls: INSERT app, DELETE old associations, INSERT new associations
            // (DELETE is called even for create since #update_filetype_associations always clears first)
            expect(mockDbWrite.write).toHaveBeenCalledTimes(3);
            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM app_filetype_association'),
                [1]
            );
            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO app_filetype_association'),
                expect.arrayContaining([1, 'txt', 1, 'pdf'])
            );
        });

        it('should call validate_string for name and title', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test Title',
                    index_url: 'https://example.com',
                },
            });

            expect(validate_string).toHaveBeenCalledWith('test-app', expect.objectContaining({ key: 'name' }));
            expect(validate_string).toHaveBeenCalledWith('Test Title', expect.objectContaining({ key: 'title' }));
        });

        it('should call validate_url for index_url', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                    index_url: 'https://example.com/app',
                },
            });

            expect(validate_url).toHaveBeenCalledWith('https://example.com/app', expect.objectContaining({ key: 'index_url' }));
        });

        it('should generate a UID with app- prefix', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.create.call(appService, {
                object: {
                    name: 'test-app',
                    title: 'Test',
                    index_url: 'https://example.com',
                },
            });

            const writeCall = mockDbWrite.write.mock.calls[0];
            const values = writeCall[1];
            const uidValue = values[0]; // uid is first value
            expect(uidValue).toMatch(/^app-[0-9a-f-]{36}$/);
        });
    });

    describe('#update', () => {
        beforeEach(() => {
            // Default: return an existing app for updates
            mockDb.read.mockResolvedValue([createMockAppRow({
                owner_user_id: 1,
            })]);
        });

        it('should update an app with valid input', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', title: 'Updated Title' },
            });

            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE apps SET'),
                expect.arrayContaining(['Updated Title', 'app-uid-123'])
            );
        });

        it('should throw entity_not_found when app does not exist', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockDb.read.mockResolvedValue([]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.update.call(appService, {
                object: { uid: 'nonexistent-uid', title: 'Test' },
            })).rejects.toThrow();
        });

        it('should throw forbidden when user does not own the app', async () => {
            // User 2 trying to update app owned by user 1
            setupContextForWrite(createMockUserActor(2), { id: 2 });
            mockDb.read.mockResolvedValue([createMockAppRow({
                owner_user_id: 1,
            })]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', title: 'Hacked Title' },
            })).rejects.toThrow();
        });

        it('should allow update when user has write-all-owners permission', async () => {
            setupContextForWrite(createMockUserActor(2), { id: 2 });
            mockDb.read.mockResolvedValue([createMockAppRow({
                owner_user_id: 1,
            })]);
            mockPermissionService.check.mockResolvedValue(true);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', title: 'Admin Update' },
            });

            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE apps SET'),
                expect.arrayContaining(['Admin Update'])
            );
        });

        it('should remove protected fields from update', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: {
                    uid: 'app-uid-123',
                    title: 'Updated',
                    last_review: '2024-12-01', // protected field
                },
            });

            const writeCall = mockDbWrite.write.mock.calls[0];
            expect(writeCall[0]).not.toContain('last_review');
        });

        it('should remove read_only fields from update', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: {
                    uid: 'app-uid-123',
                    title: 'Updated',
                    approved_for_listing: true,
                    godmode: true,
                },
            });

            const writeCall = mockDbWrite.write.mock.calls[0];
            expect(writeCall[0]).not.toContain('approved_for_listing');
            expect(writeCall[0]).not.toContain('godmode');
        });

        it('should handle name change with conflict', async () => {
            setupContextForWrite(createMockUserActor(1));
            app_name_exists.mockResolvedValue(true);

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', name: 'taken-name' },
            })).rejects.toThrow();
        });

        it('should allow name change with dedupe_name option', async () => {
            setupContextForWrite(createMockUserActor(1));
            app_name_exists
                .mockResolvedValueOnce(true)   // 'new-name' exists
                .mockResolvedValueOnce(false); // 'new-name-1' doesn't exist

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', name: 'new-name' },
                options: { dedupe_name: true },
            });

            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE apps SET'),
                expect.arrayContaining(['new-name-1'])
            );
        });

        it('should allow reclaiming old app name', async () => {
            setupContextForWrite(createMockUserActor(1));
            app_name_exists.mockResolvedValue(true);
            mockOldAppNameService.check_app_name.mockResolvedValue({
                id: 99,
                app_uid: 'app-uid-123', // Same app
            });

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', name: 'old-name' },
            });

            expect(mockOldAppNameService.remove_name).toHaveBeenCalledWith(99);
            expect(mockDbWrite.write).toHaveBeenCalled();
        });

        it('should not update name if unchanged', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', name: 'test-app' }, // Same as existing
            });

            // Should only have the read for ID, no name in update
            const writeCall = mockDbWrite.write.mock.calls.find(
                call => call[0].includes('UPDATE')
            );
            if ( writeCall ) {
                expect(writeCall[1]).not.toContain('test-app');
            }
        });

        it('should emit app.new-icon event when icon changes', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: {
                    uid: 'app-uid-123',
                    icon: 'data:image/png;base64,newicon',
                },
            });

            expect(mockEventService.emit).toHaveBeenCalledWith(
                'app.new-icon',
                expect.objectContaining({
                    app_uid: 'app-uid-123',
                    data_url: 'data:image/png;base64,newicon',
                })
            );
        });

        it('should emit app.rename event when name changes', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', name: 'renamed-app' },
            });

            expect(mockEventService.emit).toHaveBeenCalledWith(
                'app.rename',
                expect.objectContaining({
                    app_uid: 'app-uid-123',
                    new_name: 'renamed-app',
                    old_name: 'test-app',
                })
            );
        });

        it('should update filetype_associations', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: {
                    uid: 'app-uid-123',
                    filetype_associations: ['doc', 'xls'],
                },
            });

            // Should delete old associations
            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM app_filetype_association'),
                [1]
            );

            // Should insert new associations
            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO app_filetype_association'),
                expect.arrayContaining([1, 'doc', 1, 'xls'])
            );
        });

        it('should call refresh_apps_cache after update', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: { uid: 'app-uid-123', title: 'Updated' },
            });

            expect(refresh_apps_cache).toHaveBeenCalledWith(
                { uid: 'app-uid-123' },
                expect.objectContaining({ uuid: 'app-uid-123' })
            );
        });

        it('should validate fields when provided', async () => {
            setupContextForWrite(createMockUserActor(1));

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: {
                    uid: 'app-uid-123',
                    name: 'updated-name',
                    title: 'Updated Title',
                    description: 'Updated description',
                    index_url: 'https://updated.com',
                },
            });

            expect(validate_string).toHaveBeenCalledWith('updated-name', expect.objectContaining({ key: 'name' }));
            expect(validate_string).toHaveBeenCalledWith('Updated Title', expect.objectContaining({ key: 'title' }));
            expect(validate_string).toHaveBeenCalledWith('Updated description', expect.objectContaining({ key: 'description' }));
            expect(validate_url).toHaveBeenCalledWith('https://updated.com', expect.objectContaining({ key: 'index_url' }));
        });

        it('should check subdomain ownership when index_url changes to puter.site', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockPuterSiteService.get_subdomain.mockResolvedValue(null);

            const crudQ = AppService.IMPLEMENTS['crud-q'];

            await expect(crudQ.update.call(appService, {
                object: {
                    uid: 'app-uid-123',
                    index_url: 'https://mysite.puter.site',
                },
            })).rejects.toThrow();
        });

        it('should allow index_url change when subdomain is owned', async () => {
            setupContextForWrite(createMockUserActor(1));
            mockPuterSiteService.get_subdomain.mockResolvedValue({ user_id: 1 });

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.update.call(appService, {
                object: {
                    uid: 'app-uid-123',
                    index_url: 'https://mysite.puter.site',
                },
            });

            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE apps SET'),
                expect.arrayContaining(['https://mysite.puter.site'])
            );
        });
    });

    describe('#upsert', () => {
        it('should call create when entity does not exist', async () => {
            setupContextForWrite(createMockUserActor(1));

            // First read returns empty (entity doesn't exist)
            mockDb.read
                .mockResolvedValueOnce([])  // lookup
                .mockResolvedValue([createMockAppRow()]); // read after create

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.upsert.call(appService, {
                object: {
                    name: 'new-app',
                    title: 'New App',
                    index_url: 'https://example.com',
                },
            });

            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO apps'),
                expect.any(Array)
            );
        });

        it('should call update when entity exists', async () => {
            setupContextForWrite(createMockUserActor(1));

            // Read returns existing entity
            mockDb.read.mockResolvedValue([createMockAppRow()]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            await crudQ.upsert.call(appService, {
                object: { uid: 'app-uid-123', title: 'Updated Title' },
            });

            expect(mockDbWrite.write).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE apps SET'),
                expect.any(Array)
            );
        });
    });
});

