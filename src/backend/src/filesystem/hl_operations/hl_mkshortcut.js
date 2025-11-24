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
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const FlagParam = require('../../api/filesystem/FlagParam');
const StringParam = require('../../api/filesystem/StringParam');
const { TYPE_DIRECTORY } = require('../FSNodeContext');
const { HLFilesystemOperation } = require('./definitions');

class HLMkShortcut extends HLFilesystemOperation {
    static PARAMETERS = {
        parent: new FSNodeParam('shortcut'),
        name: new StringParam('name'),
        target: new FSNodeParam('target'),

        dedupe_name: new FlagParam('dedupe_name', { optional: true }),
    };

    static MODULES = {
        path: require('node:path'),
    };

    async _run () {
        console.log('HLMKSHORTCUT IS HAPPENING');
        const { context, values } = this;
        const fs = context.get('services').get('filesystem');

        const { target, parent, user, actor } = values;
        let { name, dedupe_name } = values;

        if ( ! await target.exists() ) {
            throw APIError.create('shortcut_to_does_not_exist');
        }

        if ( ! name ) {
            dedupe_name = true;
            name = `Shortcut to ${ await target.get('name')}`;
        }

        {
            const svc_acl = context.get('services').get('acl');
            if ( ! await svc_acl.check(actor, target, 'read') ) {
                throw await svc_acl.get_safe_acl_error(actor, target, 'read');
            }
        }

        if ( ! await parent.exists() ) {
            throw APIError.create('dest_does_not_exist');
        }

        if ( await parent.get('type') !== TYPE_DIRECTORY ) {
            throw APIError.create('dest_is_not_a_directory');
        }

        {
            const dest = await parent.getChild(name);
            if ( await dest.exists() ) {
                if ( ! dedupe_name ) {
                    throw APIError.create('item_with_same_name_exists', null, {
                        entry_name: name,
                    });
                }

                const name_ext = this.modules.path.extname(name);
                const name_noext = this.modules.path.basename(name, name_ext);
                for ( let i = 1 ;; i++ ) {
                    const try_new_name = `${name_noext} (${i})${name_ext}`;
                    const try_dest = await parent.getChild(try_new_name);
                    if ( ! await try_dest.exists() ) {
                        name = try_new_name;
                        break;
                    }
                }
            }
        }

        const created = await fs.mkshortcut({
            target,
            parent,
            name,
            user,
        });

        await created.awaitStableEntry();
        return await created.getSafeEntry();
    }
}

module.exports = {
    HLMkShortcut,
};
