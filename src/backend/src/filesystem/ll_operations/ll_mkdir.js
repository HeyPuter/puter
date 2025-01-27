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
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { NodeUIDSelector, NodeChildSelector } = require("../node/selectors");
const { RESOURCE_STATUS_PENDING_CREATE } = require("../../modules/puterfs/ResourceService");
const { LLFilesystemOperation } = require("./definitions");

class LLMkdir extends LLFilesystemOperation {
    static MODULES = {
        _path: require('path'),
        uuidv4: require('uuid').v4,
    }

    async _run () {
        const { context } = this;
        const { parent, name } = this.values;

        this.checkpoint('lock requested');
        this.log.noticeme('GET FSLOCK');
        const svc_fslock = context.get('services').get('fslock');
        this.log.noticeme('REQUESTING LOCK');
        const lock_handle = await svc_fslock.lock_child(
            await parent.get('path'),
            name,
            MODE_WRITE,
        );
        this.log.noticeme('GOT LOCK');
        this.checkpoint('lock acquired');

        try {
            return await this._locked_run();
        } finally {
            await lock_handle.unlock();
        }
    }
    async _locked_run () {
        const { _path, uuidv4 } = this.modules;
        const { context } = this;
        const { parent, name, immutable, actor } = this.values;

        const ts = Math.round(Date.now() / 1000);
        const uid = uuidv4();
        const resourceService = context.get('services').get('resourceService');
        const svc_fsEntry = context.get('services').get('fsEntryService');
        const svc_event = context.get('services').get('event');
        const fs = context.get('services').get('filesystem');

        this.field('fsentry-uid', uid);

        const existing = await fs.node(
            new NodeChildSelector(parent.selector, name)
        );

        if ( await existing.exists() ) {
            throw APIError.create('item_with_same_name_exists', null, {
                entry_name: name,
            });
        }

        this.checkpoint('before acl');
        const svc_acl = context.get('services').get('acl');
        if ( ! await parent.exists() ) {
            throw APIError.create('subject_does_not_exist');
        }
        if ( ! await svc_acl.check(actor, parent, 'write') ) {
            throw await svc_acl.get_safe_acl_error(actor, parent, 'write');
        }

        resourceService.register({
            uid,
            status: RESOURCE_STATUS_PENDING_CREATE,
        });

        const raw_fsentry = {
            is_dir: 1,
            uuid: uid,
            parent_uid: await parent.get('uid'),
            path: _path.join(await parent.get('path'), name),
            user_id: actor.type.user.id,
            name,
            created: ts,
            accessed: ts,
            modified: ts,
            immutable: immutable ?? false,
            ...(this.values.thumbnail ? {
                thumbnail: this.values.thumbnail,
            } : {}),
        };

        this.log.debug('creating fsentry', { fsentry: raw_fsentry })

        this.checkpoint('about to enqueue insert');
        const entryOp = await svc_fsEntry.insert(raw_fsentry);

        this.field('fsentry-created', false);

        this.checkpoint('enqueued insert');
        // Asynchronous behaviour temporarily disabled
        // (async () => {
            await entryOp.awaitDone();
            this.log.debug('finished creating fsentry', { uid })
            resourceService.free(uid);
            this.field('fsentry-created', true);
        // })();

        const node = await fs.node(new NodeUIDSelector(uid));

        svc_event.emit('fs.create.directory', {
            node,
            context: Context.get(),
        });

        this.checkpoint('returning node');
        return node
    }
}

module.exports = {
    LLMkdir,
};
