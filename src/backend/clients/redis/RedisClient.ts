import Redis, { Cluster } from 'ioredis';
import MockRedis from 'ioredis-mock';
import type { IConfig, WithLifecycle } from '../../types';

const redisStartupRetryMaxDelayMs = 2000;
const redisSlotsRefreshTimeoutMs = 5000;
const redisConnectTimeoutMs = 10000;
const redisBootRetryRegex = /Cluster(All)?FailedError|None of startup nodes is available/i;

const formatRedisError = (error: unknown): string => {
    if ( error instanceof Error ) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
};

const attachClusterEventHandlers = (clusterClient: Cluster): void => {
    clusterClient.once('connect', () => {
        console.log('[redis] cluster transport connected');
    });

    clusterClient.once('ready', () => {
        console.log('[redis] cluster ready');
    });

    clusterClient.on('error', (error: unknown) => {
        const errorText = formatRedisError(error);
        if ( redisBootRetryRegex.test(errorText) ) {
            console.warn(`[redis] startup issue while connecting to cluster; retrying automatically (${errorText})`);
            return;
        }
        console.error('[redis] cluster error', error);
    });

    clusterClient.on('node error', (error: unknown, nodeKey: string) => {
        const errorText = formatRedisError(error);
        if ( redisBootRetryRegex.test(errorText) ) {
            console.warn(`[redis] startup issue for cluster node ${nodeKey}; retrying automatically (${errorText})`);
            return;
        }
        console.error(`[redis] cluster node error (${nodeKey})`, error);
    });
};

const buildCluster = (config: IConfig): Cluster => {
    const redisConfig = config.redis ?? {};
    const startupNodes = redisConfig.startupNodes ?? [];
    const useMock = redisConfig.useMock ?? startupNodes.length === 0;

    if ( useMock ) {
        console.log('connected to local redis mock');
        return new MockRedis.Cluster(['redis://localhost:7001']) as unknown as Cluster;
    }

    const cluster = new Redis.Cluster(startupNodes as ConstructorParameters<typeof Redis.Cluster>[0], {
        dnsLookup: (address, callback) => callback(null, address),
        clusterRetryStrategy: (attempts) => Math.min(100 + (attempts * 100), redisStartupRetryMaxDelayMs),
        retryDelayOnFailover: 500,
        retryDelayOnClusterDown: 1000,
        retryDelayOnTryAgain: 300,
        slotsRefreshTimeout: redisSlotsRefreshTimeoutMs,
        enableOfflineQueue: true,
        redisOptions: {
            tls: {},
            connectTimeout: redisConnectTimeoutMs,
            maxRetriesPerRequest: null,
        },
    });
    attachClusterEventHandlers(cluster);
    console.log('connecting to redis from config');
    return cluster;
};

/**
 * `RedisClient` IS the ioredis `Cluster` instance — consumers call
 * `this.clients.redis.get(...)` / `.set(...)` directly rather than
 * going through an inner `.client` field. Lifecycle methods
 * (`onServerShutdown`) are attached onto the cluster instance itself.
 *
 * Type-wise, `RedisClient` is `Cluster & WithLifecycle`; the registry-
 * facing value below is a constructor that returns that shape. Mirrors
 * the `DatabaseClientFactory` pattern.
 */
export type RedisClient = Cluster & WithLifecycle;

export const RedisClient = class RedisClient {
    constructor (config: IConfig) {
        const cluster = buildCluster(config);

        const onServerShutdown = async (): Promise<void> => {
            try {
                await cluster.quit();
            } catch ( error ) {
                console.warn('[redis] failed to quit redis client cleanly', error);
                cluster.disconnect();
            }
        };

        // Attach lifecycle hooks directly onto the cluster instance so the
        // server boot loop's `if (client.onServerShutdown) client.onServerShutdown()`
        // picks them up without a wrapper object.
        Object.assign(cluster, { onServerShutdown });

        return cluster as unknown as RedisClient;
    }
} as unknown as new (config: IConfig) => RedisClient;
