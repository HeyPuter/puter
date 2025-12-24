import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppService from './AppService.js';

// Mock the Context module
vi.mock('../../util/context.js', () => ({
    Context: {
        get: vi.fn(),
    },
}));

import { Context } from '../../util/context.js';

describe('AppService', () => {
    let appService;
    let mockDb;
    let mockServices;

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

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Mock database
        mockDb = {
            read: vi.fn(),
            case: vi.fn().mockImplementation(({ sqlite }) => sqlite),
        };

        // Mock services
        mockServices = {
            get: vi.fn().mockImplementation((serviceName) => {
                if ( serviceName === 'database' ) {
                    return {
                        get: vi.fn().mockReturnValue(mockDb),
                    };
                }
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

        it('should include raw row data in the result', async () => {
            const mockRow = createMockAppRow();
            mockDb.read.mockResolvedValue([mockRow]);

            const crudQ = AppService.IMPLEMENTS['crud-q'];
            const result = await crudQ.read.call(appService, { uid: 'app-uid-123' });

            expect(result.raw).toEqual(mockRow);
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
});

