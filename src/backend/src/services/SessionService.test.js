import { describe, expect, it, vi } from 'vitest';
import { createTestKernel } from '../../tools/test.mjs';
import { SessionService } from './SessionService.js';
import { tmp_provide_services } from '../helpers.js';
import { redisClient } from '../clients/redis/redisSingleton.js';

describe('SessionService', async () => {
    const testKernel = await createTestKernel({
        initLevelString: 'init',
        testCore: true,
        serviceMap: {
            session: SessionService,
        },
        serviceConfigOverrideMap: {
            database: {
                path: ':memory:',
            },
        },
    });

    await tmp_provide_services(testKernel.services);

    const sessionService = testKernel.services.get('session');
    const db = testKernel.services.get('database').get('write', 'session-test');

    const makeUnique = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const createUser = async () => {
        const userUuid = makeUnique('user');
        const username = makeUnique('session-user');
        await db.write(
            'INSERT INTO `user` (`uuid`, `username`) VALUES (?, ?)',
            [userUuid, username],
        );
        const [user] = await db.read(
            'SELECT * FROM `user` WHERE `uuid` = ? LIMIT 1',
            [userUuid],
        );
        return user;
    };

    const clearSessionState = async (sessionUuid, userId) => {
        if ( sessionUuid ) {
            await redisClient.del(sessionService.getSessionCacheKey(sessionUuid));
            await redisClient.srem('session-cache:flush-pending', sessionUuid);
            if ( userId ) {
                await redisClient.srem(
                    sessionService.getSessionUserSetKey(userId),
                    sessionUuid,
                );
            }
            await db.write('DELETE FROM `sessions` WHERE `uuid` = ?', [sessionUuid]);
        }
    };

    it('caches sessions in redis on create with five-minute ttl', async () => {
        const user = await createUser();
        const session = await sessionService.create_session(user, {});
        try {
            const cacheKey = sessionService.getSessionCacheKey(session.uuid);
            const cached = await redisClient.get(cacheKey);
            expect(cached).toBeTruthy();
            expect(JSON.parse(cached).uuid).toBe(session.uuid);
            expect(await redisClient.ttl(cacheKey)).toBeGreaterThan(0);
            expect(await redisClient.ttl(cacheKey)).toBeLessThanOrEqual(300);
            const cachedUserSessionUuids = await redisClient.smembers(
                sessionService.getSessionUserSetKey(user.id),
            );
            expect(cachedUserSessionUuids).toContain(session.uuid);
        } finally {
            await clearSessionState(session.uuid, user.id);
        }
    });

    it('loads sessions from redis cache before db on read', async () => {
        const user = await createUser();
        const session = await sessionService.create_session(user, {});
        const dbReadSpy = vi.spyOn(sessionService.db, 'tryHardRead');
        try {
            const loaded = await sessionService.getSession(session.uuid);
            expect(dbReadSpy).not.toHaveBeenCalled();
            expect(loaded.user_uid).toBe(user.uuid);
            const pendingSessions = await redisClient.smembers('session-cache:flush-pending');
            expect(pendingSessions).toContain(session.uuid);
        } finally {
            dbReadSpy.mockRestore();
            await clearSessionState(session.uuid, user.id);
        }
    });

    it('invalidates redis cache when removing session', async () => {
        const user = await createUser();
        const session = await sessionService.create_session(user, {});
        await sessionService.remove_session(session.uuid);

        const [dbSession] = await db.read(
            'SELECT * FROM `sessions` WHERE `uuid` = ? LIMIT 1',
            [session.uuid],
        );
        expect(await redisClient.get(`session-cache:${session.uuid}`)).toBeNull();
        expect(dbSession).toBeUndefined();
        const pendingSessions = await redisClient.smembers('session-cache:flush-pending');
        expect(pendingSessions).not.toContain(session.uuid);
        const cachedUserSessionUuids = await redisClient.smembers(
            sessionService.getSessionUserSetKey(user.id),
        );
        expect(cachedUserSessionUuids).not.toContain(session.uuid);
    });

    it('loads session user uid using object lookup options', async () => {
        const user = await createUser();
        const session = await sessionService.create_session(user, {});

        await redisClient.del(`session-cache:${session.uuid}`);

        const loadedSession = await sessionService.getSession(session.uuid);
        try {
            expect(loadedSession.user_uid).toBe(user.uuid);
        } finally {
            await clearSessionState(session.uuid, user.id);
        }
    });
});
