/*
 * Tests for TrashAutoDeleteService (socket + SQL version)
 *
 * These tests:
 *  - mock the database layer
 *  - spy on get_user from helpers
 *  - mock the socketio service's send()
 *  - exercise _runCleanup and indirectly _cleanupUser / _deleteOne
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Load real helpers module so we can spy on it
const helpers = require('../helpers');

// Spy on get_user BEFORE loading service
const getUserSpy = vi.spyOn(helpers, 'get_user');

// Now load the service (after creating the spy)
const { TrashAutoDeleteService } = require('./TrashAutoDeleteService');


/* --------------------------------------------- */

// Convenience: DAY_MS value used in service
const DAY_MS = 86400000;

/**
 * Helper to construct a TrashAutoDeleteService instance for unit tests
 * without going through the full kernel / BaseService lifecycle.
 */
function makeService ({ db, log, socketio } = {}) {
    const service_resources = {
        services: {},          // we will override on the instance
        config: { server_id: 'test' },
        name: 'trash-auto-delete',
        args: [],
        context: {},
    };

    const svc = new TrashAutoDeleteService(service_resources);

    svc.db = db || {
        read: vi.fn(),
        write: vi.fn(),
    };

    svc.log = log || {
        info: vi.fn(),
        error: vi.fn(),
        tick: vi.fn(),
    };

    const socketSvc = socketio || {
        send: vi.fn().mockResolvedValue(),
    };

    // override services so _deleteOne can do this.services.get('socketio')
    svc.services = {
        get: (name) => {
            if ( name === 'socketio' ) return socketSvc;
            // we don't use other services in these tests
            return null;
        },
    };

    // Expose socket service for assertions
    svc.__socketio = socketSvc;

    return svc;
}

describe('TrashAutoDeleteService — Socket emission tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should emit a socket event containing expired UUIDs', async () => {
        // Arrange
        const now = Date.now();
        const prefDays = 3;

        const db = {
            read: vi.fn(),
            write: vi.fn(),
        };

        // 1) users query
        db.read.mockResolvedValueOnce([
            { id: 7, trash_uuid: 'trash-uuid-7' },
        ]);

        // 2) user pref query (kv)
        db.read.mockResolvedValueOnce([
            { value: JSON.stringify(prefDays) },
        ]);

        // 3) files in trash: one expired, one recent
        const oldCreated = Math.floor((now - (prefDays + 1) * DAY_MS) / 1000);
        const newCreated = Math.floor(now / 1000);
        db.read.mockResolvedValueOnce([
            { uuid: 'expired-1', created: oldCreated },
            { uuid: 'recent-1', created: newCreated },
        ]);

        // get_user should resolve to our user object
        getUserSpy.mockResolvedValueOnce({
            id: 7,
            username: 'hanif',
        });

        const svc = makeService({ db });
        const emitFn = svc.__socketio.send;

        // Act
        await svc._runCleanup();

        // Debug: print all DB read calls
        console.log("DB READ CALLS:", db.read.mock.calls);

        // Assert
        expect(emitFn).toHaveBeenCalledTimes(1);
        expect(emitFn).toHaveBeenCalledWith(
            { room: 7 },
            'trash.auto_delete',
            {
                uuid: 'expired-1',
                path: '/hanif/Trash/expired-1',
            },
        );
    });

    it('should not emit when no files are expired', async () => {
        const now = Date.now();
        const prefDays = 3;

        const db = {
            read: vi.fn(),
            write: vi.fn(),
        };

        // 1) users
        db.read.mockResolvedValueOnce([
            { id: 7, trash_uuid: 'trash-uuid-7' },
        ]);

        // 2) pref
        db.read.mockResolvedValueOnce([
            { value: JSON.stringify(prefDays) },
        ]);

        // 3) files: all too new
        const createdRecent = Math.floor(now / 1000);
        db.read.mockResolvedValueOnce([
            { uuid: 'recent-1', created: createdRecent },
            { uuid: 'recent-2', created: createdRecent },
        ]);

        getUserSpy.mockResolvedValueOnce({
            id: 7,
            username: 'hanif',
        });

        const svc = makeService({ db });
        const emitFn = svc.__socketio.send;

        await svc._runCleanup();

        expect(emitFn).not.toHaveBeenCalled();
    });

    it('honors preference = 0 (disabled)', async () => {
        const db = {
            read: vi.fn(),
            write: vi.fn(),
        };

        // 1) users
        db.read.mockResolvedValueOnce([
            { id: 7, trash_uuid: 'trash-uuid-7' },
        ]);

        // 2) kv pref -> no rows => prefDays = 0 => auto-delete disabled
        db.read.mockResolvedValueOnce([]);

        // fsentries query should not matter; but we can return a file
        db.read.mockResolvedValueOnce([
            { uuid: 'expired-1', created: 0 },
        ]);

        getUserSpy.mockResolvedValueOnce({
            id: 7,
            username: 'hanif',
        });

        const svc = makeService({ db });
        const emitFn = svc.__socketio.send;

        await svc._runCleanup();

        // No delete => no socket emission
        expect(emitFn).not.toHaveBeenCalled();
    });

    it('should send multiple UUIDs (multiple expired files)', async () => {
        const now = Date.now();
        const prefDays = 1;

        const db = {
            read: vi.fn(),
            write: vi.fn(),
        };

        // 1) users
        db.read.mockResolvedValueOnce([
            { id: 7, trash_uuid: 'trash-uuid-7' },
        ]);

        // 2) pref
        db.read.mockResolvedValueOnce([
            { value: JSON.stringify(prefDays) },
        ]);

        // 3) fsentries: both clearly old
        const oldCreated = Math.floor((now - 5 * DAY_MS) / 1000);
        db.read.mockResolvedValueOnce([
            { uuid: 'a', created: oldCreated },
            { uuid: 'b', created: oldCreated },
        ]);

        getUserSpy.mockResolvedValueOnce({
            id: 7,
            username: 'hanif',
        });

        const svc = makeService({ db });
        const emitFn = svc.__socketio.send;

        await svc._runCleanup();

        // Debug: print all DB read calls
        console.log("DB READ CALLS:", db.read.mock.calls);

        // Two expired files => two socket events
        expect(emitFn).toHaveBeenCalledTimes(2);
        expect(emitFn).toHaveBeenCalledWith(
            { room: 7 },
            'trash.auto_delete',
            {
                uuid: 'a',
                path: '/hanif/Trash/a',
            },
        );
        expect(emitFn).toHaveBeenCalledWith(
            { room: 7 },
            'trash.auto_delete',
            {
                uuid: 'b',
                path: '/hanif/Trash/b',
            },
        );
    });

    it('logs errors instead of throwing on DB failure', async () => {
        const db = {
            read: vi.fn().mockRejectedValue(new Error('boom')),
            write: vi.fn(),
        };

        const log = {
            info: vi.fn(),
            error: vi.fn(),
            tick: vi.fn(),
        };

        const svc = makeService({ db, log });

        await expect(svc._runCleanup()).resolves.toBeUndefined();

        // We expect two calls:
        //  - "TrashAutoDeleteService failed:"
        //  - the actual error object
        expect(log.error).toHaveBeenCalled();

        const calls = log.error.mock.calls;
        // First call: string message
        expect(calls[0][0]).toMatch(/TrashAutoDeleteService failed/);
        // Second call: error object
        expect(calls[1][0]).toBeInstanceOf(Error);
        expect(calls[1][0].message).toBe('boom');
    });

    it('does nothing if user list is empty', async () => {
        const db = {
            read: vi.fn().mockResolvedValueOnce([]), // users => []
            write: vi.fn(),
        };

        const svc = makeService({ db });
        const emitFn = svc.__socketio.send;

        await svc._runCleanup();

        // Only one read (for users), nothing else
        expect(db.read).toHaveBeenCalledTimes(1);
        expect(emitFn).not.toHaveBeenCalled();
    });

    it('sets up periodic cleanup every 30 minutes', async () => {
        vi.useFakeTimers();
    
        // Fake scheduleFn and spy on callback
        const scheduleFn = vi.fn((cb, interval) => {
            scheduleFn.callback = cb;
            scheduleFn.interval = interval;
        });
    
        const runCleanupSpy = vi.fn();
    
        // Construct service without real DB
        const svc = makeService({});
    
        // Mock database service so _init() does not crash
        svc.services.get = (name) => {
            if ( name === 'database' ) {
                return {
                    get: vi.fn().mockResolvedValue({
                        // mocked DB interface, not used in this test
                        read: vi.fn(),
                        write: vi.fn()
                    })
                };
            }
            if ( name === 'socketio' ) {
                return { send: vi.fn() };
            }
            return null;
        };
    
        // Override scheduleFn
        svc._scheduleFn = scheduleFn;
    
        // Override _runCleanup so we can track calls
        svc._runCleanup = runCleanupSpy;
    
        // Act
        await svc._init();
    
        // Assert scheduling happened
        expect(scheduleFn).toHaveBeenCalledTimes(1);
        expect(scheduleFn.interval).toBe(30 * 60 * 1000);
    
        // Simulate the periodic callback
        await scheduleFn.callback();
    
        expect(runCleanupSpy).toHaveBeenCalledTimes(1);
    
        vi.useRealTimers();
    });

    it('should skip cleanup when get_user returns null', async () => {
        const now = Date.now();
        const prefDays = 1;
    
        const db = {
            read: vi.fn(),
            write: vi.fn(),
        };
    
        // 1) users
        db.read.mockResolvedValueOnce([
            { id: 7, trash_uuid: 'trash-uuid-7' },
        ]);
    
        // 2) pref
        db.read.mockResolvedValueOnce([
            { value: JSON.stringify(prefDays) },
        ]);
    
        // 3) fsentries should NOT be called because get_user returns null
        db.read.mockResolvedValueOnce([
            { uuid: 'expired-1', created: Math.floor(now / 1000) },
        ]);
    
        // get_user returns null → skip entire cleanup
        vi.spyOn(require('../helpers'), 'get_user').mockResolvedValueOnce(null);
    
        const svc = makeService({ db });
    
        const emitFn = svc.__socketio.send;
    
        await svc._runCleanup();
    
        // It should NOT delete anything
        expect(emitFn).not.toHaveBeenCalled();
    
        // fsentries query does NOT happen (only users & pref)
        expect(db.read).toHaveBeenCalledTimes(1);
    });

    it('should do nothing when trash folder has zero files', async () => {
        const prefDays = 3;
    
        const db = {
            read: vi.fn(),
            write: vi.fn(),
        };
    
        // 1) users
        db.read.mockResolvedValueOnce([
            { id: 7, trash_uuid: 'trash-uuid-7' },
        ]);
    
        // 2) pref
        db.read.mockResolvedValueOnce([
            { value: JSON.stringify(prefDays) },
        ]);
    
        // 3) empty fsentries
        db.read.mockResolvedValueOnce([]);
    
        vi.spyOn(require('../helpers'), 'get_user').mockResolvedValueOnce({
            id: 7,
            username: 'hanif',
        });
    
        const svc = makeService({ db });
        const emitFn = svc.__socketio.send;
    
        await svc._runCleanup();
    
        expect(emitFn).not.toHaveBeenCalled();
    });

    it('should treat invalid timestamps as expired and delete them', async () => {
        const prefDays = 1;
    
        const db = {
            read: vi.fn(),
            write: vi.fn(),
        };
    
        // 1) users
        db.read.mockResolvedValueOnce([
            { id: 7, trash_uuid: 'trash-uuid-7' },
        ]);
    
        // 2) pref
        db.read.mockResolvedValueOnce([
            { value: JSON.stringify(prefDays) },
        ]);
    
        // 3) invalid created → deletion should still occur
        db.read.mockResolvedValueOnce([
            { uuid: 'bad-file', created: "not-a-number" },
        ]);
    
        const helpersMock = require('../helpers');
        vi.spyOn(helpersMock, 'get_user').mockResolvedValueOnce({
            id: 7,
            username: 'hanif',
        });
    
        const svc = makeService({ db });
        const emitFn = svc.__socketio.send;
    
        await svc._runCleanup();
    
        // Should delete because NaN < prefDays is false → treated as expired
        expect(emitFn).toHaveBeenCalledTimes(1);
        expect(emitFn).toHaveBeenCalledWith(
            { room: 7 },
            "trash.auto_delete",
            {
                uuid: "bad-file",
                path: "/hanif/Trash/bad-file",
            }
        );
    });

    it('should process multiple users independently and emit only for those with expired files', async () => {
        const now = Date.now();
    
        const db = {
            read: vi.fn(),
            write: vi.fn(),
        };
    
        // 1) users: user1 and user2
        db.read.mockResolvedValueOnce([
            { id: 1, trash_uuid: 'trash-uuid-1' },
            { id: 2, trash_uuid: 'trash-uuid-2' },
        ]);
    
        // 2) user1 pref
        db.read.mockResolvedValueOnce([
            { value: JSON.stringify(1) },
        ]);
    
        // 3) user1 fsentries → one expired file
        db.read.mockResolvedValueOnce([
            { uuid: 'expired-u1', created: Math.floor((now - 3 * DAY_MS) / 1000) },
        ]);
    
        // 4) user2 pref
        db.read.mockResolvedValueOnce([
            { value: JSON.stringify(10) },
        ]);
    
        // 5) user2 fsentries → all fresh files
        db.read.mockResolvedValueOnce([
            { uuid: 'recent-u2', created: Math.floor(now / 1000) },
        ]);
    
        // Mock get_user sequence (user1 then user2)
        const helpersMock = require('../helpers');
        vi.spyOn(helpersMock, 'get_user')
            .mockResolvedValueOnce({ id: 1, username: 'alice' })
            .mockResolvedValueOnce({ id: 2, username: 'bob' });
    
        const svc = makeService({ db });
        const emitFn = svc.__socketio.send;
    
        await svc._runCleanup();
    
        // User1 should emit once
        expect(emitFn).toHaveBeenCalledWith(
            { room: 1 },
            'trash.auto_delete',
            {
                uuid: 'expired-u1',
                path: '/alice/Trash/expired-u1',
            }
        );
    
        // User2 should emit nothing
        expect(emitFn).toHaveBeenCalledTimes(1);
    });
});