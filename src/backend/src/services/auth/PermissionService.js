/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { get_user, get_app } = require("../../helpers");
const { AssignableMethodsTrait } = require("../../traits/AssignableMethodsTrait");
const { Context } = require("../../util/context");
const BaseService = require("../BaseService");
const { DB_WRITE } = require("../database/consts");
const { UserActorType, Actor, AppUnderUserActorType, AccessTokenActorType, SiteActorType } = require("./Actor");

const default_implicit_user_app_permissions = {
    'driver:helloworld:greet': {},
    'driver:puter-kvstore': {},
    'driver:puter-ocr:recognize': {},
    'driver:puter-chat-completion': {},
    'driver:puter-image-generation': {},
    'driver:puter-tts': {},
    'driver:puter-apps': {},
    'driver:puter-subdomains': {},
    'driver:temp-email': {},
};

const implicit_user_app_permissions = [
    {
        id: 'builtin-apps',
        apps: [
            'app-0bef044f-918f-4cbf-a0c0-b4a17ee81085', // about
            'app-838dfbc4-bf8b-48c2-b47b-c4adc77fab58', // editor
            'app-58282b08-990a-4906-95f7-fa37ff92452b', // draw
            'app-0087b701-da09-4f49-a37d-2d6bcabc81ee', // minipaint
            'app-3fea7529-266e-47d9-8776-31649cd06557', // terminal
            'app-5584fbf7-ed69-41fc-99cd-85da21b1ef51', // camera
            'app-7bdca1a4-6373-4c98-ad97-03ff2d608ca1', // recorder
            'app-240a43f4-43b1-49bc-b9fc-c8ae719dab77', // dev-center
            'app-a2ae72a4-1ba3-4a29-b5c0-6de1be5cf178', // app-center
            'app-74378e84-b9cd-5910-bcb1-3c50fa96d6e7', // https://nj.puter.site
            'app-13a38aeb-f9f6-54f0-9bd3-9d4dd655ccfe', // https://cdpn.io
            'app-dce8f797-82b0-5d95-a2f8-ebe4d71b9c54', // https://null.jsbin.com
            'app-93005ce0-80d1-50d9-9b1e-9c453c375d56', // https://markus.puter.com
        ],
        permissions: {
            'driver:helloworld:greet': {},
            'driver:puter-ocr:recognize': {},
            'driver:puter-kvstore:get': {},
            'driver:puter-kvstore:set': {},
            'driver:puter-kvstore:del': {},
            'driver:puter-kvstore:list': {},
            'driver:puter-kvstore:flush': {},
            'driver:puter-chat-completion:complete': {},
            'driver:puter-image-generation:generate': {},
            'driver:puter-analytics:create_trace': {},
            'driver:puter-analytics:record': {},
        },
    },
    {
        id: 'local-testing',
        apps: [
            'app-a392f3e5-35ca-5dac-ae10-785696cc7dec', // https://localhost
            'app-a6263561-6a84-5d52-9891-02956f9fac65', // https://127.0.0.1
            'app-26149f0b-8304-5228-b995-772dadcf410e', // http://localhost
            'app-c2e27728-66d9-54dd-87cd-6f4e9b92e3e3', // http://127.0.0.1
        ],
        permissions: {
            'driver:helloworld:greet': {},
            'driver:puter-ocr:recognize': {},
            'driver:puter-kvstore:get': {},
            'driver:puter-kvstore:set': {},
            'driver:puter-kvstore:del': {},
            'driver:puter-kvstore:list': {},
            'driver:puter-kvstore:flush': {},
        },
    },
];

const implicit_user_permissions = {
    'driver': {},
};

class PermissionRewriter {
    static create ({ id, matcher, rewriter }) {
        return new PermissionRewriter({ id, matcher, rewriter });
    }

    constructor ({ id, matcher, rewriter }) {
        this.id = id;
        this.matcher = matcher;
        this.rewriter = rewriter;
    }

    matches (permission) {
        return this.matcher(permission);
    }

    async rewrite (permission) {
        return await this.rewriter(permission);
    }
}

class PermissionImplicator {
    static create ({ id, matcher, checker }) {
        return new PermissionImplicator({ id, matcher, checker });
    }

    constructor ({ id, matcher, checker }) {
        this.id = id;
        this.matcher = matcher;
        this.checker = checker;
    }

    matches (permission) {
        return this.matcher(permission);
    }

    /**
     * Check if the permission is implied by this implicator
     * @param  {Actor} actor
     * @param  {string} permission
     * @returns 
     */
    async check ({ actor, permission, recurse }) {
        return await this.checker({ actor, permission, recurse });
    }
}

class PermissionExploder {
    static create ({ id, matcher, exploder }) {
        return new PermissionExploder({ id, matcher, exploder });
    }

    constructor ({ id, matcher, exploder }) {
        this.id = id;
        this.matcher = matcher;
        this.exploder = exploder;
    }

    matches (permission) {
        return this.matcher(permission);
    }

    /**
     * Check if the permission is implied by this implicator
     * @param  {Actor} actor
     * @param  {string} permission
     * @returns 
     */
    async explode ({ actor, permission }) {
        return await this.exploder({ actor, permission });
    }
}

class PermissionUtil {
    static unescape_permission_component (component) {
        let unescaped_str = '';
        const STATE_NORMAL = {};
        const STATE_ESCAPE = {};
        let state = STATE_NORMAL;
        const const_escapes = { C: ':' };
        for ( let i = 0 ; i < component.length ; i++ ) {
            const c = component[i];
            if ( state === STATE_NORMAL ) {
                if ( c === '\\' ) {
                    state = STATE_ESCAPE;
                } else {
                    unescaped_str += c;
                }
            } else if ( state === STATE_ESCAPE ) {
                unescaped_str += const_escapes.hasOwnProperty(c)
                    ? const_escapes[c] : c;
                state = STATE_NORMAL;
            }
        }
        return unescaped_str;
    }
    
    static escape_permission_component (component) {
        let escaped_str = '';
        for ( let i = 0 ; i < component.length ; i++ ) {
            const c = component[i];
            if ( c === ':' ) {
                escaped_str += '\\C';
                continue;
            }
            escaped_str += c;
        }
        return escaped_str;
    }

    static split (permission) {
        return permission
            .split(':')
            .map(PermissionUtil.unescape_permission_component)
            ;
    }
    
    static join (...components) {
        return components
            .map(PermissionUtil.escape_permission_component)
            .join(':')
            ;
    }
}

class PermissionService extends BaseService {
    _construct () {
        this._permission_rewriters = [];
        this._permission_implicators = [];
        this._permission_exploders = [];
    }

    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'permissions');
        this._register_commands(this.services.get('commands'));
    }

    async _rewrite_permission (permission) {
        for ( const rewriter of this._permission_rewriters ) {
            if ( ! rewriter.matches(permission) ) continue;
            permission = await rewriter.rewrite(permission);
        }
        return permission;
    }

    async check () {
        const ld = (Context.get('logdent') ?? 0) + 1;
        return await Context.get().sub({ logdent: ld }).arun(async () => {
            const res = await this.check__(...arguments);
            // this.log.noticeme('RETURN ' + res);
            return res;
        });
    }

    async check__ (actor, permission) {
        permission = await this._rewrite_permission(permission);

        this.log.info(`checking permission ${permission} for actor ${actor.uid}`, {
            actor: actor.uid,
            permission,
        });
        
        // for ( const implicator of this._permission_implicators ) {
        //     if ( ! implicator.matches(permission) ) continue;
        //     const implied = await implicator.check({
        //         actor,
        //         permission,
        //         recurse: this.check.bind(this),
        //     });
        //     if ( implied ) return implied;
        // }

        // For now we're only checking driver permissions, and users have all of them
        if ( actor.type instanceof UserActorType ) {
            return await this.check_user_permission(actor, permission);
        }

        if ( actor.type instanceof AccessTokenActorType ) {
            // Authorizer must have permission
            const authorizer_permission = await this.check(actor.type.authorizer, permission);
            if ( ! authorizer_permission ) return false;

            return await this.check_access_token_permission(
                actor.type.authorizer, actor.type.token, permission
            );
        }

        // Prevent undefined behaviour
        if ( actor.type instanceof AppUnderUserActorType ) {
            // NEXT:
            const app_uid = actor.type.app.uid;
            const user_actor = actor.get_related_actor(UserActorType);
            // const user_has_permission = await this.check_user_permission(user_actor, permission);
            const user_has_permission = await this.check__(
                user_actor, permission,
            );
            if ( ! user_has_permission ) return undefined;
            
            // This was a useful log so I'm keeping it here
            // console.log('\x1B[36;1m>=== THIS IS HERE ===<\x1B[0m',
            //     app_uid,
            //     permission,
            // )

            return await this.check_user_app_permission(actor, app_uid, permission);
        }
        
        if ( actor.type instanceof SiteActorType ) {
            return await this.check_site_permission(actor, permission);
        }
        
        console.log ('WHAT ACTOR TYPE THEN???', actor.type);

        throw new Error('unrecognized actor type');
    }

    // TODO: context meta for cycle detection
    async check_user_permission (actor, permission) {
        return await require('../../structured/sequence/check-user-permission')
            .call(this, {
                // passed
                actor,
                permission,
                // constants
                implicit_user_permissions,
            });
    }

    async check_access_token_permission (authorizer, token, permission) {
        const rows = await this.db.read(
            'SELECT * FROM `access_token_permissions` ' +
            'WHERE `token_uid` = ? AND `permission` = ?',
            [
                token,
                permission,
            ]
        );

        // Token must have permission
        if ( ! rows[0] ) return undefined;

        return rows[0].extra;
    }

    async check_user_app_permission (actor, app_uid, permission) {
        permission = await this._rewrite_permission(permission);

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });
        const app_id = app.id;

        // const parent_perms = this.get_parent_permissions(permission);
        const parent_perms = await this.get_higher_permissions(permission);

        for ( const permission of parent_perms ) {
            // Check hardcoded permissions
            if ( default_implicit_user_app_permissions[permission] ) {
                return default_implicit_user_app_permissions[permission];
            }

            // Check implicit permissions
            const implicit_permissions = {};
            for ( const implicit_permission of implicit_user_app_permissions ) {
                if ( implicit_permission.apps.includes(app_uid) ) {
                    implicit_permissions[permission] = implicit_permission.permissions[permission];
                }
            }
            if ( implicit_permissions[permission] ) {
                return implicit_permissions[permission];
            }
        }
        
        // My biggest gripe with SQL is doing string manipulation for queries.
        // If the grammar for SQL was simpler we could model it, write this as
        // data, and even implement macros for common patterns.
        let sql_perm = parent_perms.map((perm) =>
            `\`permission\` = ?`).join(' OR ');
        if ( parent_perms.length > 1 ) sql_perm = '(' + sql_perm + ')';

        // SELECT permission
        const rows = await this.db.read(
            'SELECT * FROM `user_to_app_permissions` ' +
            'WHERE `user_id` = ? AND `app_id` = ? AND ' +
            sql_perm,
            [
                actor.type.user.id,
                app_id,
                ...parent_perms,
            ]
        );

        if ( ! rows[0] ) return undefined;

        return rows[0].extra;
    }
    
    async check_site_permission (actor, permission) {
        permission = await this._rewrite_permission(permission);
        // const parent_perms = this.get_parent_permissions(permission);
        const parent_perms = await this.get_higher_permissions(permission);

        // Check implicit permissions
        for ( const parent_perm of parent_perms ) {
            if ( implicit_user_permissions[parent_perm] ) {
                return implicit_user_permissions[parent_perm];
            }
        }

        for ( const implicator of this._permission_implicators ) {
            if ( ! implicator.matches(permission) ) continue;
            const implied = await implicator.check({
                actor,
                permission,
                recurse: this.check.bind(this),
            });
            if ( implied ) return implied;
        }
    }

    async grant_user_app_permission (actor, app_uid, permission, extra = {}, meta) {
        permission = await this._rewrite_permission(permission);

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });

        const app_id = app.id;

        // UPSERT permission
        await this.db.write(
            'INSERT INTO `user_to_app_permissions` (`user_id`, `app_id`, `permission`, `extra`) ' +
            'VALUES (?, ?, ?, ?) ' +
            this.db.case({
                mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
                otherwise: 'ON CONFLICT(`user_id`, `app_id`, `permission`) DO UPDATE SET `extra` = ?',
            }),
            [
                actor.type.user.id,
                app_id,
                permission,
                JSON.stringify(extra),
                JSON.stringify(extra),
            ]
        );

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission,
            action: 'grant',
            reason: meta?.reason || 'granted via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map((key) => `?`).join(', ');

        await this.db.write(
            'INSERT INTO `audit_user_to_app_permissions` (' + sql_cols + ') ' +
            'VALUES (' + sql_vals + ')',
            Object.values(audit_values)
        );
    }

    async revoke_user_app_permission (actor, app_uid, permission, meta) {
        permission = await this._rewrite_permission(permission);

        // For now, actor MUST be a user
        if ( ! (actor.type instanceof UserActorType) ) {
            throw new Error('actor must be a user');
        }

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });
        const app_id = app.id;

        // DELETE permission
        await this.db.write(
            'DELETE FROM `user_to_app_permissions` ' +
            'WHERE `user_id` = ? AND `app_id` = ? AND `permission` = ?',
            [
                actor.type.user.id,
                app_id,
                permission,
            ]
        );

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission,
            action: 'revoke',
            reason: meta?.reason || 'revoked via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map((key) => `?`).join(', ');

        await this.db.write(
            'INSERT INTO `audit_user_to_app_permissions` (' + sql_cols + ') ' +
            'VALUES (' + sql_vals + ')',
            Object.values(audit_values)
        );
    }

    async revoke_user_app_all (actor, app_uid, meta) {
        // For now, actor MUST be a user
        if ( ! (actor.type instanceof UserActorType) ) {
            throw new Error('actor must be a user');
        }

        let app = await get_app({ uid: app_uid });
        if ( ! app ) app = await get_app({ name: app_uid });
        const app_id = app.id;

        // DELETE permissions
        await this.db.write(
            'DELETE FROM `user_to_app_permissions` ' +
            'WHERE `user_id` = ? AND `app_id` = ?',
            [
                actor.type.user.id,
                app_id,
            ]
        );

        // INSERT audit table
        const audit_values = {
            user_id: actor.type.user.id,
            user_id_keep: actor.type.user.id,
            app_id: app_id,
            app_id_keep: app_id,
            permission: '*',
            action: 'revoke',
            reason: meta?.reason || 'revoked all via PermissionService',
        };

        const sql_cols = Object.keys(audit_values).map((key) => `\`${key}\``).join(', ');
        const sql_vals = Object.keys(audit_values).map((key) => `?`).join(', ');

        await this.db.write(
            'INSERT INTO `audit_user_to_app_permissions` (' + sql_cols + ') ' +
            'VALUES (' + sql_vals + ')',
            Object.values(audit_values)
        );
    }

    async grant_user_user_permission (actor, username, permission, extra = {}, meta) {
        permission = await this._rewrite_permission(permission);
        const user = await get_user({ username });
        if ( ! user ) {
            throw new Error('user not found');
        }

        // Don't allow granting permissions to yourself
        if ( user.id === actor.type.user.id ) {
            throw new Error('cannot grant permissions to yourself');
        }

        // UPSERT permission
        await this.db.write(
            'INSERT INTO `user_to_user_permissions` (`holder_user_id`, `issuer_user_id`, `permission`, `extra`) ' +
            'VALUES (?, ?, ?, ?) ' +
            this.db.case({
                mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
                otherwise: 'ON CONFLICT(`holder_user_id`, `issuer_user_id`, `permission`) DO UPDATE SET `extra` = ?',
            }),
            [
                user.id,
                actor.type.user.id,
                permission,
                JSON.stringify(extra),
                JSON.stringify(extra),
            ]
        );

        // INSERT audit table
        await this.db.write(
            'INSERT INTO `audit_user_to_user_permissions` (' +
            '`holder_user_id`, `holder_user_id_keep`, `issuer_user_id`, `issuer_user_id_keep`, ' +
            '`permission`, `action`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                user.id,
                user.id,
                actor.type.user.id,
                actor.type.user.id,
                permission,
                'grant',
                meta?.reason || 'granted via PermissionService',
            ]
        );
    }
    
    async grant_user_group_permission (actor, gid, permission, extra = {}, meta) {
        permission = await this._rewrite_permission(permission);
        const svc_group = this.services.get('group');
        const group = await svc_group.get({ uid: gid });
        if ( ! group ) {
            throw new Error('group not found');
        }
        
        await this.db.write(
            'INSERT INTO `user_to_group_permissions` (`user_id`, `group_id`, `permission`, `extra`) ' +
            'VALUES (?, ?, ?, ?) ' +
            this.db.case({
                mysql: 'ON DUPLICATE KEY UPDATE `extra` = ?',
                otherwise: 'ON CONFLICT(`user_id`, `group_id`, `permission`) DO UPDATE SET `extra` = ?',
            }),
            [
                actor.type.user.id,
                group.id,
                permission,
                JSON.stringify(extra),
                JSON.stringify(extra),
            ]
        );

        // INSERT audit table
        await this.db.write(
            'INSERT INTO `audit_user_to_group_permissions` (' +
            '`user_id`, `user_id_keep`, `group_id`, `group_id_keep`, ' +
            '`permission`, `action`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                actor.type.user.id,
                actor.type.user.id,
                group.id,
                group.id,
                permission,
                'grant',
                meta?.reason || 'granted via PermissionService',
            ]
        );
    }

    async revoke_user_user_permission (actor, username, permission, meta) {
        permission = await this._rewrite_permission(permission);

        const user = await get_user({ username });
        if ( ! user ) {
            throw new Error('user not found');
        }

        // DELETE permission
        await this.db.write(
            'DELETE FROM `user_to_user_permissions` ' +
            'WHERE `holder_user_id` = ? AND `issuer_user_id` = ? AND `permission` = ?',
            [
                user.id,
                actor.type.user.id,
                permission,
            ]
        );

        // INSERT audit table
        await this.db.write(
            'INSERT INTO `audit_user_to_user_permissions` (' +
            '`holder_user_id`, `holder_user_id_keep`, `issuer_user_id`, `issuer_user_id_keep`, ' +
            '`permission`, `action`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                user.id,
                user.id,
                actor.type.user.id,
                actor.type.user.id,
                permission,
                'revoke',
                meta?.reason || 'revoked via PermissionService',
            ]
        );
    }
    
    async revoke_user_group_permission (actor, gid, permission, meta) {
        permission = await this._rewrite_permission(permission);
        const svc_group = this.services.get('group');
        const group = await svc_group.get({ uid: gid });
        if ( ! group ) {
            throw new Error('group not found');
        }

        // DELETE permission
        await this.db.write(
            'DELETE FROM `user_to_group_permissions` ' +
            'WHERE `user_id` = ? AND `group_id` = ? AND `permission` = ?',
            [
                actor.type.user.id,
                group.id,
                permission,
            ]
        );

        // INSERT audit table
        await this.db.write(
            'INSERT INTO `audit_user_to_group_permissions` (' +
            '`user_id`, `user_id_keep`, `group_id`, `group_id_keep`, ' +
            '`permission`, `action`, `reason`) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                actor.type.user.id,
                actor.type.user.id,
                group.id,
                group.id,
                permission,
                'revoke',
                meta?.reason || 'revoked via PermissionService',
            ]
        );
    }
    
    /**
     * List the users that have any permissions granted to the
     * specified user.
     * 
     * This is a "flat" (non-cascading) view.
     * 
     * Use History:
     * - This was written for use in ll_listusers to display
     *   home directories of users that shared files with the
     *   current user.
     */
    async list_user_permission_issuers (user) {
        const rows = await this.db.read(
            'SELECT DISTINCT issuer_user_id FROM `user_to_user_permissions` ' +
            'WHERE `holder_user_id` = ?',
            [ user.id ],
        );
        
        const users = [];
        for ( const row of rows ) {
            users.push(await get_user({ id: row.issuer_user_id }));
        }

        return users;
    }
    
    /**
     * List the permissions that the specified actor (the "issuer")
     * has granted to all other users which have some specified
     * prefix in the permission key (ex: "fs:FILE-UUID")
     * 
     * Note that if the prefix contains a literal '%' character
     * the behavior may not be as expected.
     * 
     * This is a "flat" (non-cascading) view.
     * 
     * Use History:
     * - This was written for FSNodeContext.fetchShares to query
     *   all the "shares" associated with a file.
     */
    async query_issuer_permissions_by_prefix (issuer, prefix) {
        const user_perms = await this.db.read(
            'SELECT DISTINCT holder_user_id, permission ' +
            'FROM `user_to_user_permissions` ' +
            'WHERE issuer_user_id = ? ' +
            'AND permission LIKE ?',
            [issuer.id, prefix + '%'],
        );

        const app_perms = await this.db.read(
            'SELECT DISTINCT app_id, permission ' +
            'FROM `user_to_app_permissions` ' +
            'WHERE user_id = ? ' +
            'AND permission LIKE ?',
            [issuer.id, prefix + '%'],
        );
        
        const retval = { users: [], apps: [] };
        
        for ( const user_perm of user_perms ) {
            const { holder_user_id, permission } = user_perm;
            retval.users.push({
                user: await get_user({ id: holder_user_id }),
                permission,
            });
        }

        for ( const app_perm of app_perms ) {
            const { app_id, permission } = app_perm;
            retval.apps.push({
                app: await get_app({ id: app_id }),
                permission,
            });
        }
        
        return retval;
    }
    
    async get_higher_permissions (permission) {
        const higher_perms = new Set()
        higher_perms.add(permission);

        const parent_perms = this.get_parent_permissions(permission);
        for ( const parent_perm of parent_perms ) {
            higher_perms.add(parent_perm);
            for ( const exploder of this._permission_exploders ) {
                if ( ! exploder.matches(parent_perm) ) continue;
                const perms = await exploder.explode({
                    permission: parent_perm,
                });
                for ( const perm of perms ) higher_perms.add(perm);
            }
        }
        return Array.from(higher_perms);
    }

    get_parent_permissions (permission) {
        const parent_perms = [];
        {
            // We don't use PermissionUtil.split here because it unescapes
            // components; we want to keep the components escaped for matching.
            const parts = permission.split(':');

            // Add sub-permissions
            for ( let i = 0 ; i < parts.length ; i++ ) {
                parent_perms.push(parts.slice(0, i + 1).join(':'));
            }
        }
        parent_perms.reverse();
        return parent_perms;
    }


    register_rewriter (translator) {
        if ( ! (translator instanceof PermissionRewriter) ) {
            throw new Error('translator must be a PermissionRewriter');
        }

        this._permission_rewriters.push(translator);
    }

    register_implicator (implicator) {
        if ( ! (implicator instanceof PermissionImplicator) ) {
            throw new Error('implicator must be a PermissionImplicator');
        }

        this._permission_implicators.push(implicator);
    }

    register_exploder (exploder) {
        if ( ! (exploder instanceof PermissionExploder) ) {
            throw new Error('exploder must be a PermissionExploder');
        }

        this._permission_exploders.push(exploder);
    }

    _register_commands (commands) {
        commands.registerCommands('perms', [
            {
                id: 'grant-user-app',
                handler: async (args, log) => {
                    const [ username, app_uid, permission, extra ] = args;

                    // actor from username
                    const actor = new Actor({
                        type: new UserActorType({
                            user: await get_user({ username }),
                        }),
                    })

                    await this.grant_user_app_permission(actor, app_uid, permission, extra);
                }
            }
        ]);
    }
}

module.exports = {
    PermissionRewriter,
    PermissionImplicator,
    PermissionExploder,
    PermissionUtil,
    PermissionService,
};
