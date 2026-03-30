import { CreateTableCommand, CreateTableCommandInput, DynamoDBClient, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, BatchGetCommandInput, BatchWriteCommand, BatchWriteCommandInput, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import dynalite from 'dynalite';
import { once } from 'node:events';
import { Agent as httpsAgent } from 'node:https';

interface DBClientConfig {
    aws?: {
        access_key: string
        secret_key: string
        region: string
    },
    path?: string,
    endpoint?: string
}

const LOCAL_DYNAMO_PATH_KEY = ':memory:';
const localDynaliteEndpointPromises = new Map<string, Promise<string>>();
const MAX_BATCH_WRITE_ITEMS = 25;
const MAX_BATCH_WRITE_RETRIES = 8;
const BATCH_WRITE_RETRY_BASE_MS = 25;

const getDynalitePathKey = (path?: string) => {
    if ( path === ':memory:' ) return LOCAL_DYNAMO_PATH_KEY;
    return path || './puter-ddb';
};

const getOrCreateLocalDynaliteEndpoint = async (pathKey: string) => {
    let endpointPromise = localDynaliteEndpointPromises.get(pathKey);
    if ( endpointPromise ) return endpointPromise;

    endpointPromise = (async () => {
        const dynaliteOptions = pathKey === LOCAL_DYNAMO_PATH_KEY
            ? { createTableMs: 0 }
            : { createTableMs: 0, path: pathKey };

        const dynaliteInstance = dynalite(dynaliteOptions);
        const dynaliteServer = dynaliteInstance.listen(0, '127.0.0.1');
        // Don't keep test workers alive just because dynalite is still open.
        dynaliteServer.unref?.();
        await once(dynaliteServer, 'listening');

        const address = dynaliteServer.address();
        const port = (typeof address === 'object' && address ? address.port : undefined) || 4567;
        return `http://127.0.0.1:${port}`;
    })();

    localDynaliteEndpointPromises.set(pathKey, endpointPromise);
    endpointPromise.catch(() => {
        if ( localDynaliteEndpointPromises.get(pathKey) === endpointPromise ) {
            localDynaliteEndpointPromises.delete(pathKey);
        }
    });
    return endpointPromise;
};

const chunkValues = <T>(values: T[], size: number): T[][] => {
    if ( values.length === 0 ) {
        return [];
    }
    const chunks: T[][] = [];
    for ( let index = 0; index < values.length; index += size ) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
};

const sleep = async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
};

export class DDBClient {
    ddbClientPromise: Promise<DynamoDBClient>;
    #documentClient!: DynamoDBDocumentClient;
    config?: DBClientConfig;

    constructor (config?: DBClientConfig) {
        this.config = config;
        this.ddbClientPromise = this.#getClient();
        this.ddbClientPromise.then(client => {
            this.#documentClient = DynamoDBDocumentClient.from(client, {
                marshallOptions: {
                    removeUndefinedValues: true,
                } });
        });
    }

    async recreateClient () {
        this.ddbClientPromise = this.#getClient();
        this.#documentClient = DynamoDBDocumentClient.from(await this.ddbClientPromise, {
            marshallOptions: {
                removeUndefinedValues: true,
            } });
    }

    async #getClient () {
        if ( ! this.config?.aws ) {
            console.warn('No config for DynamoDB, will fall back on local dynalite');
            const pathKey = getDynalitePathKey(this.config?.path);
            const dynamoEndpoint = await getOrCreateLocalDynaliteEndpoint(pathKey);

            const client =  new DynamoDBClient({
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
                endpoint: dynamoEndpoint,
                region: 'us-west-2',
            });
            console.log(`Dynalite client created within instance for region: ${await client.config.region()}`);
            return client;
        }

        const client =  new DynamoDBClient({
            credentials: {
                accessKeyId: this.config.aws.access_key,
                secretAccessKey: this.config.aws.secret_key,
            },
            maxAttempts: 3,
            requestHandler: new NodeHttpHandler({
                connectionTimeout: 5000,
                requestTimeout: 5000,
                httpsAgent: new httpsAgent({ keepAlive: true }),
            }),
            ...(this.config.endpoint ? { endpoint: this.config.endpoint } : {}),
            region: this.config.aws.region || 'us-west-2',
        });
        console.log(`DynamoDB client created with region ${await client.config.region()}`);
        return client;
    }

    async get <T extends Record<string, unknown>>(table: string, key: T, consistentRead = false) {
        const command = new GetCommand({
            TableName: table,
            Key: key,
            ConsistentRead: consistentRead,
            ReturnConsumedCapacity: 'TOTAL',
        });

        const response = await this.#documentClient.send(command);

        return response;
    }

    async put <T extends Record<string, unknown>>(table: string, item: T) {
        const command = new PutCommand({
            TableName: table,
            Item: item,
            ReturnConsumedCapacity: 'TOTAL',
        });

        const response = await this.#documentClient.send(command);
        return response;
    }

    async batchGet (params: { table: string, items: Record<string, unknown> }[], consistentRead = false) {
        // TODO DS: implement chunking for more than 100 items or more than allowed req size
        const allRequestItemsPerTable = params.reduce((acc, curr) => {
            if ( ! acc[curr.table] ) acc[curr.table] = [];
            acc[curr.table].push(curr.items);
            return acc;
        }, {} as Record<string, Record<string, unknown>[]>);

        const RequestItems: BatchGetCommandInput['RequestItems'] = Object.entries(allRequestItemsPerTable).reduce(
            (acc, [table, keyList]) => {
                const Keys = keyList;
                acc[table] = {
                    Keys,
                    ConsistentRead: consistentRead,
                };
                return acc;
            },
            {} as NonNullable<BatchGetCommandInput['RequestItems']>,
        );

        const command = new BatchGetCommand({
            RequestItems,
            ReturnConsumedCapacity: 'TOTAL',
        });

        return this.#documentClient.send(command);
    }

    async batchPut (params: { table: string, item: Record<string, unknown> }[]) {
        const consumedCapacityByTable = new Map<string, number>();
        if ( params.length === 0 ) {
            return { ConsumedCapacity: [] };
        }

        const accumulateConsumedCapacity = (
            consumedCapacityEntries: Array<{ TableName?: string; CapacityUnits?: number }> | undefined,
        ) => {
            if ( ! consumedCapacityEntries ) {
                return;
            }
            for ( const consumedCapacityEntry of consumedCapacityEntries ) {
                const table = consumedCapacityEntry.TableName;
                if ( ! table ) {
                    continue;
                }

                const existingUsage = consumedCapacityByTable.get(table) ?? 0;
                consumedCapacityByTable.set(
                    table,
                    existingUsage + Number(consumedCapacityEntry.CapacityUnits ?? 0),
                );
            }
        };

        const chunks = chunkValues(params, MAX_BATCH_WRITE_ITEMS);
        for ( const chunk of chunks ) {
            let requestItems = chunk.reduce((acc, curr) => {
                const tableRequests = acc[curr.table] ?? [];
                tableRequests.push({
                    PutRequest: {
                        Item: curr.item,
                    },
                });
                acc[curr.table] = tableRequests;
                return acc;
            }, {} as NonNullable<BatchWriteCommandInput['RequestItems']>);

            for ( let attempt = 0; attempt <= MAX_BATCH_WRITE_RETRIES; attempt++ ) {
                if ( Object.keys(requestItems).length === 0 ) {
                    break;
                }

                const response = await this.#documentClient.send(new BatchWriteCommand({
                    RequestItems: requestItems,
                    ReturnConsumedCapacity: 'TOTAL',
                }));
                accumulateConsumedCapacity(
                    response.ConsumedCapacity as Array<{ TableName?: string; CapacityUnits?: number }> | undefined,
                );

                const unprocessedItems = response.UnprocessedItems ?? {};
                if ( Object.keys(unprocessedItems).length === 0 ) {
                    requestItems = {};
                    break;
                }

                requestItems = unprocessedItems as NonNullable<BatchWriteCommandInput['RequestItems']>;
                if ( attempt < MAX_BATCH_WRITE_RETRIES ) {
                    const delayMs = Math.min(1000, BATCH_WRITE_RETRY_BASE_MS * (2 ** attempt));
                    await sleep(delayMs);
                }
            }

            if ( Object.keys(requestItems).length > 0 ) {
                throw new Error('Failed to batch write all items to DynamoDB');
            }
        }

        return {
            ConsumedCapacity: Array.from(consumedCapacityByTable.entries()).map(([TableName, CapacityUnits]) => ({
                TableName,
                CapacityUnits,
            })),
        };
    }

    async del<T extends Record<string, unknown>> (table: string, key: T) {
        const command = new DeleteCommand({
            TableName: table,
            Key: key,
            ReturnConsumedCapacity: 'TOTAL',
        });

        return this.#documentClient.send(command);
    }

    async query<T extends Record<string, unknown>> (
        table: string,
        keys: T,
        limit = 0,
        pageKey?: Record<string, unknown>,
        index = '',
        consistentRead = false,
        options?: { beginsWith?: { key: string; value: string } },
    ) {

        const keyExpressionParts = Object.keys(keys).map(key => `#${key} = :${key}`);
        const expressionAttributeValues = Object.entries(keys).reduce((acc, [key, value]) => {
            acc[`:${key}`] = value;
            return acc;
        }, {});
        const expressionAttributeNames = Object.keys(keys).reduce((acc, key) => {
            acc[`#${key}`] = key;
            return acc;
        }, {});

        if ( options?.beginsWith?.key && typeof options.beginsWith.value === 'string' && options.beginsWith.value !== '' ) {
            const beginsKey = options.beginsWith.key;
            const beginsValueToken = `:${beginsKey}_begins_with`;
            keyExpressionParts.push(`begins_with(#${beginsKey}, ${beginsValueToken})`);
            expressionAttributeValues[beginsValueToken] = options.beginsWith.value;
            expressionAttributeNames[`#${beginsKey}`] = beginsKey;
        }

        const keyExpression = keyExpressionParts.join(' AND ');

        const command = new QueryCommand({
            TableName: table,
            ...(!index ? {} : { IndexName: index }),
            KeyConditionExpression: keyExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ExpressionAttributeNames: expressionAttributeNames,
            ConsistentRead: consistentRead,
            ...(!pageKey ? {} : { ExclusiveStartKey: pageKey }),
            ...(!limit ? {} : { Limit: limit }),
            ReturnConsumedCapacity: 'TOTAL',
        });

        return await this.#documentClient.send(command);
    }

    async update<T extends Record<string, unknown>> (
        table: string,
        key: T,
        expression: string,
        expressionValues?: Record<string, unknown>,
        expressionNames?: Record<string, string>,
    ) {
        const hasValues = !!expressionValues && Object.keys(expressionValues).length > 0;
        const hasNames = !!expressionNames && Object.keys(expressionNames).length > 0;
        const command = new UpdateCommand({
            TableName: table,
            Key: key,
            UpdateExpression: expression,
            ...(hasValues ? { ExpressionAttributeValues: expressionValues } : {}),
            ...(hasNames ? { ExpressionAttributeNames: expressionNames } : {}),
            ReturnValues: 'ALL_NEW',
            ReturnConsumedCapacity: 'TOTAL',
        });
        try {
            return await this.#documentClient.send(command);
        } catch ( e ) {
            console.error('DDB Update Error', e);
            throw e;
        }
    }

    async createTableIfNotExists (params: CreateTableCommandInput, ttlAttribute?: string) {
        if ( this.config?.aws ) {
            console.warn('Creating DynamoDB tables in AWS is disabled by default, but if you need to enable it, modify the DDBClient class');
            return;
        }
        try {
            await this.#documentClient.send(new CreateTableCommand(params));
        } catch ( e ) {
            if ( (e as Error)?.name !== 'ResourceInUseException' ) {
                throw e;
            }
            setTimeout(async () => {
                if ( ttlAttribute ) {
                // ensure TTL is set
                    await this.#documentClient.send(new UpdateTimeToLiveCommand({
                        TableName: params.TableName!,
                        TimeToLiveSpecification: {
                            AttributeName: ttlAttribute,
                            Enabled: true,
                        },
                    }));
                }
            }, 5000); // wait 5 seconds to ensure table is active

        }
    }
}
