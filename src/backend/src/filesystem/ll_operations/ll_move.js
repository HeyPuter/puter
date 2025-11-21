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
const { LLFilesystemOperation } = require('./definitions');

class LLMove extends LLFilesystemOperation {
    static MODULES = {
        _path: require('path'),
    };

    async _run () {
        const { context } = this;
        const { source, parent, actor, target_name, metadata } = this.values;

        // Access Control
        {
            const svc_acl = context.get('services').get('acl');
            this.checkpoint('move :: access control');

            // Check write access to source
            if ( ! await svc_acl.check(actor, source, 'write') ) {
                throw await svc_acl.get_safe_acl_error(actor, source, 'write');
            }

            // Check write access to destination
            if ( ! await svc_acl.check(actor, parent, 'write') ) {
                throw await svc_acl.get_safe_acl_error(actor, parent, 'write');
            }
        }

        await source.provider.move({
            context: this.context,
            node: source,
            new_parent: parent,
            new_name: target_name,
            metadata,
        });
        return source;
    }
}

module.exports = {
    LLMove,
};
