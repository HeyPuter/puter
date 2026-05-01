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

import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';

export const PUTER_KV_STORE_TABLE_DEFINITION: CreateTableCommandInput = {
    TableName: 'store-kv-v1',
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
        { AttributeName: 'namespace', AttributeType: 'S' },
        { AttributeName: 'key', AttributeType: 'S' },
        { AttributeName: 'lsi1', AttributeType: 'S' },
    ],
    KeySchema: [
        { AttributeName: 'namespace', KeyType: 'HASH' },
        { AttributeName: 'key', KeyType: 'RANGE' },
    ],
    LocalSecondaryIndexes: [
        {
            IndexName: 'lsi1-index',
            KeySchema: [
                { AttributeName: 'namespace', KeyType: 'HASH' },
                { AttributeName: 'lsi1', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
        },
    ],
};
