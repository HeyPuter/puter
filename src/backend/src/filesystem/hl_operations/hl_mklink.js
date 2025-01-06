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
const FSNodeParam = require("../../api/filesystem/FSNodeParam");
const StringParam = require("../../api/filesystem/StringParam");
const { HLFilesystemOperation } = require("./definitions");
const { chkperm } = require("../../helpers");
const APIError = require("../../api/APIError");
const { TYPE_DIRECTORY } = require("../FSNodeContext");

class HLMkLink extends HLFilesystemOperation {
    static PARAMETERS = {
        parent: new FSNodeParam('symlink'),
        name: new StringParam('name'),
        target: new StringParam('target'),
    }

    static MODULES = {
        path: require('node:path'),
    }

    async _run () {
        const { context, values } = this;
        const fs = context.get('services').get('filesystem');

        const { target, parent, user } = values;
        let { name } = values;

        if ( ! name ) {
            throw APIError.create('field_empty', null, { key: 'name' });
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
                throw APIError.create('item_with_same_name_exists', null, {
                    entry_name: name,
                });
            }
        }

        const created = await fs.mklink({
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
    HLMkLink,
};
