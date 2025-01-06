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
const { chkperm, validate_fsentry_name, is_ancestor_of, df, get_user } = require("../../helpers");
const { LLMove } = require("../ll_operations/ll_move");
const { RootNodeSelector } = require("../node/selectors");
const { HLFilesystemOperation } = require("./definitions");
const { MkTree } = require("./hl_mkdir");
const { HLRemove } = require("./hl_remove");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const config = require("../../config");

class HLMove extends HLFilesystemOperation {
    static MODULES = {
        _path: require('path'),
    }
    async _run () {
        const { _path } = this.modules;

        const { context, values } = this;
        const svc = context.get('services');
        const fs = svc.get('filesystem');

        const new_metadata  = typeof values.new_metadata === 'string'
            ? values.new_metadata : JSON.stringify(values.new_metadata);

        // !! new_name, create_missing_parents, overwrite, dedupe_name

        let parent = values.destination_or_parent;
        let dest = null;
        const source = values.source;

        if ( await source.get('is-root') ) {
            throw APIError.create('immutable');
        }
        if ( await parent.get('is-root') ) {
            throw APIError.create('cannot_copy_to_root');
        }

        if ( ! await source.exists() ) {
            throw APIError.create('source_does_not_exist');
        }

        if ( ! await chkperm(source.entry, values.user.id, 'cp') ) {
            throw APIError.create('forbidden');
        }

        if ( source.entry.immutable ) {
            throw APIError.create('immutable');
        }

        // If the "parent" is a file, then it's actually our destination; not the parent.
        if ( ! values.new_name && await parent.exists() && await parent.get('type') !== TYPE_DIRECTORY ) {
            dest = parent;
            parent = await dest.getParent();
        }

        if ( ! await parent.exists() ) {
            if ( ! parent.path || ! values.create_missing_parents ) {
                throw APIError.create('dest_does_not_exist');
            }

            const tree_op = new MkTree();
            await tree_op.run({
                parent: await fs.node(new RootNodeSelector()),
                tree: [parent.path],
            });

            parent = tree_op.leaves[0];
        }

        await parent.fetchEntry();
        if ( ! await chkperm(parent.entry, values.user.id, 'write') ) {
            throw APIError.create('forbidden');
        }
        if ( await parent.get('type') !== TYPE_DIRECTORY ) {
            throw APIError.create('dest_is_not_a_directory');
        }

        let source_user, dest_user;

        // 3. Verify cross-user size constraints
        const src_user_id = await source.get('user_id');
        const par_user_id = await parent.get('user_id');
        if ( src_user_id !== par_user_id ) {
            source_user = await get_user({id: src_user_id});
            if(source_user.id !== par_user_id)
                dest_user = await get_user({id: par_user_id});
            else
                dest_user = source_user;
            await source.fetchSize();
            const item_size = source.entry.size;
            const sizeService = svc.get('sizeService');
            const capacity = await sizeService.get_storage_capacity(user.id);
            if(capacity - await df(dest_user.id) - item_size < 0){
                throw APIError.create('storage_limit_reached');
            }
        }

        let target_name = values.new_name ?? await source.get('name');
        const metadata = new_metadata ?? await source.get('metadata');

        try {
            validate_fsentry_name(target_name);
        } catch (e) {
            throw APIError.create(400, e);
        }

        if ( dest === null ) {
            dest = await parent.getChild(target_name);
        }

        const src_uid = await source.get('uid');
        // const dst_uid = await dest.get('uid');
        const par_uid = await parent.get('uid');

        if ( src_uid === par_uid ) {
            throw APIError.create('source_and_dest_are_the_same');
        }
        if ( await is_ancestor_of(src_uid, par_uid) ) {
            throw APIError('cannot_move_item_into_itself');
        }

        let overwritten;
        if ( await dest.exists() ) {
            if ( ! values.overwrite && ! values.dedupe_name ) {
                throw APIError.create('item_with_same_name_exists', null, {
                    entry_name: target_name,
                });
            }

            if ( values.dedupe_name ) {
                const svc_fsEntryFetcher = svc.get('fsEntryFetcher');
                const target_ext = _path.extname(target_name);
                const target_noext = _path.basename(target_name, target_ext);
                for ( let i=1 ;; i++ ) {
                    const try_new_name = `${target_noext} (${i})${target_ext}`;
                    const exists = await svc_fsEntryFetcher.nameExistsUnderParent(
                        parent.uid, try_new_name
                    );
                    if ( ! exists ) {
                        target_name = try_new_name;
                        break;
                    }
                }

                dest = await parent.getChild(target_name);
            }
            else if ( values.overwrite ) {
                overwritten = await dest.getSafeEntry();
                const hl_remove = new HLRemove();
                await hl_remove.run({
                    target: dest,
                    user: values.user,
                });
            }
            else { throw new Error('unreachable'); }
        }

        const old_path = await source.get('path');

        const ll_move = new LLMove();
        const source_new = await ll_move.run({
            source,
            parent,
            target_name,
            user: values.user,
            metadata: metadata,
        });

        await source_new.awaitStableEntry();
        await source_new.fetchSuggestedApps();
        await source_new.fetchOwner();
        return {
            moved: await source_new.getSafeEntry({ thumbnail: true }),
            overwritten,
            old_path,
        }
    }
}

module.exports = {
    HLMove,
};
