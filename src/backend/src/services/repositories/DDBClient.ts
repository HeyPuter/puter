import { CreateTableCommand, CreateTableCommandInput, DynamoDBClient, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, BatchGetCommandInput, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

export class DDBClient {
    ddbClient: Promise<DynamoDBClient>;
    #documentClient!: DynamoDBDocumentClient;
    config?: DBClientConfig;

    constructor (config?: DBClientConfig) {
        this.config = config;
        this.ddbClient = this.#getClient();
        this.ddbClient.then(client => {
            this.#documentClient = DynamoDBDocumentClient.from(client, {
                marshallOptions: {
                    removeUndefinedValues: true,
                } });
        });
    }

    async #getClient () {
        if ( ! this.config?.aws ) {
            console.warn('No config for DynamoDB, will fall back on local dynalite');
            const dynaliteInstance = dynalite({ createTableMs: 0, path: this.config?.path === ':memory:' ? undefined : this.config?.path || './puter-ddb' });
            const dynaliteServer = dynaliteInstance.listen(0, '127.0.0.1');
            await once(dynaliteServer, 'listening');
            const address = dynaliteServer.address();
            const port = (typeof address === 'object' && address ? address.port : undefined) || 4567;
            const dynamoEndpoint = `http://127.0.0.1:${port}`;

            return new DynamoDBClient({
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
        }

        return new DynamoDBClient({
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

        const RequestItems: BatchGetCommandInput['RequestItems'] = Object.entries(allRequestItemsPerTable).reduce((acc, [table, keyList]) => {
            const Keys = keyList;
            acc[table] = {
                Keys,
                ConsistentRead: consistentRead,
            };
            return acc;
        },
        {} as NonNullable<BatchGetCommandInput['RequestItems']>);

        const command = new BatchGetCommand({
            RequestItems,
            ReturnConsumedCapacity: 'TOTAL',
        });

        return this.#documentClient.send(command);
    }

    async del<T extends Record<string, unknown>> (table: string, key: T) {
        const command = new DeleteCommand({
            TableName: table,
            Key: key,
            ReturnConsumedCapacity: 'TOTAL',
        });

        return this.#documentClient.send(command);
    }

    async query<T extends Record<string, unknown>> (table: string, keys: T, limit = 0, pageKey?: Record<string, unknown>, index = '', consistentRead = false) {

        const keyExpression = Object.keys(keys).map(key => `#${key} = :${key}`).join(' AND ');
        const expressionAttributeValues = Object.entries(keys).reduce((acc, [key, value]) => {
            acc[`:${key}`] = value;
            return acc;
        }, {});
        const expressionAttributeNames = Object.keys(keys).reduce((acc, key) => {
            acc[`#${key}`] = key;
            return acc;
        }, {});

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
