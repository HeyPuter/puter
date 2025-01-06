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
const { LLFilesystemOperation } = require("./definitions");

class LLMove extends LLFilesystemOperation {
    static MODULES = {
        _path: require('path'),
    }

    async _run () {
        const { _path } = this.modules;
        const { context } = this;
        const { source, parent, user, actor, target_name, metadata } = this.values;
        const svc = context.get('services');

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

        const old_path = await source.get('path');

        const svc_fsEntry = svc.get('fsEntryService');
        const op_update = await svc_fsEntry.update(source.uid, {
            ...(
                await source.get('parent_uid') !== await parent.get('uid')
                ? { parent_uid: await parent.get('uid') }
                : {}
            ),
            path: _path.join(await parent.get('path'), target_name),
            name: target_name,
            ...(metadata ? { metadata } : {}),
        });

        source.entry.name = target_name;
        source.entry.path = _path.join(await parent.get('path'), target_name);

        await op_update.awaitDone();

        const svc_fs = svc.get('filesystem');
        await svc_fs.update_child_paths(old_path, source.entry.path, user.id);

        const svc_event = svc.get('event');

        await svc_event.emit('fs.move.file', {
            context: this.context,
            moved: source,
            old_path,
        });

        return source;
    }
}

module.exports = {
    LLMove,
};
