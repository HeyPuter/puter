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
const { AppUnderUserActorType } = require('../../services/auth/Actor');
const { Context } = require('../../util/context');
const { Eq, Or } = require('../query/query');
const { BaseES } = require('./BaseES');
const { Entity } = require('./Entity');

class AppLimitedES extends BaseES {

    // Limit selection to entities owned by the app of the current actor.
    async select (options) {
        const actor = Context.get('actor');

        if ( actor.type instanceof AppUnderUserActorType ) {
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
}

module.exports = {
    AppLimitedES,
};
