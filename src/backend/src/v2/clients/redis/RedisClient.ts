import Redis, { Cluster } from 'ioredis';
import MockRedis from 'ioredis-mock';
import type { IConfig, IRedisConfig } from '../../types';
import { PuterClient } from '../types';

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

export class RedisClient extends PuterClient {
    readonly client: Cluster;

    constructor (config: IConfig) {
        super(config);

        const redisConfig = this.#getRedisConfig(config);
        const startupNodes = redisConfig.startupNodes ?? redisConfig.clusterNodes ?? [];
        const useMock = redisConfig.useMock ?? startupNodes.length === 0;

        if ( useMock ) {
            this.client = new MockRedis.Cluster(['redis://localhost:7001']) as unknown as Cluster;
            console.log('connected to local redis mock');
            return;
        }

        this.client = new Redis.Cluster(startupNodes as ConstructorParameters<typeof Redis.Cluster>[0], {
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
        attachClusterEventHandlers(this.client);
        console.log('connecting to redis from config');
    }

    override async onServerShutdown (): Promise<void> {
        try {
            await this.client.quit();
        } catch ( error ) {
            console.warn('[redis] failed to quit redis client cleanly', error);
            this.client.disconnect();
        }
    }

    #getRedisConfig (config: IConfig): IRedisConfig {
        return config.redis ?? config.services?.redis ?? {};
    }
}
