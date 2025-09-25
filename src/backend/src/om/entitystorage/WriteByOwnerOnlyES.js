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
const { Context } = require("../../util/context");
const { BaseES } = require("./BaseES");

const WRITE_ALL_OWNER_ES = 'system:es:write-all-owners';

/**
 * Entity storage layer that restricts write operations to entity owners only.
 * Extends BaseES to add ownership-based access control for upsert and delete operations.
 */
class WriteByOwnerOnlyES extends BaseES {
    /**
     * Static methods object containing the access-controlled entity storage operations.
     */
    static METHODS = {
        /**
         * Updates or inserts an entity after verifying ownership permissions.
         * @param {Object} entity - The entity to upsert
         * @param {Object} extra - Additional parameters including old_entity
         * @returns {Promise} Result of the upstream upsert operation
         */
        async upsert (entity, extra) {
            const { old_entity } = extra;

            if ( old_entity ) {
                await this._check_allowed({ old_entity });
            }

            return await this.upstream.upsert(entity, extra);
        },

        /**
         * Deletes an entity after verifying the current user owns it.
         * @param {string} uid - The unique identifier of the entity to delete
         * @param {Object} extra - Additional parameters including old_entity
         * @returns {Promise} Result of the upstream delete operation
         */
        async delete (uid, extra) {
            const { old_entity } = extra;

            // Owner check is required first
            await this._check_allowed({ old_entity: extra.old_entity });
            return await this.upstream.delete(uid, extra);
        },

        /**
         * Verifies that the current user has permission to modify the entity.
         * Allows access if user has system-wide write permission or owns the entity.
         * @param {Object} params - Parameters object
         * @param {Object} params.old_entity - The existing entity to check ownership for
         * @throws {APIError} Throws forbidden error if user lacks permission
         */
        async _check_allowed ({ old_entity }) {
            const svc_permission = this.context.get('services').get('permission');
            const has_permission_to_write_all = await svc_permission.check(Context.get("actor"), WRITE_ALL_OWNER_ES);
            if (has_permission_to_write_all) {
                return;
            }
            
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
