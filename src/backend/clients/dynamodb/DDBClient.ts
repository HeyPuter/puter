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

import {
    CreateTableCommand,
    CreateTableCommandInput,
    DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
    BatchGetCommand,
    BatchGetCommandInput,
    BatchWriteCommand,
    BatchWriteCommandInput,
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
    ScanCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import dynalite from 'dynalite';
import { once } from 'node:events';
import { Agent as httpsAgent } from 'node:https';
import { PuterClient } from '../types';
import type { IConfig, IDynamoConfig } from '../../types';

const LOCAL_DYNAMO_PATH_KEY = ':memory:';
const localDynaliteEndpointPromises = new Map<string, Promise<string>>();
const MAX_BATCH_WRITE_ITEMS = 25;
const MAX_BATCH_WRITE_RETRIES = 8;
const BATCH_WRITE_RETRY_BASE_MS = 25;

const getDynalitePathKey = (path?: string) => {
    if (path === ':memory:') return LOCAL_DYNAMO_PATH_KEY;
    return path || './volatile/runtime/puter-ddb';
};

const getOrCreateLocalDynaliteEndpoint = async (pathKey: string) => {
    let endpointPromise = localDynaliteEndpointPromises.get(pathKey);
    if (endpointPromise) return endpointPromise;

    endpointPromise = (async () => {
        const dynaliteOptions =
            pathKey === LOCAL_DYNAMO_PATH_KEY
                ? { createTableMs: 0 }
                : { createTableMs: 0, path: pathKey };

        const dynaliteInstance = dynalite(dynaliteOptions);
        const dynaliteServer = dynaliteInstance.listen(0, '127.0.0.1');
        dynaliteServer.unref?.();
        await once(dynaliteServer, 'listening');

        const address = dynaliteServer.address();
        const port =
            (typeof address === 'object' && address
                ? address.port
                : undefined) || 4567;
        return `http://127.0.0.1:${port}`;
    })();

    localDynaliteEndpointPromises.set(pathKey, endpointPromise);
    endpointPromise.catch(() => {
        if (localDynaliteEndpointPromises.get(pathKey) === endpointPromise) {
            localDynaliteEndpointPromises.delete(pathKey);
        }
    });

    return endpointPromise;
};

const chunkValues = <T>(values: T[], size: number): T[][] => {
    if (values.length === 0) {
        return [];
    }

    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
};

const sleep = async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
};

export class DDBClient extends PuterClient {
    #documentClient: DynamoDBDocumentClient | null = null;
    #localInitPromise: Promise<void> | null = null;
    #ddbConfig: IDynamoConfig;

    constructor(config: IConfig) {
        super(config);
        this.#ddbConfig = config.dynamo ?? {};

        if (this.#ddbConfig.aws) {
            this.#bindAwsClient();
            return;
        }

        this.#localInitPromise = this.#bindLocalClient();
        this.#localInitPromise.catch((error) => {
            console.error('Failed to initialize local DynamoDB client', error);
        });
    }

    async recreateClient() {
        if (this.#ddbConfig.aws) {
            this.#bindAwsClient();
            return;
        }

        this.#localInitPromise = this.#bindLocalClient();
        await this.#localInitPromise;
    }

    async get<T extends Record<string, unknown>>(
        table: string,
        key: T,
        consistentRead = false,
    ) {
        const command = new GetCommand({
            TableName: table,
            Key: key,
            ConsistentRead: consistentRead,
            ReturnConsumedCapacity: 'TOTAL',
        });

        const client = await this.#getDocumentClient();
        return client.send(command);
    }

    async put<T extends Record<string, unknown>>(table: string, item: T) {
        const command = new PutCommand({
            TableName: table,
            Item: item,
            ReturnConsumedCapacity: 'TOTAL',
        });

        const client = await this.#getDocumentClient();
        return client.send(command);
    }

    async batchGet(
        params: { table: string; items: Record<string, unknown> }[],
        consistentRead = false,
    ) {
        const allRequestItemsPerTable = params.reduce(
            (acc, curr) => {
                if (!acc[curr.table]) acc[curr.table] = [];
                acc[curr.table].push(curr.items);
                return acc;
            },
            {} as Record<string, Record<string, unknown>[]>,
        );

        const requestItems: BatchGetCommandInput['RequestItems'] =
            Object.entries(allRequestItemsPerTable).reduce(
                (acc, [table, keyList]) => {
                    acc[table] = {
                        Keys: keyList,
                        ConsistentRead: consistentRead,
                    };
                    return acc;
                },
                {} as NonNullable<BatchGetCommandInput['RequestItems']>,
            );

        const command = new BatchGetCommand({
            RequestItems: requestItems,
            ReturnConsumedCapacity: 'TOTAL',
        });

        const client = await this.#getDocumentClient();
        return client.send(command);
    }

    async batchPut(params: { table: string; item: Record<string, unknown> }[]) {
        const consumedCapacityByTable = new Map<string, number>();
        if (params.length === 0) {
            return { ConsumedCapacity: [] };
        }

        const accumulateConsumedCapacity = (
            consumedCapacityEntries:
                | Array<{ TableName?: string; CapacityUnits?: number }>
                | undefined,
        ) => {
            if (!consumedCapacityEntries) {
                return;
            }

            for (const consumedCapacityEntry of consumedCapacityEntries) {
                const table = consumedCapacityEntry.TableName;
                if (!table) {
                    continue;
                }

                const existingUsage = consumedCapacityByTable.get(table) ?? 0;
                consumedCapacityByTable.set(
                    table,
                    existingUsage +
                        Number(consumedCapacityEntry.CapacityUnits ?? 0),
                );
            }
        };

        const client = await this.#getDocumentClient();
        const chunks = chunkValues(params, MAX_BATCH_WRITE_ITEMS);

        for (const chunk of chunks) {
            let requestItems = chunk.reduce(
                (acc, curr) => {
                    const tableRequests = acc[curr.table] ?? [];
                    tableRequests.push({
                        PutRequest: {
                            Item: curr.item,
                        },
                    });
                    acc[curr.table] = tableRequests;
                    return acc;
                },
                {} as NonNullable<BatchWriteCommandInput['RequestItems']>,
            );

            for (
                let attempt = 0;
                attempt <= MAX_BATCH_WRITE_RETRIES;
                attempt++
            ) {
                if (Object.keys(requestItems).length === 0) {
                    break;
                }

                const response = await client.send(
                    new BatchWriteCommand({
                        RequestItems: requestItems,
                        ReturnConsumedCapacity: 'TOTAL',
                    }),
                );
                accumulateConsumedCapacity(
                    response.ConsumedCapacity as
                        | Array<{ TableName?: string; CapacityUnits?: number }>
                        | undefined,
                );

                const unprocessedItems = response.UnprocessedItems ?? {};
                if (Object.keys(unprocessedItems).length === 0) {
                    requestItems = {};
                    break;
                }

                requestItems = unprocessedItems as NonNullable<
                    BatchWriteCommandInput['RequestItems']
                >;
                if (attempt < MAX_BATCH_WRITE_RETRIES) {
                    const delayMs = Math.min(
                        1000,
                        BATCH_WRITE_RETRY_BASE_MS * 2 ** attempt,
                    );
                    await sleep(delayMs);
                }
            }

            if (Object.keys(requestItems).length > 0) {
                throw new Error('Failed to batch write all items to DynamoDB');
            }
        }

        return {
            ConsumedCapacity: Array.from(consumedCapacityByTable.entries()).map(
                ([TableName, CapacityUnits]) => ({
                    TableName,
                    CapacityUnits,
                }),
            ),
        };
    }

    async del<T extends Record<string, unknown>>(table: string, key: T) {
        const command = new DeleteCommand({
            TableName: table,
            Key: key,
            ReturnConsumedCapacity: 'TOTAL',
        });

        const client = await this.#getDocumentClient();
        return client.send(command);
    }

    async query<T extends Record<string, unknown>>(
        table: string,
        keys: T,
        limit = 0,
        pageKey?: Record<string, unknown>,
        index = '',
        consistentRead = false,
        options?: { beginsWith?: { key: string; value: string } },
    ) {
        const keyExpressionParts = Object.keys(keys).map(
            (key) => `#${key} = :${key}`,
        );
        const expressionAttributeValues = Object.entries(keys).reduce(
            (acc, [key, value]) => {
                acc[`:${key}`] = value;
                return acc;
            },
            {} as Record<string, unknown>,
        );
        const expressionAttributeNames = Object.keys(keys).reduce(
            (acc, key) => {
                acc[`#${key}`] = key;
                return acc;
            },
            {} as Record<string, string>,
        );

        if (options?.beginsWith?.key && options.beginsWith.value !== '') {
            const beginsKey = options.beginsWith.key;
            const beginsValueToken = `:${beginsKey}_begins_with`;
            keyExpressionParts.push(
                `begins_with(#${beginsKey}, ${beginsValueToken})`,
            );
            expressionAttributeValues[beginsValueToken] =
                options.beginsWith.value;
            expressionAttributeNames[`#${beginsKey}`] = beginsKey;
        }

        const command = new QueryCommand({
            TableName: table,
            ...(!index ? {} : { IndexName: index }),
            KeyConditionExpression: keyExpressionParts.join(' AND '),
            ExpressionAttributeValues: expressionAttributeValues,
            ExpressionAttributeNames: expressionAttributeNames,
            ConsistentRead: consistentRead,
            ...(!pageKey ? {} : { ExclusiveStartKey: pageKey }),
            ...(!limit ? {} : { Limit: limit }),
            ReturnConsumedCapacity: 'TOTAL',
        });

        const client = await this.#getDocumentClient();
        return client.send(command);
    }

    async update<T extends Record<string, unknown>>(
        table: string,
        key: T,
        expression: string,
        expressionValues?: Record<string, unknown>,
        expressionNames?: Record<string, string>,
    ) {
        const hasValues =
            !!expressionValues && Object.keys(expressionValues).length > 0;
        const hasNames =
            !!expressionNames && Object.keys(expressionNames).length > 0;
        const command = new UpdateCommand({
            TableName: table,
            Key: key,
            UpdateExpression: expression,
            ...(hasValues
                ? { ExpressionAttributeValues: expressionValues }
                : {}),
            ...(hasNames ? { ExpressionAttributeNames: expressionNames } : {}),
            ReturnValues: 'ALL_NEW',
            ReturnConsumedCapacity: 'TOTAL',
        });

        try {
            const client = await this.#getDocumentClient();
            return await client.send(command);
        } catch (error) {
            console.error('DDB Update Error', error);
            throw error;
        }
    }

    async createTableIfNotExists(
        params: CreateTableCommandInput,
        ttlAttribute?: string,
    ) {
        if (this.#ddbConfig.aws) {
            console.warn(
                'Creating DynamoDB tables in AWS is disabled by default, but if needed, update DDBClient',
            );
            return;
        }

        try {
            const client = await this.#getDocumentClient();
            await client.send(new CreateTableCommand(params));
        } catch (error) {
            if ((error as Error)?.name !== 'ResourceInUseException') {
                throw error;
            }
        }

        if (ttlAttribute) {
            await this.#deleteExpiredItems(
                params.TableName!,
                params.KeySchema!,
                ttlAttribute,
            );
        }
    }

    async #getDocumentClient() {
        if (this.#documentClient) {
            return this.#documentClient;
        }

        if (this.#localInitPromise) {
            await this.#localInitPromise;
        }

        if (!this.#documentClient) {
            throw new Error('DynamoDB document client is not initialized');
        }

        return this.#documentClient;
    }

    #bindAwsClient() {
        const accessKeyId = this.#ddbConfig.aws?.access_key;
        const secretAccessKey = this.#ddbConfig.aws?.secret_key;

        if (!accessKeyId || !secretAccessKey) {
            throw new Error(
                'DynamoDB aws config requires both `access_key` and `secret_key`',
            );
        }

        const ddbClient = new DynamoDBClient({
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
            maxAttempts: 3,
            requestHandler: new NodeHttpHandler({
                connectionTimeout: 5000,
                requestTimeout: 5000,
                httpsAgent: new httpsAgent({ keepAlive: true }),
            }),
            ...(this.#ddbConfig.endpoint
                ? { endpoint: this.#ddbConfig.endpoint }
                : {}),
            region: this.#ddbConfig.aws?.region || 'us-west-2',
        });

        this.#documentClient = DynamoDBDocumentClient.from(ddbClient, {
            marshallOptions: {
                removeUndefinedValues: true,
            },
        });
    }

    async #bindLocalClient() {
        const pathKey = getDynalitePathKey(this.#ddbConfig.path);
        const endpoint = await getOrCreateLocalDynaliteEndpoint(pathKey);

        const ddbClient = new DynamoDBClient({
            credentials: {
                accessKeyId: 'fake',
                secretAccessKey: 'fake',
            },
            maxAttempts: 3,
            requestHandler: new NodeHttpHandler({
                connectionTimeout: 5000,
                requestTimeout: 5000,
                httpsAgent: new httpsAgent({ keepAlive: true }),
            }),
            endpoint,
            region: 'us-west-2',
        });

        this.#documentClient = DynamoDBDocumentClient.from(ddbClient, {
            marshallOptions: {
                removeUndefinedValues: true,
            },
        });
    }

    async #deleteExpiredItems(
        table: string,
        keySchema: NonNullable<CreateTableCommandInput['KeySchema']>,
        ttlAttribute: string,
    ) {
        const now = Math.floor(Date.now() / 1000);
        const keyNames = keySchema.map((key) => key.AttributeName!);

        let lastEvaluatedKey: Record<string, unknown> | undefined;
        const client = await this.#getDocumentClient();

        do {
            const scan = await client.send(
                new ScanCommand({
                    TableName: table,
                    FilterExpression: '#ttl < :now',
                    ExpressionAttributeNames: {
                        '#ttl': ttlAttribute,
                        ...Object.fromEntries(
                            keyNames.map((key) => [`#k_${key}`, key]),
                        ),
                    },
                    ExpressionAttributeValues: { ':now': now },
                    ProjectionExpression: keyNames
                        .map((key) => `#k_${key}`)
                        .join(', '),
                    ...(lastEvaluatedKey
                        ? { ExclusiveStartKey: lastEvaluatedKey }
                        : {}),
                }),
            );

            lastEvaluatedKey = scan.LastEvaluatedKey as
                | Record<string, unknown>
                | undefined;
            const items = scan.Items;
            if (!items || items.length === 0) continue;

            const chunks = chunkValues(items, MAX_BATCH_WRITE_ITEMS);
            for (const chunk of chunks) {
                await client.send(
                    new BatchWriteCommand({
                        RequestItems: {
                            [table]: chunk.map((item) => ({
                                DeleteRequest: {
                                    Key: Object.fromEntries(
                                        keyNames.map((key) => [key, item[key]]),
                                    ),
                                },
                            })),
                        },
                    }),
                );
            }
        } while (lastEvaluatedKey);
    }
}
