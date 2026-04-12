import { DatabaseClientFactory } from './database';
import { EventClient } from './EventClient';
import { DDBClient } from './dynamodb/DDBClient';
import { RedisClient } from './redis/RedisClient';
import { S3Client } from './s3/S3Client';
import type { IPuterClientRegistry } from './types';

export const puterClients = {
    db: DatabaseClientFactory,
    event: EventClient,
    dynamo: DDBClient,
    redis: RedisClient,
    s3: S3Client,
} satisfies IPuterClientRegistry;
