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
const config = require('../../config');

const { DB_READ } = require('../../services/database/consts');
const { Context } = require('../../util/context');
const { Eq } = require('../query/query');
const { BaseES } = require('./BaseES');

const PERM_READ_ALL_SUBDOMAINS = 'read-all-subdomains';

class SubdomainES extends BaseES {
    static METHODS = {
        async _on_context_provided () {
            const services = this.context.get('services');
            this.db = services.get('database').get(DB_READ, 'subdomains');
        },
        async create_predicate (id) {
            if ( id === 'user-can-edit' ) {
                return new Eq({
                    key: 'owner',
                    value: Context.get('user').id,
                });
            }
        },
        async upsert (entity, extra) {
            if ( ! extra.old_entity ) {
                await this._check_max_subdomains();
            }

            return await this.upstream.upsert(entity, extra);
        },
        async select (options) {
            const actor = Context.get('actor');
            const user = actor.type.user;

            // Note: we don't need to worry about read;
            // non-owner users don't have permission to list
            // but they still have permission to read.
            const svc_permission = this.context.get('services').get('permission');
            const has_permission_to_read_all = await svc_permission.check(Context.get('actor'), PERM_READ_ALL_SUBDOMAINS);

            if ( ! has_permission_to_read_all ) {
                options.predicate = options.predicate.and(new Eq({
                    key: 'owner',
                    value: user.id,
                }));
            }

            return await this.upstream.select(options);
        },
        async _check_max_subdomains () {
            const user = Context.get('user');

            let cnt = await this.db.read('SELECT COUNT(id) AS subdomain_count FROM subdomains WHERE user_id = ?',
                            [user.id]);

            const max_subdomains = user.max_subdomains ?? config.max_subdomains_per_user;

            if ( max_subdomains && cnt[0].subdomain_count >= max_subdomains ) {
                throw APIError.create('subdomain_limit_reached', null, {
                    limit: max_subdomains,
                });
            }
        },
    };
}

module.exports = SubdomainES;