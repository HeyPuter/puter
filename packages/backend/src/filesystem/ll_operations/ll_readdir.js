/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { chkperm, get_descendants } = require("../../helpers");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { NodeUIDSelector, NodeRawEntrySelector } = require("../node/selectors");
const { LLFilesystemOperation } = require("./definitions");

class LLReadDir extends LLFilesystemOperation {
    async _run () {
        const { context } = this;
        const { subject, user, actor } = this.values;

        if ( ! await subject.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        const svc_acl = context.get('services').get('acl');
        if ( ! await svc_acl.check(actor, subject, 'list') ) {
            throw await svc_acl.get_safe_acl_error(actor, subject, 'list');
        }

        const subject_uuid = await subject.get('uid');

        const svc = context.get('services');
        const svc_fsentry = svc.get('fsEntryService');
        const svc_fs = svc.get('filesystem');

        if (
            subject.isRoot ||
            (await subject.isUserDirectory() && subject.name !== user.username)
        ) {
            this.checkpoint('before call to get_descendants')
            const entries = await get_descendants(
                await subject.get('path'),
                user,
                1, true,
            )
            this.checkpoint('after call to get_descendants')

            const children = await Promise.all(entries.map(async entry => {
                const node = await svc_fs.node(new NodeRawEntrySelector(entry));
                node.found_thumbnail = false;
                return node;
            }))

            this.checkpoint('after get children (2)');

            return children;
        }

        this.checkpoint('before get direct descendants')
        const child_uuids = await svc_fsentry
            .fast_get_direct_descendants(subject_uuid);
        this.checkpoint('after get direct descendants')
        const children = await Promise.all(child_uuids.map(async uuid => {
            return await svc_fs.node(new NodeUIDSelector(uuid));
        }));
        this.checkpoint('after get children');

        return children;
    }
}

module.exports = {
    LLReadDir,
};
