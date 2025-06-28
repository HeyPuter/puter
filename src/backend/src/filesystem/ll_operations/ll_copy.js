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
const fsCapabilities = require('../definitions/capabilities');

class LLCopy extends LLFilesystemOperation {
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
    }

    async _run () {
        const { _path, uuidv4 } = this.modules;
        const { context } = this;
        const { source, parent, user, actor, target_name } = this.values;
        const svc = context.get('services');

        const tracer = svc.get('traceService').tracer;
        const fs = svc.get('filesystem');
        const svc_event = svc.get('event');

        const uuid = uuidv4();
        const ts = Math.round(Date.now()/1000);

        this.field('target-uid', uuid);
        this.field('source', source.selector.describe());

        this.checkpoint('before fetch parent entry');
        await parent.fetchEntry();
        this.checkpoint('before fetch source entry');
        await source.fetchEntry({ thumbnail: true });
        this.checkpoint('fetched source and parent entries');

        console.log('PATH PARAMETERS', {
            path: await parent.get('path'),
            target_name,
        })

        // Access Control
        {
            const svc_acl = context.get('services').get('acl');
            this.checkpoint('copy :: access control');

            // Check read access to source
            if ( ! await svc_acl.check(actor, source, 'read') ) {
                throw await svc_acl.get_safe_acl_error(actor, source, 'read');
            }

            // Check write access to destination
            if ( ! await svc_acl.check(actor, parent, 'write') ) {
                throw await svc_acl.get_safe_acl_error(actor, source, 'write');
            }
        }

        const capabilities = source.provider.get_capabilities();
        if ( capabilities.has(fsCapabilities.COPY_TREE) ) {
            const result_node = await source.provider.copy_tree({
                context,
                source,
                parent,
                target_name,
            });
            return result_node;
        } else {
            throw new Error('only copy_tree is current supported by ll_copy');
        }
    }
}

module.exports = {
    LLCopy,
};
