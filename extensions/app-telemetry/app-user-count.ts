const { Eq } = extension.import('query');
const { db } = extension.import('data');
const { APIError } = extension.import('core');
const app_es = extension.import('service:es:app') as any;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_OFFSET = 100_000;

const parseIntegerParam = (
    value: unknown,
    {
        key,
        min,
        max,
        fallback,
    }: { key: string, min: number, max: number, fallback: number },
) => {
    if ( value === undefined || value === null ) return fallback;

    const parsed = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : Number.NaN);

    if ( !Number.isFinite(parsed) || !Number.isInteger(parsed) ) {
        throw APIError.create('field_invalid', undefined, {
            key,
            expected: `an integer between ${min} and ${max}`,
            got: value,
        });
    }

    if ( parsed < min || parsed > max ) {
        throw APIError.create('field_invalid', undefined, {
            key,
            expected: `an integer between ${min} and ${max}`,
            got: parsed,
        });
    }

    return parsed;
};

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
                        optional: true,
                    },
                },
            },
            user_count: {
                description: 'Returns number of users who have used your app',
                parameters: {
                    app_uuid: {
                        type: 'string',
                        optional: false,
                    },
                },
            },
        },
    });
});

extension.on('create.drivers', event => {
    event.createDriver('app-telemetry', 'app-telemetry', {
        async get_users ({ app_uuid, limit, offset }: { app_uuid: string, limit?: number, offset?: number }) {
            const safeLimit = parseIntegerParam(limit, {
                key: 'limit',
                min: 1,
                max: MAX_LIMIT,
                fallback: DEFAULT_LIMIT,
            });
            const safeOffset = parseIntegerParam(offset, {
                key: 'offset',
                min: 0,
                max: MAX_OFFSET,
                fallback: 0,
            });

            // first lets make sure executor owns this app
            const [result] = (await app_es.select({ predicate: new Eq({ key: 'uid', value: app_uuid }) }));
            if ( ! result ) {
                throw APIError.create('permission_denied');
            }

            // Fetch and return users
            const users: Array<{ username: string, uuid: string }> = await db.read(`SELECT user.username, user.uuid FROM user_to_app_permissions 
                    INNER JOIN user ON user_to_app_permissions.user_id = user.id  
                    WHERE permission = 'flag:app-is-authenticated' AND app_id=? ORDER BY (dt IS NOT NULL), dt, user_id LIMIT ? OFFSET ?`,
            [result.private_meta.mysql_id, safeLimit, safeOffset]);
            return users.map(e => {
                return { user: e.username, user_uuid: e.uuid };
            });
        },
        async user_count ({ app_uuid }: { app_uuid: string }) {
            // first lets make sure executor owns this app
            const [result] = (await app_es.select({ predicate: new Eq({ key: 'uid', value: app_uuid }) }));
            if ( ! result ) {
                throw APIError.create('permission_denied');
            }

            // Fetch and return authenticated user count
            const [data] = await db.read(`SELECT count(*) FROM user_to_app_permissions 
                    WHERE permission = 'flag:app-is-authenticated' AND app_id=?;`,
            [result.private_meta.mysql_id]);
            const count = data['count(*)'];
            return count;
        },
    });
});

extension.on('create.permissions', (event) => {
    event.grant_to_everyone('service:app-telemetry:ii:app-telemetry');
});
