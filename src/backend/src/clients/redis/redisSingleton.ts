import Redis, { Cluster } from 'ioredis';
import MockRedis from 'ioredis-mock';

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

let redisOpt: Cluster;

if ( process.env.REDIS_CONFIG ) {
    const redisConfig = JSON.parse(process.env.REDIS_CONFIG);
    redisOpt = new Redis.Cluster(redisConfig, {
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
    attachClusterEventHandlers(redisOpt);
    console.log('connecting to redis from config');
} else {
    redisOpt = new MockRedis.Cluster(['redis://localhost:7001']);
    console.log('connected to local redis mock');
}

export const redisClient = redisOpt;
