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
const APIError = require("../../api/APIError");
const { NodeInternalIDSelector } = require("../../filesystem/node/selectors");
const { Context } = require("../../util/context");
const { BaseES } = require("./BaseES");

class WriteByOwnerOnlyES extends BaseES {
    static METHODS = {
        async upsert (entity, extra) {
            const { old_entity } = extra;

            if ( old_entity ) {
                await this._check_allowed({ old_entity });
            }

            return await this.upstream.upsert(entity, extra);
        },

        async delete (uid, extra) {
            const { old_entity } = extra;

            // Owner check is required first
            await this._check_allowed({ old_entity: extra.old_entity });
            return await this.upstream.delete(uid, extra);
        },

        async _check_allowed ({ old_entity }) {
            const owner = await old_entity.get('owner');
            if ( ! owner ) {
                throw APIError.create('forbidden');
            }
            const user = Context.get('user');
            if ( user.id !== owner.id ) {
                throw APIError.create('forbidden');
            }
        }

    }
}

module.exports = WriteByOwnerOnlyES;
