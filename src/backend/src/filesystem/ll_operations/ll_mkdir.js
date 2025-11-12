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
const { MODE_WRITE } = require('../../services/fs/FSLockService');
const { NodeUIDSelector, NodeChildSelector } = require('../node/selectors');
const { RESOURCE_STATUS_PENDING_CREATE } = require('../../modules/puterfs/ResourceService');
const { LLFilesystemOperation } = require('./definitions');

class LLMkdir extends LLFilesystemOperation {
    static CONCERN = 'filesystem';
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
    };

    async _run () {
        const { parent, name, immutable } = this.values;

        const actor = this.values.actor ?? this.context.get('actor');

        const services = this.context.get('services');

        const svc_fsLock = services.get('fslock');
        const svc_acl = services.get('acl');

        /* eslint-disable */ // -- Please fix this linter rule
        const lock_handle = await svc_fsLock.lock_child(
            await parent.get('path'),
            name,
            MODE_WRITE,
        );
        /* eslint-enable */

        try {
            if ( ! await svc_acl.check(actor, parent, 'write') ) {
                throw await svc_acl.get_safe_acl_error(actor, parent, 'write');
            }

            return await parent.provider.mkdir({
                actor,
                context: this.context,
                parent,
                name,
                immutable,
            });
        } finally {
            lock_handle.unlock();
        }
    }
}

module.exports = {
    LLMkdir,
};
