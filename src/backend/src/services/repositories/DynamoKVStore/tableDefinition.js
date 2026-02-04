export const PUTER_KV_STORE_TABLE_DEFINITION = {
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
//# sourceMappingURL=tableDefinition.js.map