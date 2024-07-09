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
const { Sequence } = require("../../codex/Sequence");
const { get_user } = require("../../helpers");
const { Actor, UserActorType } = require("../../services/auth/Actor");



module.exports = new Sequence([
    async function rewrite_permission (a) {
        let { permission } = a.values();
        permission = await a.icall('_rewrite_permission', permission);
        a.values({ permission });
    },
    async function explode_permission (a) {
        const { permission } = a.values();
        const permission_options =
            await a.icall('get_higher_permissions', permission);
        a.values({ permission_options });
    },
    async function try_hardcoded_permission (a) {
        const {
            permission_options,
            implicit_user_permissions
        } = a.values();

        for ( const perm of permission_options ) {
            if ( implicit_user_permissions[perm] ) {
                return a.stop(implicit_user_permissions[perm]);
            }
        }
    },
    async function try_permission_implicators (a) {
        // NOTE: it's really weird that we check `permission` only and not
        //       the `permission_options` list here. I haven't changed this
        //       to avoid regressions but it's something to consider.
        const { actor, permission } = a.values();

        const _permission_implicators = a.iget('_permission_implicators');
        
        for ( const implicator of _permission_implicators ) {
            if ( ! implicator.matches(permission) ) continue;
            const implied = await implicator.check({
                actor,
                permission,
                recurse: this.check.bind(this),
            });
            if ( implied ) {
                return a.stop(implied);
            }
        }
    },
    async function try_user_to_user_permissions (a) {
        const { actor, permission_options } = a.values();
        const db = a.iget('db');

        let sql_perm = permission_options.map((perm) =>
            `\`permission\` = ?`).join(' OR ');

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
            const issuer_actor = new Actor({
                type: new UserActorType({
                    user: await get_user({ id: row.issuer_user_id }),
                }),
            });

            // const issuer_perm = await this.check(issuer_actor, row.permission);
            const issuer_perm = await a.icall('check', issuer_actor, row.permission);

            if ( ! issuer_perm ) continue;

            return a.stop(row.extra);
        }
    },
    async function try_user_to_group_permissions (a) {
        const { actor, permission_options } = a.values();
        const db = a.iget('db');

        let sql_perm = permission_options.map((perm) =>
            `p.permission = ?`).join(' OR ');

        if ( permission_options.length > 1 ) {
            sql_perm = '(' + sql_perm + ')';
        }
        const rows = await db.read(
            'SELECT p.permission, p.user_id, p.extra FROM `user_to_group_permissions` p ' +
            'JOIN `jct_user_group` ug ON p.group_id = ug.group_id ' +
            'WHERE ug.user_id = ? AND ' + sql_perm,
            [
                actor.type.user.id,
                ...permission_options,
            ]
        );

        for ( const row of rows ) {
            const issuer_actor = new Actor({
                type: new UserActorType({
                    user: await get_user({ id: row.user_id }),
                }),
            });

            const issuer_perm = await a.icall('check', issuer_actor, row.permission);

            if ( ! issuer_perm ) continue;

            return a.stop(row.extra);
        }
    }
]);
