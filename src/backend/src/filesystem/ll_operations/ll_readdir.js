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
const fsCapabilities = require("../definitions/capabilities");
const { TYPE_SYMLINK } = require("../FSNodeContext");
const { RootNodeSelector } = require("../node/selectors");
const { NodeUIDSelector, NodeChildSelector } = require("../node/selectors");
const { LLFilesystemOperation } = require("./definitions");

class LLReadDir extends LLFilesystemOperation {
    static CONCERN = 'filesystem';
    async _run () {
        const { context } = this;
        const { subject: subject_let, actor, no_acl } = this.values;
        let subject = subject_let;

        if ( ! await subject.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }

        const svc_acl = context.get('services').get('acl');
        if ( ! no_acl ) {
            if ( ! await svc_acl.check(actor, subject, 'list') ) {
                throw await svc_acl.get_safe_acl_error(actor, subject, 'list');
            }
        }

        // TODO: DRY ACL check here
        const subject_type = await subject.get('type');
        if ( subject_type === TYPE_SYMLINK ) {
            const target = await subject.getTarget();
            if ( ! no_acl ) {
                if ( ! await svc_acl.check(actor, target, 'list') ) {
                    throw await svc_acl.get_safe_acl_error(actor, target, 'list');
                }
            }
            subject = target;
        }

        const svc = context.get('services');
        const svc_fs = svc.get('filesystem');

        if ( subject.isRoot ) {
            if ( ! actor.type.user ) return [];
            return [
                await svc_fs.node(new NodeChildSelector(
                    new RootNodeSelector(),
                    actor.type.user.username,
                ))
            ];
        }

        const capabilities = subject.provider.get_capabilities();

        // UUID Mode
        if ( capabilities.has(fsCapabilities.READDIR_UUID_MODE) ) {
            this.checkpoint('readdir uuid mode')
            const child_uuids = await subject.provider.readdir({
                context,
                node: subject,
            });
            this.checkpoint('after get direct descendants')
            const children = await Promise.all(child_uuids.map(async uuid => {
                return await svc_fs.node(new NodeUIDSelector(uuid));
            }));
            this.checkpoint('after get children');
            return children;
        }

        // Conventional Mode
        const child_entries = subject.provider.readdir({
            context,
            node: subject,
        });

        return await Promise.all(child_entries.map(async entry => {
            return await svc_fs.node(new NodeChildSelector(subject, entry.name));
        }));
    }
}

module.exports = {
    LLReadDir,
};
