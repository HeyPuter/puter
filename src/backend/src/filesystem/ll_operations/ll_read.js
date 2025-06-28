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
const { Sequence } = require("../../codex/Sequence");

const { DB_WRITE } = require("../../services/database/consts");
const { buffer_to_stream } = require("../../util/streamutil");
const { TYPE_SYMLINK, TYPE_DIRECTORY } = require("../FSNodeContext");
const { LLFilesystemOperation } = require("./definitions");

const dry_checks = [
        async function check_ACL_for_read (a) {
            if ( a.get('no_acl') ) return;
            const context = a.iget('context');
            const svc_acl = context.get('services').get('acl');
            const { fsNode, actor } = a.values();
            if ( ! await svc_acl.check(actor, fsNode, 'read') ) {
                throw await svc_acl.get_safe_acl_error(actor, fsNode, 'read');
            }
        },
        async function type_check_for_read (a) {
            const fsNode = a.get('fsNode');
            if ( await fsNode.get('type') === TYPE_DIRECTORY ) {
                throw APIError.create('cannot_read_a_directory');
            }
        },
];

class LLRead extends LLFilesystemOperation {
    static CONCERN = 'filesystem';
    static METHODS = {
        _run: new Sequence({
            async before_each (a, step) {
                const operation = a.iget();
                operation.checkpoint('step:' + step.name);
            }
        }, [
            async function check_that_node_exists (a) {
                if ( ! await a.get('fsNode').exists() ) {
                    throw APIError.create('subject_does_not_exist');
                }
            },
            ...dry_checks,
            async function resolve_symlink (a) {
                let fsNode = a.get('fsNode');
                let type = await fsNode.get('type');
                while ( type === TYPE_SYMLINK ) {
                    fsNode = await fsNode.getTarget();
                    type = await fsNode.get('type');
                }
                a.set('fsNode', fsNode);
            },
            ...dry_checks,
            async function calculate_has_range (a) {
                const { offset, length } = a.values();
                const fsNode = a.get('fsNode');
                const has_range = (
                    offset !== undefined &&
                    offset !== 0
                ) || (
                    length !== undefined &&
                    length != await fsNode.get('size')
                );
                a.set('has_range', has_range);
            },
            async function update_accessed (a) {
                const context = a.iget('context');
                const db = context.get('services')
                    .get('database').get(DB_WRITE, 'filesystem');

                const fsNode = a.get('fsNode');

                await db.write(
                    'UPDATE `fsentries` SET `accessed` = ? WHERE `id` = ?',
                    [Date.now()/1000, fsNode.mysql_id]
                );
            },
            async function check_for_cached_copy (a) {
                const context = a.iget('context');
                const svc_fileCache = context.get('services').get('file-cache');

                const { fsNode, offset, length } = a.values();

                const maybe_buffer = await svc_fileCache.try_get(fsNode, a.log);
                if ( maybe_buffer ) {
                    a.log.cache(true, 'll_read');
                    const { has_range } = a.values();
                    if ( has_range ) {
                        return a.stop(
                            buffer_to_stream(maybe_buffer.slice(offset, offset+length))
                        );
                    }
                    return a.stop(
                        buffer_to_stream(maybe_buffer)
                    );
                }

                a.log.cache(false, 'll_read');
            },
            async function create_S3_read_stream (a) {
                const context = a.iget('context');
                const storage = context.get('storage');

                const { fsNode, version_id, offset, length, has_range } = a.values();

                // Empty object here is in the case of local fiesystem,
                // where s3:location will return null.
                // TODO: storage interface shouldn't have S3-specific properties.
                const location = await fsNode.get('s3:location') ?? {};

                const stream = (await storage.create_read_stream(await fsNode.get('uid'), {
                    // TODO: fs:decouple-s3
                    bucket: location.bucket,
                    bucket_region: location.bucket_region,
                    version_id,
                    key: location.key,
                    ...(has_range ? {
                        range: `bytes=${offset}-${offset+length-1}`
                    } : {}),
                }));

                a.set('stream', stream);
            },
            async function store_in_cache (a) {
                const context = a.iget('context');
                const svc_fileCache = context.get('services').get('file-cache');

                const { fsNode, stream, has_range } = a.values();

                if ( ! has_range ) {
                    const res = await svc_fileCache.maybe_store(fsNode, stream);
                    if ( res.stream ) a.set('stream', res.stream);
                }
            },
            async function return_stream (a) {
                return a.get('stream');
            },
        ]),
    };
}

module.exports = {
    LLRead
};
