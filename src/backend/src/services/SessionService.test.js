import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from './SessionService.js';
import { tmp_provide_services } from '../helpers.js';
import { redisClient } from '../clients/redis/redisSingleton.js';

describe('SessionService', () => {
    let getUserMock;
    const cachedSessionUuid = 'session-11111111-1111-1111-1111-111111111111';

    const createSessionService = () => {
        const sessionService = Object.create(SessionService.prototype);
        sessionService.sessions = {};
        sessionService.log = {
            warn: vi.fn(),
            tick: vi.fn(),
            debug: vi.fn(),
        };
        return sessionService;
    };

    beforeEach(async () => {
        getUserMock = vi.fn().mockResolvedValue({
            uuid: 'user-11111111-1111-1111-1111-111111111111',
        });
        await tmp_provide_services({
            ready: Promise.resolve(),
            get: (serviceName) => {
                if ( serviceName === 'get-user' ) {
                    return {
                        get_user: getUserMock,
                    };
                }
                throw new Error(`unexpected service lookup: ${serviceName}`);
            },
        });
    });

    afterEach(async () => {
        await redisClient.del(`session-cache:${cachedSessionUuid}`);
    });

    it('caches sessions in redis on create with five-minute ttl', async () => {
        const sessionService = createSessionService();
        sessionService.db = {
            write: vi.fn().mockResolvedValue({}),
        };
        sessionService.getSessionCacheKey = vi.fn().mockReturnValue(`session-cache:${cachedSessionUuid}`);

        const session = await sessionService.create_session({
            id: 42,
            uuid: 'user-11111111-1111-1111-1111-111111111111',
        }, {});

        const cacheKey = sessionService.getSessionCacheKey.mock.results[0].value;
        const cached = await redisClient.get(cacheKey);
        expect(cached).toBeTruthy();
        expect(JSON.parse(cached).uuid).toBe(session.uuid);
        expect(await redisClient.ttl(cacheKey)).toBeGreaterThan(0);
        expect(await redisClient.ttl(cacheKey)).toBeLessThanOrEqual(300);
    });

    it('loads sessions from redis cache before db on read', async () => {
        const sessionService = createSessionService();
        sessionService.db = {
            read: vi.fn(),
            case: ({ mysql }) => mysql,
        };
        const cachedSession = {
            uuid: cachedSessionUuid,
            user_id: 42,
            user_uid: 'user-11111111-1111-1111-1111-111111111111',
            meta: {},
            last_touch: Date.now(),
            last_store: Date.now(),
        };
        await sessionService.cacheSession(cachedSession);

        const session = await sessionService.get_session_(cachedSessionUuid);

        expect(sessionService.db.read).not.toHaveBeenCalled();
        expect(session.user_uid).toBe('user-11111111-1111-1111-1111-111111111111');
    });

    it('invalidates redis cache when removing session', async () => {
        const sessionService = createSessionService();
        sessionService.db = {
            write: vi.fn().mockResolvedValue({ anyRowsAffected: true }),
        };
        await sessionService.cacheSession({
            uuid: cachedSessionUuid,
            user_id: 42,
            user_uid: 'user-11111111-1111-1111-1111-111111111111',
            meta: {},
            last_touch: Date.now(),
            last_store: Date.now(),
        });

        await sessionService.remove_session(cachedSessionUuid);

        expect(await redisClient.get(`session-cache:${cachedSessionUuid}`)).toBeNull();
        expect(sessionService.db.write).toHaveBeenCalledWith(
            'DELETE FROM `sessions` WHERE `uuid` = ?',
            [cachedSessionUuid],
        );
    });

    it('loads session user uid using object lookup options', async () => {
        const sessionService = createSessionService();
        sessionService.db = {
            read: vi.fn().mockResolvedValue([{
                uuid: cachedSessionUuid,
                user_id: 42,
                meta: '{}',
            }]),
            case: ({ mysql }) => mysql,
        };

        const session = await sessionService.get_session_(cachedSessionUuid);

        expect(getUserMock).toHaveBeenCalledWith({ id: 42 });
        expect(session.user_uid).toBe('user-11111111-1111-1111-1111-111111111111');
    });
});
