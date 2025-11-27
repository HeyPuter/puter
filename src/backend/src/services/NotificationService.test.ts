import { describe, expect, it, vi } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import * as config from '../config';
import { NotificationService, UserIDNotifSelector, UsernameNotifSelector } from './NotificationService';
import { ScriptService } from './ScriptService';

describe('NotificationService', async () => {
    config.load_config({
        'services': {
            'database': {
                path: ':memory:',
            },
        },
    });

    const testKernel = await createTestKernel({
        serviceMap: {
            'script': ScriptService,
            'notification': NotificationService,
        },
        initLevelString: 'init',
        testCore: true,
    });

    const notificationService = testKernel.services!.get('notification') as any;

    it('should be instantiated', () => {
        expect(notificationService).toBeInstanceOf(NotificationService);
    });

    it('should have db connection after init', () => {
        expect(notificationService.db).toBeDefined();
    });

    it('should have notifs_pending_write object', () => {
        expect(notificationService.notifs_pending_write).toBeDefined();
        expect(typeof notificationService.notifs_pending_write).toBe('object');
    });

    it('should have merged_on_user_connected_ object', () => {
        expect(notificationService.merged_on_user_connected_).toBeDefined();
        expect(typeof notificationService.merged_on_user_connected_).toBe('object');
    });

    it('should have on_user_connected method', () => {
        expect(notificationService.on_user_connected).toBeDefined();
        expect(typeof notificationService.on_user_connected).toBe('function');
    });

    it('should have do_on_user_connected method', () => {
        expect(notificationService.do_on_user_connected).toBeDefined();
        expect(typeof notificationService.do_on_user_connected).toBe('function');
    });

    it('should have on_sent_to_user method', () => {
        expect(notificationService.on_sent_to_user).toBeDefined();
        expect(typeof notificationService.on_sent_to_user).toBe('function');
    });

    it('should have notify method', () => {
        expect(notificationService.notify).toBeDefined();
        expect(typeof notificationService.notify).toBe('function');
    });

    it('should schedule do_on_user_connected on user connected', async () => {
        vi.useFakeTimers();
        
        const user = { uuid: 'test-uuid-123', id: 1 };
        
        await notificationService.on_user_connected({ user });
        
        expect(notificationService.merged_on_user_connected_[user.uuid]).toBeDefined();
        
        vi.useRealTimers();
    });

    it('should clear previous timeout on repeated user connected', async () => {
        vi.useFakeTimers();
        
        const user = { uuid: 'test-uuid-456', id: 2 };
        
        await notificationService.on_user_connected({ user });
        const firstTimeout = notificationService.merged_on_user_connected_[user.uuid];
        
        await notificationService.on_user_connected({ user });
        const secondTimeout = notificationService.merged_on_user_connected_[user.uuid];
        
        expect(firstTimeout).toBeDefined();
        expect(secondTimeout).toBeDefined();
        // The timeout should have been replaced
        
        vi.useRealTimers();
    });

    it('should handle notify with user ID selector', async () => {
        const userId = 123;
        const selector = UserIDNotifSelector(userId);
        
        const result = await selector(notificationService);
        
        expect(result).toEqual([userId]);
    });
});

describe('UsernameNotifSelector', () => {
    it('should create a selector function', () => {
        const selector = UsernameNotifSelector('testuser');
        
        expect(selector).toBeDefined();
        expect(typeof selector).toBe('function');
    });

    it('should return function that fetches user by username', async () => {
        const mockGetUserService = {
            get_user: vi.fn().mockResolvedValue({ id: 42, username: 'testuser' }),
        };
        
        const mockService = {
            services: {
                get: vi.fn().mockReturnValue(mockGetUserService),
            },
        };
        
        const selector = UsernameNotifSelector('testuser');
        const result = await selector(mockService as any);
        
        expect(mockService.services.get).toHaveBeenCalledWith('get-user');
        expect(mockGetUserService.get_user).toHaveBeenCalledWith({ username: 'testuser' });
        expect(result).toEqual([42]);
    });
});

describe('UserIDNotifSelector', () => {
    it('should create a selector function', () => {
        const selector = UserIDNotifSelector(123);
        
        expect(selector).toBeDefined();
        expect(typeof selector).toBe('function');
    });

    it('should return array with user ID', async () => {
        const userId = 456;
        const selector = UserIDNotifSelector(userId);
        
        const result = await selector(null as any);
        
        expect(result).toEqual([userId]);
    });

    it('should work with different user IDs', async () => {
        const selector1 = UserIDNotifSelector(100);
        const selector2 = UserIDNotifSelector(200);
        const selector3 = UserIDNotifSelector(300);
        
        const result1 = await selector1(null as any);
        const result2 = await selector2(null as any);
        const result3 = await selector3(null as any);
        
        expect(result1).toEqual([100]);
        expect(result2).toEqual([200]);
        expect(result3).toEqual([300]);
    });
});

