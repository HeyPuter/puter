/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { AlarmClient } from './alarm/AlarmClient';
import { DatabaseClientFactory } from './database';
import { EmailClient } from './email/EmailClient';
import { EventClient } from './event/EventClient';
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
