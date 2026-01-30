import Redis, { Cluster } from 'ioredis';
import MockRedis from 'ioredis-mock';

let redisOpt: Cluster;

if ( process.env.REDIS_CONFIG ) {
    const redisConfig = JSON.parse(process.env.REDIS_CONFIG);
    redisOpt = new Redis.Cluster(redisConfig);
} else {
    redisOpt = new MockRedis.Cluster(['redis://localhost:7001']);
}

export const redisClient = redisOpt;