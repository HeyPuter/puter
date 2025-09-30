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
const { get_user } = require("../../helpers");
const { PermissionUtil } = require("../../services/auth/PermissionUtils.mjs");
const { DB_WRITE } = require("../../services/database/consts");
const { NodeUIDSelector } = require("../node/selectors");
const { LLFilesystemOperation } = require("./definitions");
const { LLReadDir } = require("./ll_readdir");

class LLReadShares extends LLFilesystemOperation {
    static description = `
        Obtain the highest-level entries under this directory
        for which the current actor has at least "see" permission.
        
        This is a breadth-first search. When any node is
        found with "see" permission is found, children of that node
        will not be traversed.
    `;
    
    async _run () {
        const { subject, user, actor } = this.values;

        const svc = this.context.get('services');

        const svc_fs = svc.get('filesystem');
        const svc_acl = svc.get('acl');
        const db = svc.get('database').get(DB_WRITE, 'll_readshares');

        const issuer_username = await subject.getUserPart();
        const issuer_user = await get_user({ username: issuer_username });
        const rows = await db.read(
            'SELECT DISTINCT permission FROM `user_to_user_permissions` ' +
            'WHERE `holder_user_id` = ? AND `issuer_user_id` = ? ' +
            'AND `permission` LIKE ?',
            [user.id, issuer_user.id, 'fs:%']
        );

        const fsentry_uuids = [];
        for ( const row of rows ) {
            const parts = PermissionUtil.split(row.permission);
            fsentry_uuids.push(parts[1]);
        }

        const results = [];

        const ll_readdir = new LLReadDir();
        let interm_results = await ll_readdir.run({
            subject,
            actor,
            user,
            no_thumbs: true,
            no_assocs: true,
            no_acl: true,
        });

        // Clone interm_results in case ll_readdir ever implements caching
        interm_results = interm_results.slice();

        for ( const fsentry_uuid of fsentry_uuids ) {
            const node = await svc_fs.node(new NodeUIDSelector(fsentry_uuid));
            if ( ! node ) continue;
            interm_results.push(node);
        }

        for ( const node of interm_results ) {
            if ( ! await node.exists() ) continue;
            if ( ! await svc_acl.check(actor, node, 'see') ) continue;
            results.push(node);
        }

        return results;
    }
}

module.exports = {
    LLReadShares,
};
