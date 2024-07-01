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
const { Context } = require("../../util/context");
const { ParallelTasks } = require("../../util/otelutil");
const { LLFilesystemOperation } = require("./definitions");
const APIError = require("../../api/APIError");

class LLRmNode extends LLFilesystemOperation {
    async _run () {
        const { target, actor } = this.values;

        const { context } = this;

        const svc = context.get('services');

        // Access Control
        {
            const svc_acl = context.get('services').get('acl');
            this.checkpoint('remove :: access control');

            // Check write access to target
            if ( ! await svc_acl.check(actor, target, 'write') ) {
                throw await svc_acl.get_safe_acl_error(actor, target, 'write');
            }
        }

        if ( await target.get('immutable') ) {
            throw new APIError(403, 'File is immutable.');
        }

        const svc_size = svc.get('sizeService');
        const svc_fsEntry = svc.get('fsEntryService');

        svc_size.change_usage(
            await target.get('user_id'),
            -1 * await target.get('size')
        );

        const tracer = svc.get('traceService').tracer;
        const tasks = new ParallelTasks({ tracer, max: 4 });

        tasks.add(`remove-fsentry`, async () => {
            await svc_fsEntry.delete(await target.get('uid'));
        });

        if ( await target.get('has-s3') ) {
            tasks.add(`remove-from-s3`, async () => {
                // const storage = new PuterS3StorageStrategy({ services: svc });
                const storage = Context.get('storage');
                const state_delete = storage.create_delete();
                await state_delete.run({
                    node: target,
                });
            });
        }

        await tasks.awaitAll();
    }
}

module.exports = {
    LLRmNode,
};
