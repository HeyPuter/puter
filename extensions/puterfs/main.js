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

const svc_metering = extension.import('service:meteringService');
const svc_trace = extension.import('service:traceService');

// TODO: these services ought to be part of this extension
const svc_size = extension.import('service:sizeService');
const svc_fsEntry = extension.import('service:fsEntryService');
const svc_fsEntryFetcher = extension.import('service:fsEntryFetcher');

// TODO: depending on mountpoint service will not be necessary
//       once the storage provider is moved to this extension
const svc_mountpoint = extension.import('service:mountpoint');

const {
    APIError,
    Actor,
    Context,
    UserActorType,
} = extension.import('core');

const {
    get_user,
} = extension.import('core').util.helpers;

const {
    ParallelTasks,
} = extension.import('core').util.otelutil;

const {
    TYPE_DIRECTORY,
} = extension.import('core').fs;

const {
    NodeChildSelector,
    NodeUIDSelector,
    NodeInternalIDSelector,

} = extension.import('core').fs.selectors;

class PuterFSProvider {
    /**
     * Check if a given node exists.
     *
     * @param {Object} param
     * @param {NodeSelector} param.selector - The selector used for checking.
     * @returns {Promise<boolean>} - True if the node exists, false otherwise.
     */
    async quick_check ({
        selector,
    }) {
        // shortcut: has full path
        if ( selector?.path ) {
            const entry = await svc_fsEntryFetcher.findByPath(selector.path);
            return Boolean(entry);
        }

        // shortcut: has uid
        if ( selector?.uid ) {
            const entry = await svc_fsEntryFetcher.findByUID(selector.uid);
            return Boolean(entry);
        }

        // shortcut: parent uid + child name
        if ( selector instanceof NodeChildSelector && selector.parent instanceof NodeUIDSelector ) {
            return await svc_fsEntryFetcher.nameExistsUnderParent(selector.parent.uid,
                            selector.name);
        }

        // shortcut: parent id + child name
        if ( selector instanceof NodeChildSelector && selector.parent instanceof NodeInternalIDSelector ) {
            return await svc_fsEntryFetcher.nameExistsUnderParentID(selector.parent.id,
                            selector.name);
        }

        return false;
    }

    async unlink ({ context, node, options = {} }) {
        if ( await node.get('type') === TYPE_DIRECTORY ) {
            throw new APIError(409, 'Cannot unlink a directory.');
        }

        await this.#rmnode({ context, node, options });
    }

    async rmdir ({ context, node, options = {} }) {
        if ( await node.get('type') !== TYPE_DIRECTORY ) {
            throw new APIError(409, 'Cannot rmdir a file.');
        }

        if ( await node.get('immutable') ) {
            throw APIError.create('immutable');
        }

        const children = await svc_fsEntry.fast_get_direct_descendants(await node.get('uid'));

        if ( children.length > 0 && !options.ignore_not_empty ) {
            throw APIError.create('not_empty');
        }

        await this.#rmnode({ context, node, options });
    }

    async read ({ context, node, version_id, range }) {
        const svc_mountpoint = context.get('services').get('mountpoint');
        const storage = svc_mountpoint.get_storage(this.constructor.name);
        const location = await node.get('s3:location') ?? {};
        const stream = (await storage.create_read_stream(await node.get('uid'), {
            // TODO: fs:decouple-s3
            bucket: location.bucket,
            bucket_region: location.bucket_region,
            version_id,
            key: location.key,
            memory_file: node.entry,
            ...(range ? { range } : {}),
        }));
        return stream;
    }

    async #rmnode ({ node, options }) {
        // Services
        if ( !options.override_immutable && await node.get('immutable') ) {
            throw new APIError(403, 'File is immutable.');
        }

        const userId = await node.get('user_id');
        const fileSize = await node.get('size');
        svc_size.change_usage(userId,
                        -1 * fileSize);

        const ownerActor =  new Actor({
            type: new UserActorType({
                user: await get_user({ id: userId }),
            }),
        });

        svc_metering.incrementUsage(ownerActor, 'filesystem:delete:bytes', fileSize);

        const tracer = svc_trace.tracer;
        const tasks = new ParallelTasks({ tracer, max: 4 });

        tasks.add('remove-fsentry', async () => {
            await svc_fsEntry.delete(await node.get('uid'));
        });

        if ( await node.get('has-s3') ) {
            tasks.add('remove-from-s3', async () => {
                // const storage = new PuterS3StorageStrategy({ services: svc });
                const storage = Context.get('storage');
                const state_delete = storage.create_delete();
                await state_delete.run({
                    node: node,
                });
            });
        }

        await tasks.awaitAll();
    }
}

const { TmpProxyFSProvider } = extension.import('fs');

extension.on('create.filesystem-types', event => {
    event.createFilesystemType('puterfs', {
        mount ({ path }) {
            return new TmpProxyFSProvider(path, new PuterFSProvider(path));
        },
    });
});
