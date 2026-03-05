import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => {
    const redisClusterInstances: Array<{
        on: ReturnType<typeof vi.fn>;
        once: ReturnType<typeof vi.fn>;
    }> = [];

    return {
        redisClusterInstances,
        redisClusterConstructorMock: vi.fn(),
        mockRedisClusterConstructorMock: vi.fn(),
    };
});

vi.mock('ioredis', () => {
    class RedisClusterMock {
        on = vi.fn().mockReturnThis();
        once = vi.fn().mockReturnThis();

        constructor (...args: unknown[]) {
            redisMocks.redisClusterConstructorMock(...args);
            redisMocks.redisClusterInstances.push(this);
        }
    }

    return {
        default: {
            Cluster: RedisClusterMock,
        },
    };
});

vi.mock('ioredis-mock', () => {
    class MockRedisClusterMock {
        constructor (...args: unknown[]) {
            redisMocks.mockRedisClusterConstructorMock(...args);
        }
    }

    return {
        default: {
            Cluster: MockRedisClusterMock,
        },
    };
});

describe('redisSingleton', () => {
    const initialRedisConfig = process.env.REDIS_CONFIG;

    beforeEach(() => {
        vi.resetModules();
        redisMocks.redisClusterInstances.length = 0;
        redisMocks.redisClusterConstructorMock.mockReset();
        redisMocks.mockRedisClusterConstructorMock.mockReset();
        process.env.REDIS_CONFIG = JSON.stringify([{ host: '127.0.0.1', port: 6379 }]);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        if ( initialRedisConfig === undefined ) {
            delete process.env.REDIS_CONFIG;
        } else {
            process.env.REDIS_CONFIG = initialRedisConfig;
        }
        vi.restoreAllMocks();
    });

    it('uses resilient cluster options and registers startup-safe listeners', async () => {
        const singletonModule = await import('./redisSingleton.ts');

        expect(redisMocks.redisClusterConstructorMock).toHaveBeenCalledTimes(1);
        const [startupNodes, clusterOptions] = redisMocks.redisClusterConstructorMock.mock.calls[0];

        expect(startupNodes).toEqual([{ host: '127.0.0.1', port: 6379 }]);
        expect(clusterOptions).toEqual(expect.objectContaining({
            enableOfflineQueue: true,
            retryDelayOnFailover: 500,
            retryDelayOnClusterDown: 1000,
            retryDelayOnTryAgain: 300,
            slotsRefreshTimeout: 5000,
            clusterRetryStrategy: expect.any(Function),
            dnsLookup: expect.any(Function),
            redisOptions: expect.objectContaining({
                connectTimeout: 10000,
                maxRetriesPerRequest: null,
                tls: {},
            }),
        }));
        expect(clusterOptions.clusterRetryStrategy(1)).toBe(200);
        expect(clusterOptions.clusterRetryStrategy(100)).toBe(2000);

        const clusterInstance = redisMocks.redisClusterInstances[0];
        expect(singletonModule.redisClient).toBe(clusterInstance);
        expect(clusterInstance.once).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(clusterInstance.once).toHaveBeenCalledWith('ready', expect.any(Function));
        expect(clusterInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(clusterInstance.on).toHaveBeenCalledWith('node error', expect.any(Function));
    });
});
