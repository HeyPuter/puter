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
const { chkperm, validate_fsentry_name, get_user, is_ancestor_of } = require("../../helpers");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { NodePathSelector, RootNodeSelector } = require("../node/selectors");
const { HLFilesystemOperation } = require("./definitions");
const { MkTree } = require("./hl_mkdir");
const { HLRemove } = require("./hl_remove");
const config = require("../../config");

class HLCopy extends HLFilesystemOperation {
    static DESCRIPTION = `
        High-level copy operation.

        This operation is a wrapper around the low-level copy operation.
        It provides the following features:
        - create missing parent directories
        - overwrite existing files or directories
        - deduplicate files/directories with the same name
    `

    static MODULES = {
        _path: require('path'),
    }

    static PARAMETERS = {
        source: {},
        destionation_or_parent: {},
        new_name: {},

        overwrite: {},
        dedupe_name: {},

        create_missing_parents: {},

        user: {},
    }

    async _run () {
        const { _path } = this.modules;

        const { values, context } = this;
        const svc = context.get('services');
        const fs = svc.get('filesystem');

        let parent = values.destination_or_parent;
        let dest = null;

        const source = values.source;

        if ( values.overwrite && values.dedupe_name ) {
            throw APIError.create('overwrite_and_dedupe_exclusive');
        }

        if ( ! await source.exists() ) {
            throw APIError.create('source_does_not_exist');
        }

        if ( ! await chkperm(source.entry, values.user.id, 'cp') ) {
            throw APIError.create('forbidden');
        }

        if ( await parent.get('is-root') ) {
            throw APIError.create('cannot_copy_to_root');
        }

        // If parent exists and is a file, and a new name wasn't
        // specified, the intention must be to overwrite the file.
        if (
            ! values.new_name &&
            await parent.exists() &&
            await parent.get('type') !== TYPE_DIRECTORY
        ) {
            dest = parent;
            parent = await dest.getParent();
            await parent.fetchEntry();
        }

        // If parent is not found either throw an error or create
        // the parent directory as specified by parameters.
        if ( ! await parent.exists() ) {
            if ( ! (parent.selector instanceof NodePathSelector) ) {
                throw APIError.create('dest_does_not_exist', null, {
                    parent: parent.selector,
                });
            }
            const path = parent.selector.value;
            const tree_op = new MkTree();
            await tree_op.run({
                parent: await fs.node(new RootNodeSelector()),
                tree: [path],
            });
            await parent.fetchEntry({ force: true });
        }

        if (
            await parent.get('type') !== TYPE_DIRECTORY
        ) {
            throw APIError.create('dest_is_not_a_directory');
        }

        if ( ! await chkperm(parent.entry, values.user.id, 'write') ) {
            throw APIError.create('forbidden');
        }

        let target_name = values.new_name ?? await source.get('name');

        try {
            validate_fsentry_name(target_name);
        } catch (e) {
            throw APIError.create(400, e);
        }

        // NEXT: implement _verify_room with profiling
        const tracer = svc.get('traceService').tracer;
        await tracer.startActiveSpan(`fs:cp:verify-size-constraints`, async span => {
            const source_file = source.entry;
            const dest_fsentry = parent.entry;

            let source_user = await get_user({id: source_file.user_id});
            let dest_user = source_user.id !== dest_fsentry.user_id
                ? await get_user({id: dest_fsentry.user_id})
                : source_user ;
            const sizeService = svc.get('sizeService');
            let deset_usage = await sizeService.get_usage(dest_user.id);

            const size = await source.fetchSize();
            const capacity = await sizeService.get_storage_capacity(dest_user.id);
            if(capacity - deset_usage - size < 0){
                throw APIError.create('storage_limit_reached');
            }
            span.end();
        });

        if ( dest === null ) {
            dest = await parent.getChild(target_name);
        }

        // Ensure copy operation is legal
        // TODO: maybe this is better in the low-level operation
        if ( await source.get('uid') == await parent.get('uid') ) {
            throw APIError.create('source_and_dest_are_the_same');
        }

        if ( await is_ancestor_of(source.mysql_id, parent.mysql_id) ) {
            throw APIError('cannot_copy_item_into_itself');
        }

        let overwritten;
        if ( await dest.exists() ) {
            // condition: no overwrite behaviour specified
            if ( ! values.overwrite && ! values.dedupe_name ) {
                throw APIError.create('item_with_same_name_exists', null, {
                    entry_name: dest.entry.name
                });
            }

            if ( values.dedupe_name ) {
                const fsEntryFetcher = context.get('services').get('fsEntryFetcher');
                const target_ext = _path.extname(target_name);
                const target_noext = _path.basename(target_name, target_ext);
                for ( let i=1 ;; i++ ) {
                    const try_new_name = `${target_noext} (${i})${target_ext}`;
                    const exists = await fsEntryFetcher.nameExistsUnderParent(
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
                if ( ! await chkperm(dest.entry, values.user.id, 'rm') ) {
                    throw APIError.create('forbidden');
                }

                // TODO: This will be LLRemove
                // TODO: what to do with parent_operation?
                overwritten = await dest.getSafeEntry();
                const hl_remove = new HLRemove();
                await hl_remove.run({
                    target: dest,
                    user: values.user,
                    recursive: true,
                });
            }
        }

        this.copied = await fs.copy_2({
            source,
            parent,
            user: values.user,
            target_name,
        })

        await this.copied.awaitStableEntry();
        const response = await this.copied.getSafeEntry({ thumbnail: true });
        return {
            copied : response,
            overwritten
        };
    }
}

module.exports = {
    HLCopy,
};
