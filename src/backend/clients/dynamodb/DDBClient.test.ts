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

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types';
import { DDBClient } from './DDBClient';

const TABLE = 'kv-items';
const GSI = 'by-kind';

const localConfig = (): IConfig =>
    ({
        port: 0,
        extensions: [],
        dynamo: { inMemory: true, bootstrapTables: true },
    }) as unknown as IConfig;

/**
 * The emulator reports a table as CREATING for a tick after `CreateTable`
 * returns, so wait until it actually answers a read before using it.
 */
const awaitTable = async (
    client: DDBClient,
    table: string,
    key: Record<string, unknown>,
): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            await client.get(table, key);
            return;
        } catch (error) {
            if ((error as Error).name !== 'ResourceNotFoundException')
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
    throw new Error(`table ${table} never became queryable`);
};

const tableSchema = {
    TableName: TABLE,
    KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' as const },
        { AttributeName: 'sk', KeyType: 'RANGE' as const },
    ],
    AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' as const },
        { AttributeName: 'sk', AttributeType: 'S' as const },
        { AttributeName: 'kind', AttributeType: 'S' as const },
    ],
    GlobalSecondaryIndexes: [
        {
            IndexName: GSI,
            KeySchema: [{ AttributeName: 'kind', KeyType: 'HASH' as const }],
            Projection: { ProjectionType: 'ALL' as const },
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5,
            },
        },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
};

describe('DDBClient — item operations', () => {
    let client: DDBClient;

    beforeAll(async () => {
        client = new DDBClient(localConfig());
        await client.createTableIfNotExists(tableSchema);
        await awaitTable(client, TABLE, { pk: 'ready', sk: 'ready' });
    });

    it('round-trips an item and reports consumed capacity', async () => {
        await client.put(TABLE, { pk: 'u1', sk: 'profile', name: 'ada' });

        const result = await client.get(TABLE, { pk: 'u1', sk: 'profile' });
        expect(result.Item).toEqual({ pk: 'u1', sk: 'profile', name: 'ada' });
        expect(result.ConsumedCapacity?.TableName).toBe(TABLE);
    });

    it('returns no Item for a key that does not exist', async () => {
        const result = await client.get(TABLE, { pk: 'nobody', sk: 'here' });
        expect(result.Item).toBeUndefined();
    });

    it('honours a strongly consistent read', async () => {
        await client.put(TABLE, { pk: 'u2', sk: 'profile', name: 'grace' });
        const result = await client.get(
            TABLE,
            { pk: 'u2', sk: 'profile' },
            true,
        );
        expect(result.Item?.name).toBe('grace');
    });

    it('applies an update expression and returns the new item', async () => {
        await client.put(TABLE, { pk: 'u3', sk: 'counter', hits: 1 });
        const updated = await client.update(
            TABLE,
            { pk: 'u3', sk: 'counter' },
            'SET #h = :next',
            { ':next': 5 },
            { '#h': 'hits' },
        );
        expect(updated.Attributes).toMatchObject({ hits: 5 });
    });

    it('supports an update expression with no values or names', async () => {
        await client.put(TABLE, { pk: 'u4', sk: 'doc', stale: true });
        const updated = await client.update(
            TABLE,
            { pk: 'u4', sk: 'doc' },
            'REMOVE stale',
        );
        expect(updated.Attributes).toEqual({ pk: 'u4', sk: 'doc' });
    });

    it('deletes an item', async () => {
        await client.put(TABLE, { pk: 'u5', sk: 'temp' });
        await client.del(TABLE, { pk: 'u5', sk: 'temp' });
        const result = await client.get(TABLE, { pk: 'u5', sk: 'temp' });
        expect(result.Item).toBeUndefined();
    });

    it('fetches keys from several tables in one batch', async () => {
        await client.put(TABLE, { pk: 'b1', sk: 'a', v: 1 });
        await client.put(TABLE, { pk: 'b1', sk: 'b', v: 2 });

        const result = await client.batchGet([
            { table: TABLE, items: { pk: 'b1', sk: 'a' } },
            { table: TABLE, items: { pk: 'b1', sk: 'b' } },
        ]);

        const values = (result.Responses?.[TABLE] ?? [])
            .map((item) => item.v as number)
            .sort();
        expect(values).toEqual([1, 2]);
    });
});

describe('DDBClient — queries', () => {
    let client: DDBClient;

    beforeAll(async () => {
        client = new DDBClient(localConfig());
        await client.createTableIfNotExists(tableSchema);
        await awaitTable(client, TABLE, { pk: 'ready', sk: 'ready' });
        for (const sk of ['post#1', 'post#2', 'post#3', 'note#1']) {
            await client.put(TABLE, {
                pk: 'q1',
                sk,
                kind: sk.split('#')[0],
                size: sk === 'post#2' ? 10 : 1,
            });
        }
    });

    it('queries by partition key', async () => {
        const result = await client.query(TABLE, { pk: 'q1' });
        expect(result.Items).toHaveLength(4);
        expect(result.ConsumedCapacity?.TableName).toBe(TABLE);
    });

    it('narrows the sort key with begins_with', async () => {
        const result = await client.query(
            TABLE,
            { pk: 'q1' },
            0,
            undefined,
            '',
            false,
            { beginsWith: { key: 'sk', value: 'post#' } },
        );
        expect(result.Items?.map((item) => item.sk)).toEqual([
            'post#1',
            'post#2',
            'post#3',
        ]);
    });

    it('ignores an empty begins_with value', async () => {
        const result = await client.query(
            TABLE,
            { pk: 'q1' },
            0,
            undefined,
            '',
            false,
            { beginsWith: { key: 'sk', value: '' } },
        );
        expect(result.Items).toHaveLength(4);
    });

    it('applies a filter expression with its own names and values', async () => {
        const result = await client.query(
            TABLE,
            { pk: 'q1' },
            0,
            undefined,
            '',
            false,
            {
                filter: {
                    expression: '#s > :min',
                    names: { '#s': 'size' },
                    values: { ':min': 5 },
                },
            },
        );
        expect(result.Items?.map((item) => item.sk)).toEqual(['post#2']);
    });

    it('counts without returning items', async () => {
        const result = await client.query(
            TABLE,
            { pk: 'q1' },
            0,
            undefined,
            '',
            false,
            { select: 'COUNT' },
        );
        expect(result.Count).toBe(4);
        expect(result.Items).toBeUndefined();
    });

    it('pages through results with the last evaluated key', async () => {
        const seen: string[] = [];
        let pageKey: Record<string, unknown> | undefined;
        let pages = 0;

        do {
            const page = await client.query(TABLE, { pk: 'q1' }, 2, pageKey);
            pages += 1;
            expect(page.Items?.length).toBeLessThanOrEqual(2);
            for (const item of page.Items ?? []) seen.push(item.sk as string);
            pageKey = page.LastEvaluatedKey;
        } while (pageKey && pages < 10);

        expect(pages).toBeGreaterThan(1);
        expect(new Set(seen).size).toBe(4);
    });

    it('queries a secondary index', async () => {
        const result = await client.query(
            TABLE,
            { kind: 'note' },
            0,
            undefined,
            GSI,
        );
        expect(result.Items?.map((item) => item.sk)).toEqual(['note#1']);
    });
});

describe('DDBClient — batch writes', () => {
    let client: DDBClient;

    beforeAll(async () => {
        client = new DDBClient(localConfig());
        await client.createTableIfNotExists(tableSchema);
        await awaitTable(client, TABLE, { pk: 'ready', sk: 'ready' });
    });

    it('reports no consumed capacity for an empty batch', async () => {
        await expect(client.batchPut([])).resolves.toEqual({
            ConsumedCapacity: [],
        });
    });

    it('splits a batch larger than the service limit into chunks', async () => {
        const params = Array.from({ length: 60 }, (_, index) => ({
            table: TABLE,
            item: { pk: 'bulk', sk: `item-${index}`, index },
        }));

        const result = await client.batchPut(params);

        expect(result.ConsumedCapacity).toHaveLength(1);
        expect(result.ConsumedCapacity[0].TableName).toBe(TABLE);
        expect(result.ConsumedCapacity[0].CapacityUnits).toBeGreaterThan(0);

        const stored = await client.query(TABLE, { pk: 'bulk' });
        expect(stored.Items).toHaveLength(60);
    });
});

describe('DDBClient — expired item sweep', () => {
    it('deletes only the items past their ttl when the table already existed', async () => {
        const client = new DDBClient(localConfig());
        const table = 'ttl-items';
        const schema = {
            TableName: table,
            KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' as const }],
            AttributeDefinitions: [
                { AttributeName: 'pk', AttributeType: 'S' as const },
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5,
            },
        };

        await client.createTableIfNotExists(schema, 'expireAt');
        await awaitTable(client, table, { pk: 'ready' });
        const now = Math.floor(Date.now() / 1000);
        await client.put(table, { pk: 'stale', expireAt: now - 60 });
        await client.put(table, { pk: 'fresh', expireAt: now + 3600 });
        await client.put(table, { pk: 'eternal' });

        // Second call finds the table in use, so the sweep runs.
        await client.createTableIfNotExists(schema, 'expireAt');

        expect((await client.get(table, { pk: 'stale' })).Item).toBeUndefined();
        expect((await client.get(table, { pk: 'fresh' })).Item).toBeDefined();
        expect((await client.get(table, { pk: 'eternal' })).Item).toBeDefined();
    });
});

describe('DDBClient — expired item sweep on an empty table', () => {
    it('completes without deleting anything', async () => {
        const client = new DDBClient(localConfig());
        const table = 'ttl-empty';
        const schema = {
            TableName: table,
            KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' as const }],
            AttributeDefinitions: [
                { AttributeName: 'pk', AttributeType: 'S' as const },
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5,
            },
        };

        await client.createTableIfNotExists(schema, 'expireAt');
        await awaitTable(client, table, { pk: 'ready' });
        await expect(
            client.createTableIfNotExists(schema, 'expireAt'),
        ).resolves.toBeUndefined();
    });
});

describe('DDBClient — credentialled configuration', () => {
    it('refuses an aws config that is missing a key', () => {
        expect(
            () =>
                new DDBClient({
                    port: 0,
                    extensions: [],
                    dynamo: { aws: { access_key: 'only-one' } },
                } as unknown as IConfig),
        ).toThrow('requires both `access_key` and `secret_key`');
    });

    it('skips table creation on a managed deployment', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const client = new DDBClient({
            port: 0,
            extensions: [],
            dynamo: {
                aws: { access_key: 'a', secret_key: 'b', region: 'us-west-2' },
                endpoint: 'http://127.0.0.1:1',
            },
        } as unknown as IConfig);

        // Would fail against the unreachable endpoint if it actually tried.
        await client.createTableIfNotExists(tableSchema);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining(
                'Creating DynamoDB tables is disabled by default',
            ),
        );
        warn.mockRestore();
    });

    it('rebinds an aws-credentialled client on recreate', async () => {
        const client = new DDBClient({
            port: 0,
            extensions: [],
            dynamo: {
                aws: { access_key: 'a', secret_key: 'b' },
                endpoint: 'http://127.0.0.1:1',
            },
        } as unknown as IConfig);

        await expect(client.recreateClient()).resolves.toBeUndefined();
    });

    it('rebinds the underlying client on recreate', async () => {
        const client = new DDBClient(localConfig());
        await client.createTableIfNotExists(tableSchema);
        await awaitTable(client, TABLE, { pk: 'ready', sk: 'ready' });
        await client.put(TABLE, { pk: 'recreate', sk: 'a', v: 1 });

        await client.recreateClient();

        // Same in-memory store: the recreated client sees earlier writes.
        const result = await client.get(TABLE, { pk: 'recreate', sk: 'a' });
        expect(result.Item?.v).toBe(1);
    });
});

// Unprocessed items are a throttling signal the emulator never produces, so
// the retry loop is driven against a stub speaking the DynamoDB wire format.
describe('DDBClient — unprocessed batch items', () => {
    let server: Server;
    let endpoint: string;
    let responses: unknown[];
    let requestCount = 0;

    beforeAll(async () => {
        server = createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                const next = responses.shift() ?? {};
                requestCount += 1;
                res.writeHead(200, {
                    'content-type': 'application/x-amz-json-1.0',
                });
                res.end(JSON.stringify(next));
            });
        });
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve),
        );
        endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const stubClient = () =>
        new DDBClient({
            port: 0,
            extensions: [],
            dynamo: {
                aws: { access_key: 'a', secret_key: 'b', region: 'us-west-2' },
                endpoint,
            },
        } as unknown as IConfig);

    const unprocessed = (pk: string) => ({
        UnprocessedItems: {
            [TABLE]: [{ PutRequest: { Item: { pk: { S: pk } } } }],
        },
        ConsumedCapacity: [{ TableName: TABLE, CapacityUnits: 1 }],
    });

    it('retries the leftover items and sums capacity across attempts', async () => {
        requestCount = 0;
        responses = [
            unprocessed('retry-me'),
            {
                UnprocessedItems: {},
                ConsumedCapacity: [{ TableName: TABLE, CapacityUnits: 2 }],
            },
        ];

        const result = await stubClient().batchPut([
            { table: TABLE, item: { pk: 'retry-me' } },
        ]);

        expect(requestCount).toBe(2);
        expect(result.ConsumedCapacity).toEqual([
            { TableName: TABLE, CapacityUnits: 3 },
        ]);
    });

    it('gives up with a bad-request error when items never drain', async () => {
        requestCount = 0;
        responses = Array.from({ length: 12 }, () => unprocessed('stuck'));

        await expect(
            stubClient().batchPut([{ table: TABLE, item: { pk: 'stuck' } }]),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'bad_request',
            message: 'Failed to batch write all items to DynamoDB',
        });
        // One initial attempt plus the full retry budget.
        expect(requestCount).toBe(9);
    }, 30_000);

    it('tolerates a response that reports no capacity at all', async () => {
        requestCount = 0;
        responses = [{ UnprocessedItems: {} }];

        await expect(
            stubClient().batchPut([{ table: TABLE, item: { pk: 'quiet' } }]),
        ).resolves.toEqual({ ConsumedCapacity: [] });
        expect(requestCount).toBe(1);
    });

    it('ignores capacity entries with no table name', async () => {
        requestCount = 0;
        responses = [
            {
                UnprocessedItems: {},
                ConsumedCapacity: [{ CapacityUnits: 7 }],
            },
        ];

        await expect(
            stubClient().batchPut([{ table: TABLE, item: { pk: 'anon' } }]),
        ).resolves.toEqual({ ConsumedCapacity: [] });
    });
});
