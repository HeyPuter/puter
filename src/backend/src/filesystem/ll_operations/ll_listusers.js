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
const { RootNodeSelector, NodeChildSelector } = require('../node/selectors');
const { LLFilesystemOperation } = require('./definitions');

class LLListUsers extends LLFilesystemOperation {
    static description = `
        List user directories which are relevant to the
        current actor.
    `;

    async _run () {
        const { context } = this;
        const svc = context.get('services');
        const svc_permission = svc.get('permission');
        const svc_fs = svc.get('filesystem');

        const user = this.values.user;
        const issuers = await svc_permission.list_user_permission_issuers(user);

        const nodes = [];

        nodes.push(await svc_fs.node(new NodeChildSelector(new RootNodeSelector(),
                        user.username)));

        for ( const issuer of issuers ) {
            const node = await svc_fs.node(new NodeChildSelector(new RootNodeSelector(),
                            issuer.username));
            nodes.push(node);
        }

        return nodes;
    }
}

module.exports = {
    LLListUsers,
};
