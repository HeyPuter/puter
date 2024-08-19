const {
    default_implicit_user_app_permissions,
    implicit_user_app_permissions,
    hardcoded_user_group_permissions,
} = require("../data/hardcoded-permissions");
const { get_user } = require("../helpers");
const { Actor, UserActorType, AppUnderUserActorType } = require("../services/auth/Actor");

/*
    OPTIMAL FOLD LEVEL: 3
    
    "Ctrl+K, Ctrl+3" or "⌘K, ⌘3";
    "Ctrl+K, Ctrl+J" or "⌘K, ⌘J";
*/

const PERMISSION_SCANNERS = [
    {
        name: 'implied',
        async scan (a) {
            const reading = a.get('reading');
            const { actor, permission_options } = a.values();
            
            const _permission_implicators = a.iget('_permission_implicators');

            for ( const permission of permission_options )
            for ( const implicator of _permission_implicators ) {
                if ( ! implicator.matches(permission) ) {
                    continue;
                }
                const implied = await implicator.check({
                    actor,
                    permission,
                });
                if ( implied ) {
                    reading.push({
                        $: 'option',
                        permission,
                        source: 'implied',
                        by: implicator.id,
                        data: implied,
                    });
                }
            }
        }
    },
    {
        name: 'user-user',
        async scan (a) {
            const { reading, actor, permission_options } = a.values();
            if ( !(actor.type instanceof UserActorType)  ) {
                return;
            }
            const db = a.iget('db');
            
            let sql_perm = permission_options.map(perm => {
                return `\`permission\` = ?`
            }).join(' OR ');
            
            if ( permission_options.length > 1 ) {
                sql_perm = '(' + sql_perm + ')';
            }

            // SELECT permission
            const rows = await db.read(
                'SELECT * FROM `user_to_user_permissions` ' +
                'WHERE `holder_user_id` = ? AND ' +
                sql_perm,
                [
                    actor.type.user.id,
                    ...permission_options,
                ]
            );

            // Return the first matching permission where the
            // issuer also has the permission granted
            for ( const row of rows ) {
                row.extra = db.case({
                    mysql: () => row.extra,
                    otherwise: () => JSON.parse(row.extra ?? '{}')
                })();

                const issuer_actor = new Actor({
                    type: new UserActorType({
                        user: await get_user({ id: row.issuer_user_id }),
                    }),
                });

                // const issuer_perm = await this.check(issuer_actor, row.permission);
                const issuer_reading = await a.icall('scan', issuer_actor, row.permission);
                reading.push({
                    $: 'path',
                    via: 'user',
                    permission: row.permission,
                    data: row.extra,
                    holder_username: actor.type.user.username,
                    issuer_username: issuer_actor.type.user.username,
                    reading: issuer_reading,
                });
            }
        }
    },
    {
        name: 'hc-user-group-user',
        async scan (a) {
            const { reading, actor, permission_options } = a.values();
            if ( !(actor.type instanceof UserActorType)  ) {
                return;
            }

            const svc_group = await a.iget('services').get('group');
            const groups = await svc_group.list_groups_with_member(
                { user_id: actor.type.user.id });
            console.log('uh, groups?', actor.type.user.id, groups);
            const group_uids = {};
            for ( const group of groups ) {
                group_uids[group.values.uid] = group;
            }
            console.log('group uids', group_uids);
            
            for ( const issuer_username in hardcoded_user_group_permissions ) {
                const issuer_actor = new Actor({
                    type: new UserActorType({
                        user: await get_user({ username: issuer_username }),
                    }),
                });
                const issuer_groups =
                    hardcoded_user_group_permissions[issuer_username];
                console.log('issuer groups', issuer_groups);
                for ( const group_uid in issuer_groups ) {
                    if ( ! group_uids[group_uid] ) continue;
                    const issuer_group = issuer_groups[group_uid];
                    for ( const permission of permission_options ) {
                        console.log('permission?', permission);
                        if ( ! issuer_group.hasOwnProperty(permission) ) continue;
                        const issuer_reading =
                            await a.icall('scan', issuer_actor, permission)
                        reading.push({
                            $: 'path',
                            via: 'hc-user-group',
                            permission,
                            data: issuer_group[permission],
                            holder_username: actor.type.user.username,
                            issuer_username,
                            reading: issuer_reading,
                            group_id: group_uids[group_uid].id,
                        });
                    }
                }
            }
        }
    },
    {
        name: 'user-group-user',
        async scan (a) {
            const { reading, actor, permission_options } = a.values();
            if ( !(actor.type instanceof UserActorType)  ) {
                return;
            }
            const db = a.iget('db');

            let sql_perm = permission_options.map((perm) =>
                `p.permission = ?`).join(' OR ');

            if ( permission_options.length > 1 ) {
                sql_perm = '(' + sql_perm + ')';
            }
            const rows = await db.read(
                'SELECT p.permission, p.user_id, p.group_id, p.extra FROM `user_to_group_permissions` p ' +
                'JOIN `jct_user_group` ug ON p.group_id = ug.group_id ' +
                'WHERE ug.user_id = ? AND ' + sql_perm,
                [
                    actor.type.user.id,
                    ...permission_options,
                ]
            );

            for ( const row of rows ) {
                row.extra = db.case({
                    mysql: () => row.extra,
                    otherwise: () => JSON.parse(row.extra ?? '{}')
                })();

                const issuer_actor = new Actor({
                    type: new UserActorType({
                        user: await get_user({ id: row.user_id }),
                    }),
                });

                const issuer_reading = await a.icall('scan', issuer_actor, row.permission);

                reading.push({
                    $: 'path',
                    via: 'user-group',
                    // issuer: issuer_actor,
                    permission: row.permission,
                    data: row.extra,
                    holder_username: actor.type.user.username,
                    issuer_username: issuer_actor.type.user.username,
                    reading: issuer_reading,
                    group_id: row.group_id,
                });
            }
        }
    },
    {
        name: 'user-app',
        async scan (a) {
            const { reading, actor, permission_options } = a.values();
            if ( !(actor.type instanceof AppUnderUserActorType)  ) {
                return;
            }
            const db = a.iget('db');
            
            const app_uid = actor.type.app.uid;
            
            const issuer_actor = actor.get_related_actor(UserActorType);
            const issuer_reading = await a.icall('scan', issuer_actor, permission_options);
            
            for ( const permission of permission_options ) {
                {

                    const implied = default_implicit_user_app_permissions[permission];
                    if ( implied ) {
                        reading.push({
                            $: 'path',
                            permission,
                            source: 'user-app-implied',
                            by: 'user-app-hc-1',
                            data: implied,
                            issuer_username: actor.type.user.username,
                            reading: issuer_reading,
                        });
                    }
                } {
                    const implicit_permissions = {};
                    for ( const implicit_permission of implicit_user_app_permissions ) {
                        if ( implicit_permission.apps.includes(app_uid) ) {
                            implicit_permissions[permission] = implicit_permission.permissions[permission];
                        }
                    }
                    if ( implicit_permissions[permission] ) {
                        reading.push({
                            $: 'path',
                            permission,
                            source: 'user-app-implied',
                            by: 'user-app-hc-2',
                            data: implicit_permissions[permission],
                            issuer_username: actor.type.user.username,
                            reading: issuer_reading,
                        });
                    }
                }
            }

            let sql_perm = permission_options.map(() =>
                `\`permission\` = ?`).join(' OR ');
            if ( permission_options.length > 1 ) sql_perm = '(' + sql_perm + ')';
            
            // SELECT permission
            const rows = await db.read(
                'SELECT * FROM `user_to_app_permissions` ' +
                'WHERE `user_id` = ? AND `app_id` = ? AND ' +
                sql_perm,
                [
                    actor.type.user.id,
                    actor.type.app.id,
                    ...permission_options,
                ]
            );
            
            if ( rows[0] ) {
                const row = rows[0];
                row.extra = db.case({
                    mysql: () => row.extra,
                    otherwise: () => JSON.parse(row.extra ?? '{}')
                })();
                const issuer_actor = actor.get_related_actor(UserActorType);
                const issuer_reading = await a.icall('scan', issuer_actor, row.permission);
                reading.push({
                    $: 'path',
                    via: 'user-app',
                    permission: row.permission,
                    data: row.extra,
                    issuer_username: actor.type.user.username,
                    reading: issuer_reading,
                });
            }
        }
    },
];

module.exports = {
    PERMISSION_SCANNERS,
};
