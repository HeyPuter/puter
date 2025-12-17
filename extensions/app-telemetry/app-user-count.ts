const { Eq } = extension.import('query')
const { kv } = extension.import('data');
const span = extension.span;
const { db } = extension.import('data');
const { Context, APIError } = extension.import('core');
const app_es: any = extension.import('service:es:app');

extension.on('create.interfaces', (event) => {
    event.createInterface('app-telemetry', {
        description: 'Provides methods for getting app telemetry',
        methods: {
            get_users: {
                description: 'Returns users who have used your app',
                parameters: {
                    app_uuid: {
                        type: 'string',
                        optional: false,
                    },
                    limit: {
                        type: 'number',
                        optional: true,
                    },
                    offset: {
                        type: 'number',
                        optional: true
                    }
                },
            },
            user_count: {
                description: 'Returns number of users who have used your app',
                parameters: {
                    app_uuid: {
                        type: 'string',
                        optional: false,
                    }
                },
            }
        },
    });
});

extension.on('create.drivers', event => {
    event.createDriver('app-telemetry', 'app-telemetry', {
        async get_users({ app_uuid, limit = 100, offset = 0 }: {app_uuid: string, limit: number, offset: number}) {
            // first lets make sure executor owns this app
            const [result] = (await app_es.select({ predicate: new Eq({ key: 'uid', value: app_uuid }) }));
            if (!result) {
                throw APIError.create('permission_denied');
            }

            // Fetch and return users
            const users: Array<{username: string, uuid: string}> = await db.read(
                `SELECT user.username, user.uuid FROM user_to_app_permissions 
                    INNER JOIN user ON user_to_app_permissions.user_id = user.id  
                    WHERE permission = 'flag:app-is-authenticated' AND app_id=? ORDER BY (dt IS NOT NULL), dt, user_id LIMIT ? OFFSET ?`,
                [result.private_meta.mysql_id, limit, offset],
            );
            return users.map(e=>{return {user: e.username, user_uuid: e.uuid}});
        },
        async user_count({ app_uuid }: {app_uuid: string}) {
            // first lets make sure executor owns this app
            const [result] = (await app_es.select({ predicate: new Eq({ key: 'uid', value: app_uuid }) }));
            if (!result) {
                throw APIError.create('permission_denied');
            }

            // Fetch and return authenticated user count
            const [data] = await db.read(
                `SELECT count(*) FROM user_to_app_permissions 
                    WHERE permission = 'flag:app-is-authenticated' AND app_id=?;`,
                [result.private_meta.mysql_id],
            );
            const count = data['count(*)'];
            return count;
        }
    });
});

extension.on('create.permissions', (event) => {
    event.grant_to_everyone('service:app-telemetry:ii:app-telemetry');
});
