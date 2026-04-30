import { AlarmClient } from './alarm/AlarmClient';
import { DatabaseClientFactory } from './database';
import { EmailClient } from './email/EmailClient';
import { EventClient } from './EventClient';
import { DDBClient } from './dynamodb/DDBClient';
import { RedisClient } from './redis/RedisClient';
import { S3Client } from './s3/S3Client';
import type { IPuterClientRegistry } from './types';

export const puterClients = {
    alarm: AlarmClient,
    db: DatabaseClientFactory,
    email: EmailClient,
    event: EventClient,
    dynamo: DDBClient,
    redis: RedisClient,
    s3: S3Client,
} satisfies IPuterClientRegistry;
