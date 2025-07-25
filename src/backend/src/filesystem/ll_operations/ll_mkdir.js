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
const { MODE_WRITE } = require("../../services/fs/FSLockService");
const { Context } = require("../../util/context");
const { NodeUIDSelector, NodeChildSelector } = require("../node/selectors");
const { RESOURCE_STATUS_PENDING_CREATE } = require("../../modules/puterfs/ResourceService");
const { LLFilesystemOperation } = require("./definitions");

class LLMkdir extends LLFilesystemOperation {
    static CONCERN = 'filesystem';
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
    }

    async _run () {
        const { parent, name, immutable } = this.values;
        return parent.provider.mkdir({
            context: this.context,
            parent,
            name,
            immutable,
        });
    }
}

module.exports = {
    LLMkdir,
};
