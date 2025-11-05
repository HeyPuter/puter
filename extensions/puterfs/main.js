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

class PuterFSProvider {
    async unlink ({ context, node, options = {} }) {
        if ( await node.get('type') === TYPE_DIRECTORY ) {
            throw new APIError(409, 'Cannot unlink a directory.');
        }

        await this.#rmnode({ context, node, options });
    }

    async #rmnode ({ node, options }) {
        console.log('USING THE NEW IMPLEMENTATION');
        // Services
        if ( ! options.override_immutable && await node.get('immutable') ) {
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
