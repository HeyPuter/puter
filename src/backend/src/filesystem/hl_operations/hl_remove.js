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
const { chkperm } = require("../../helpers");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { LLRmDir } = require("../ll_operations/ll_rmdir");
const { LLRmNode } = require("../ll_operations/ll_rmnode");
const { HLFilesystemOperation } = require("./definitions");

class HLRemove extends HLFilesystemOperation {
    static PARAMETERS = {
        target: {},
        user: {},
        recursive: {},
        descendants_only: {},
    }

    async _run () {
        const { target, user } = this.values;

        if ( ! await target.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        if ( ! chkperm(target.entry, user.id, 'rm') ) {
            throw APIError.create('forbidden');
        }

        if ( await target.get('type') === TYPE_DIRECTORY ) {
            const ll_rmdir = new LLRmDir();
            return await ll_rmdir.run(this.values);
        }

        const ll_rmnode = new LLRmNode();
        return await ll_rmnode.run(this.values);
    }
}

module.exports = {
    HLRemove,
};
