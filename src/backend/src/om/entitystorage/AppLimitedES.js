/*
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
const APIError = require('../../api/APIError');
const { AppUnderUserActorType } = require('../../services/auth/Actor');
const { PermissionUtil } = require('../../services/auth/permissionUtils.mjs');
const { Context } = require('../../util/context');
const { Eq, Or } = require('../query/query');
const { BaseES } = require('./BaseES');
const { Entity } = require('./Entity');

class AppLimitedES extends BaseES {

    // #region read operations

    // Limit selection to entities owned by the app of the current actor.
    async select (options) {
        const actor = Context.get('actor');

        app_under_user_check:
        if ( actor.type instanceof AppUnderUserActorType ) {
            const svc_permission = Context.get('services').get('permission');
            const perm = PermissionUtil.join('apps-of-user', actor.type.user.uuid, 'read');
            const can_read_any = await svc_permission.check(actor, perm);

            if ( can_read_any ) break app_under_user_check;

            if ( this.exception && typeof this.exception === 'function' ) {
                this.exception = await this.exception();
            }

            let condition = new Eq({
                key: 'app_owner',
                value: actor.type.app,
            });
            if ( this.exception ) {
                condition = new Or({
                    children: [
                        condition,
                        this.exception,
                    ],
                });
            }
            options.predicate = options.predicate.and(condition);
        }

        return await this.upstream.select(options);
    }

    // Limit read to entities owned by the app of the current actor.
    async read (uid) {
        const entity = await this.upstream.read(uid);
        if ( ! entity ) return null;

        const actor = Context.get('actor');

        if ( actor.type instanceof AppUnderUserActorType ) {
            if ( this.exception && typeof this.exception === 'function' ) {
                this.exception = await this.exception();
            }

            // On the exception, we don't have to check app_owner
            // (for `es:apps` this is `approved_for_listing == 1`)
            if ( this.exception && await entity.check(this.exception) ) {
                return entity;
            }

            const app = actor.type.app;
            const app_owner = await entity.get('app_owner');
            let app_owner_id = app_owner?.id;
            if ( app_owner instanceof Entity ) {
                app_owner_id = app_owner.private_meta.mysql_id;
            }
            if ( ( !app_owner ) || app_owner_id !== app.id ) {
                return null;
            }
        }

        return entity;
    }

    // #endregion

    // #region write operations

    // Limit edit to entities owned by the app of the current actor
    async upsert (entity, extra) {
        const actor = Context.get('actor');
        if ( actor.type instanceof AppUnderUserActorType ) {
            const { old_entity } = extra;
            if ( old_entity ) {
                await this._check_edit_allowed({ old_entity });
            }
        }
        return await this.upstream.upsert(entity, extra);
    }
    async delete (uid, extra) {
        const actor = Context.get('actor');
        if ( actor.type instanceof AppUnderUserActorType ) {
            const { old_entity } = extra;
            await this._check_edit_allowed({ old_entity });
        }
        return await this.upstream.delete(uid, extra);
    }
    async _check_edit_allowed ({ old_entity }) {
        const actor = Context.get('actor');

        // Maybe the app has been granted write access to all the user's apps
        // (in which case we return early)
        {
            const svc_permission = Context.get('services').get('permission');
            const perm = PermissionUtil.join('apps-of-user', actor.type.user.uuid, 'write');
            const can_write_any = await svc_permission.check(actor, perm);
            if ( can_write_any ) return;
        }

        // Otherwise, verify the app owner
        // (or we throw an APIError)
        {
            const app = actor.type.app;
            const app_owner = await old_entity.get('app_owner');
            let app_owner_id = app_owner?.id;
            if ( app_owner instanceof Entity ) {
                app_owner_id = app_owner.private_meta.mysql_id;
            }
            if ( ( !app_owner ) || app_owner_id !== app.id ) {
                throw APIError.create('forbidden');
            }
        }
    }
    // #endregion
}

module.exports = {
    AppLimitedES,
};
