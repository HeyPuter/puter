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
const APIError = require('../../api/APIError');
const { get_user } = require('../../helpers');
const { MemoryFSProvider } = require('../../modules/puterfs/customfs/MemoryFSProvider');
const { UserActorType } = require('../../services/auth/Actor');
const { Actor } = require('../../services/auth/Actor');
const { DB_WRITE } = require('../../services/database/consts');
const { Context } = require('../../util/context');
const { buffer_to_stream } = require('../../util/streamutil');
const { TYPE_SYMLINK, TYPE_DIRECTORY } = require('../FSNodeContext');
const { LLFilesystemOperation } = require('./definitions');

const checkACLForRead = async (aclService, actor, fsNode) => {
    if ( !await aclService.check(actor, fsNode, 'read') ) {
        throw await aclService.get_safe_acl_error(actor, fsNode, 'read');
    }
};
const typeCheckForRead = async (fsNode) => {
    if ( await fsNode.get('type') === TYPE_DIRECTORY ) {
        throw APIError.create('cannot_read_a_directory');
    }
};

class LLRead extends LLFilesystemOperation {
    static CONCERN = 'filesystem';
    async _run({ fsNode, no_acl, actor, offset, length, range, version_id } = {}){
        // extract services from context
        const aclService = Context.get('services').get('acl');
        const db = Context.get('services')
            .get('database').get(DB_WRITE, 'filesystem');
        const fileCacheService = Context.get('services').get('file-cache');

        // validate input
        if ( !await fsNode.exists() ){
            throw APIError.create('subject_does_not_exist');
        }
        if ( no_acl ) return;

        // validate initial node
        await checkACLForRead(aclService, actor, fsNode);
        await typeCheckForRead(fsNode);
        let type = await fsNode.get('type');
        while ( type === TYPE_SYMLINK ) {
            fsNode = await fsNode.getTarget();
            type = await fsNode.get('type');
        }

        // validate symlink leaf node
        await checkACLForRead(aclService, actor, fsNode);
        await typeCheckForRead(fsNode);

        // calculate range inputs
        const has_range = (
            offset !== undefined &&
            offset !== 0
        ) || (
            length !== undefined &&
            length != await fsNode.get('size')
        ) || range !== undefined;

        // timestamp access
        await db.write('UPDATE `fsentries` SET `accessed` = ? WHERE `id` = ?',
                        [Date.now() / 1000, fsNode.mysql_id]);

        const ownerId = await fsNode.get('user_id');
        const ownerActor =  new Actor({
            type: new UserActorType({
                user: await get_user({ id: ownerId }),
            }),
        });

        //define metering service

        /** @type {import("../../services/MeteringService/MeteringService").MeteringAndBillingService} */
        const meteringService = Context.get('services').get('meteringService').meteringAndBillingService;
        // check file cache
        const maybe_buffer = await fileCacheService.try_get(fsNode); // TODO DS: do we need those cache hit logs?
        if ( maybe_buffer ) {
            // Meter cached egress
            // return cached stream
            if ( has_range && (length || offset) ) {
                meteringService.incrementUsage(ownerActor, 'filesystem:cached-egress:bytes', length);
                return buffer_to_stream(maybe_buffer.slice(offset, offset + length));
            }
            meteringService.incrementUsage(ownerActor, 'filesystem:cached-egress:bytes', await fsNode.get('size'));
            return buffer_to_stream(maybe_buffer);
        }

        // if no cache attempt reading from storageProvider (s3)
        const svc_mountpoint = Context.get('services').get('mountpoint');
        const provider = await svc_mountpoint.get_provider(fsNode.selector);
        const storage = svc_mountpoint.get_storage(provider.constructor.name);

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
            memory_file: fsNode.entry,
            ...(range ? { range } : (has_range ? {
                range: `bytes=${offset}-${offset + length - 1}`,
            } : {})),
        }));

        // Meter ingress
        const size = await (async () => {
            if ( range ){
                const match = range.match(/bytes=(\d+)-(\d+)/);
                if ( match ) {
                    const start = parseInt(match[1], 10);
                    const end = parseInt(match[2], 10);
                    return end - start + 1;
                }
            }
            if ( has_range ) {
                return length;
            }
            return await fsNode.get('size');
        })();
        meteringService.incrementUsage(ownerActor, 'filesystem:egress:bytes', size);

        // cache if whole file read
        if ( !has_range ) {
            // only cache for non-memoryfs providers
            if ( ! (fsNode.provider instanceof MemoryFSProvider) ) {
                const res = await fileCacheService.maybe_store(fsNode, stream);
                if ( res.stream ) {
                    // return with split cached stream
                    return res.stream;
                }
            }
        }
        return stream;
    }
}

module.exports = {
    LLRead,
};
