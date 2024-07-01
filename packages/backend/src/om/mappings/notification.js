module.exports = {
    sql: {
        table_name: 'notification'
    },
    primary_identifier: 'uid',
    properties: {
        uid: { type: 'uuid' },
        value: { type: 'json' },
        read: { type: 'flag' },
        owner: {
            type: 'reference',
            to: 'user',
            permissions: ['read'],
            permissible_subproperties: ['username', 'uuid'],
            sql: {
                use_id: true,
                column_name: 'user_id',
            }
        }
    }
};
