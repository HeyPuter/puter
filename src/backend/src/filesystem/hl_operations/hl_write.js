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
const FSNodeParam = require("../../api/filesystem/FSNodeParam");
const FlagParam = require("../../api/filesystem/FlagParam");
const StringParam = require("../../api/filesystem/StringParam");
const UserParam = require("../../api/filesystem/UserParam");
const config = require("../../config");
const { chkperm, validate_fsentry_name } = require("../../helpers");
const { TeePromise } = require("@heyputer/putility").libs.promise;
const { pausing_tee, logging_stream, offset_write_stream, stream_to_the_void } = require("../../util/streamutil");
const { TYPE_DIRECTORY } = require("../FSNodeContext");
const { LLRead } = require("../ll_operations/ll_read");
const { RootNodeSelector, NodePathSelector } = require("../node/selectors");
const { is_valid_node_name } = require("../validation");
const { HLFilesystemOperation } = require("./definitions");
const { MkTree } = require("./hl_mkdir");
const { Actor } = require("../../services/auth/Actor");
const { LLCWrite, LLOWrite } = require("../ll_operations/ll_write");

class WriteCommonFeature {
    install_in_instance (instance) {
        instance._verify_size = async function () {
            if (
                this.values.file &&
                this.values.file.size > config.max_file_size
            ) {
                throw APIError.create('file_too_large', null, {
                    max_size: config.max_file_size,
                })
            }

            if (
                this.values.thumbnail &&
                this.values.thumbnail.size > config.max_thumbnail_size
            ) {
                throw APIError.create('thumbnail_too_large', null, {
                    max_size: config.max_thumbnail_size,
                })
            }
        }

        instance._verify_room = async function () {
            if ( ! this.values.file ) return;

            const sizeService = this.context.get('services').get('sizeService');
            const { file, user: user_let } = this.values;
            let user = user_let;

            if ( ! user ) user = this.values.actor.type.user;

            const usage = await sizeService.get_usage(user.id);
            const capacity = await sizeService.get_storage_capacity(user.id);
            if( capacity - usage - file.size < 0 ) {
                throw APIError.create('storage_limit_reached');
            }
        }
    }
}

class HLWrite extends HLFilesystemOperation {
    static DESCRIPTION = `
        High-level write operation.

        This operation is a wrapper around the low-level write operation.
        It provides the following features:
        - create missing parent directories
        - overwrite existing files
        - deduplicate files with the same name
        // - create thumbnails; this will happen in low-level operation for now
        - create shortcuts
    `

    static FEATURES = [
        new WriteCommonFeature(),
    ]

    static PARAMETERS = {
        // the parent directory, or a filepath that doesn't exist yet
        destination_or_parent: new FSNodeParam('path'),

        // if specified, destination_or_parent must be a directory
        specified_name: new StringParam('specified_name', { optional: true }),

        // used if specified_name is undefined and destination_or_parent is a directory
        // NB: if destination_or_parent does not exist and create_missing_parents
        //     is true then destination_or_parent will be a directory
        fallback_name: new StringParam('fallback_name', { optional: true }),

        overwrite: new FlagParam('overwrite', { optional: true }),
        dedupe_name: new FlagParam('dedupe_name', { optional: true }),

        // other options
        shortcut_to: new FSNodeParam('shortcut_to', { optional: true }),
        create_missing_parents: new FlagParam('create_missing_parents', { optional: true }),
        user: new UserParam(),

        // file: multer.File
    };

    static MODULES = {
        _path: require('path'),
        mime: require('mime-types'),
    }

    async _run () {
        const { context, values } = this;
        const { _path } = this.modules;

        const fs = context.get('services').get('filesystem');
        const svc_event = context.get('services').get('event');

        let parent = values.destination_or_parent;
        let destination = null;

        await this._verify_size();
        await this._verify_room();

        this.checkpoint('before parent exists check');

        if ( ! await parent.exists() && values.create_missing_parents ) {
            if ( ! (parent.selector instanceof NodePathSelector) ) {
                throw APIError.create('dest_does_not_exist', null, {
                    parent: parent.selector,
                });
            }
            const path = parent.selector.value;
            this.log.noticeme('EXPECTED PATH', { path });
            const tree_op = new MkTree();
            await tree_op.run({
                parent: await fs.node(new RootNodeSelector()),
                tree: [path],
            });

            parent = await fs.node(new NodePathSelector(path));
            const parent_exists_now = await parent.exists();
            if ( ! parent_exists_now ) {
                this.log.error('FAILED TO CREATE DESTINATION');
                throw APIError.create('dest_does_not_exist', null, {
                    parent: parent.selector,
                });
            }
        }

        if ( parent.isRoot ) {
            throw APIError.create('cannot_write_to_root');
        }

        let target_name = values.specified_name || values.fallback_name;

        // If a name is specified then the destination must be a directory
        if ( values.specified_name ) {
            this.checkpoint('specified name condition');
            if ( ! await parent.exists() ) {
                throw APIError.create('dest_does_not_exist');
            }
            if ( await parent.get('type') !== TYPE_DIRECTORY ) {
                throw APIError.create('dest_is_not_a_directory');
            }
            target_name = values.specified_name;
        }

        this.checkpoint('check parent DNE or is not a directory');
        if (
            ! await parent.exists() ||
            await parent.get('type') !== TYPE_DIRECTORY
        ) {
            destination = parent;
            parent = await destination.getParent();
            target_name = destination.name;
        }

        if ( parent.isRoot ) {
            throw APIError.create('cannot_write_to_root');
        }

        try {
            // old validator is kept here to avoid changing the
            // error messages; eventually is_valid_node_name
            // will support more detailed error reporting
            validate_fsentry_name(target_name);
            if ( ! is_valid_node_name(target_name) ) {
                throw { message: 'invalid node name' };
            }
        } catch (e) {
            throw APIError.create('invalid_file_name', null, {
                name: target_name,
                reason: e.message,
            });
        }

        if ( ! destination ) {
            destination = await parent.getChild(target_name);
        }

        let is_overwrite = false;

        // TODO: Gotta come up with a reasonable guideline for if/when we put
        //       object members in the scope; it feels too arbitrary right now.
        const { overwrite, dedupe_name } = values;

        this.checkpoint('before overwrite behaviours');

        const dest_exists = await destination.exists();

        if ( values.offset !== undefined && ! dest_exists ) {
            throw APIError.create('offset_without_existing_file');
        }
        
        // The correct ACL check here depends on context.
        // ll_write checks ACL, but we need to shortcut it here
        // or else we might send the user too much information.
        {
            const node_to_check =
                ( dest_exists && overwrite && ! dedupe_name )
                    ? destination : parent;

            const actor = values.actor ?? Actor.adapt(values.user);
            const svc_acl = context.get('services').get('acl');
            if ( ! await svc_acl.check(actor, node_to_check, 'write') ) {
                throw await svc_acl.get_safe_acl_error(actor, node_to_check, 'write');
            }
        }

        if ( dest_exists ) {
            console.log('DESTINATION EXISTS', dedupe_name)
            if ( ! overwrite && ! dedupe_name ) {
                throw APIError.create('item_with_same_name_exists', null, {
                    entry_name: target_name
                });
            }

            if ( dedupe_name ) {
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

                destination = await parent.getChild(target_name);
            }

            else if ( overwrite ) {
                if ( await destination.get('immutable') ) {
                    throw APIError.create('immutable');
                }
                if ( await destination.get('type') === TYPE_DIRECTORY ) {
                    throw APIError.create('cannot_overwrite_a_directory');
                }
                is_overwrite = true;
            }
        }

        if ( values.shortcut_to ) {
            this.checkpoint('shortcut condition');
            const shortcut_to = values.shortcut_to;
            if ( ! await shortcut_to.exists() ) {
                throw APIError.create('shortcut_to_does_not_exist');
            }
            if ( await shortcut_to.get('type') === TYPE_DIRECTORY ) {
                throw APIError.create('shortcut_target_is_a_directory');
            }
            // TODO: legacy check - likely not needed
            const has_perm = await chkperm(shortcut_to.entry, values.actor.type.user.id, 'read');
            if ( ! has_perm ) throw APIError.create('permission_denied');

            this.created = await fs.mkshortcut({
                parent,
                name: target_name,
                actor: values.actor,
                target: shortcut_to,
            });

            await this.created.awaitStableEntry();
            await this.created.fetchEntry({ thumbnail: true });
            return await this.created.getSafeEntry();
        }

        this.checkpoint('before thumbnail');

        let thumbnail_promise = new TeePromise();
        if ( await parent.isAppDataDirectory() || values.no_thumbnail ) {
            thumbnail_promise.resolve(undefined);
        } else (async () => {
            const reason = await (async () => {
                const { mime } = this.modules;
                const thumbnails = context.get('services').get('thumbnails');
                if ( values.thumbnail ) return 'already thumbnail';

                const content_type = mime.contentType(target_name);
                console.log('CONTENT TYPE', content_type);
                if ( ! content_type ) return 'no content type';
                if ( ! thumbnails.is_supported_mimetype(content_type) ) return 'unsupported content type';
                if ( ! thumbnails.is_supported_size(values.file.size) ) return 'too large';

                // Create file object for thumbnail by either using an existing
                // buffer (ex: /download endpoint) or by forking a stream
                // (ex: /write and /batch endpoints).
                const thumb_file = (() => {
                    if ( values.file.buffer ) return values.file;

                    const [replace_stream, thumbnail_stream] =
                        pausing_tee(values.file.stream, 2);

                    values.file.stream = replace_stream;
                    return { ...values.file, stream: thumbnail_stream };
                })();

                let thumbnail;
                try {
                    thumbnail = await thumbnails.thumbify(thumb_file);
                } catch (e) {
                    stream_to_the_void(thumb_file.stream);
                    return 'thumbnail error: ' + e.message;
                }
                
                const thumbnailData = {url: thumbnail}
                await svc_event.emit('thumbnail.created', thumbnailData); // An extension can modify where this thumbnail is stored

                thumbnail_promise.resolve(thumbnailData.url);
            })();
            if ( reason ) {
                console.log('REASON', reason);
                thumbnail_promise.resolve(undefined);

                // values.file.stream = logging_stream(values.file.stream);
            }
        })();

        this.checkpoint('before delegate');

        if ( values.offset !== undefined ) {
            if ( ! is_overwrite ) {
                throw APIError.create('offset_requires_overwrite');
            }

            if ( ! values.file.stream ) {
                throw APIError.create('offset_requires_stream');
            }

            const replace_length = values.file.size;
            let dst_size = await destination.get('size');
            if ( values.offset > dst_size ) {
                values.offset = dst_size;
            }

            if ( values.offset + values.file.size > dst_size ) {
                dst_size = values.offset + values.file.size;
            }

            const ll_read = new LLRead();
            const read_stream = await ll_read.run({
                fsNode: destination,
            });

            values.file.stream = offset_write_stream({
                originalDataStream: read_stream,
                newDataStream: values.file.stream,
                offset: values.offset,
                replace_length,
            });
            values.file.size = dst_size;
        }

        if ( is_overwrite ) {
            const ll_owrite = new LLOWrite();
            this.written = await ll_owrite.run({
                node: destination,
                actor: values.actor,
                file: values.file,
                tmp: {
                    socket_id: values.socket_id,
                    operation_id: values.operation_id,
                    item_upload_id: values.item_upload_id,
                },
                fsentry_tmp: {
                    thumbnail_promise,
                },
                message: values.message,
            });
        } else {
            const ll_cwrite = new LLCWrite();
            this.written = await ll_cwrite.run({
                parent,
                name: target_name,
                actor: values.actor,
                file: values.file,
                tmp: {
                    socket_id: values.socket_id,
                    operation_id: values.operation_id,
                    item_upload_id: values.item_upload_id,
                },
                fsentry_tmp: {
                    thumbnail_promise,
                },
                message: values.message,
                app_id: values.app_id,
            });
        }

        this.checkpoint('after delegate');

        await this.written.awaitStableEntry();
        this.checkpoint('after await stable entry');
        const response = await this.written.getSafeEntry({ thumbnail: true });
        this.checkpoint('after get safe entry');

        return response;
    }
}

module.exports = {
    HLWrite,
};
