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
const { ParallelTasks } = require("../../util/otelutil");
const FSNodeContext = require("../FSNodeContext");
const { NodeUIDSelector } = require("../node/selectors");
const { LLFilesystemOperation } = require("./definitions");
const { LLRmNode } = require('./ll_rmnode');

class LLRmDir extends LLFilesystemOperation {
    async _run () {
        const {
            target,
            user,
            actor,
            descendants_only,
            recursive,

            max_tasks = 8,
        } = this.values;

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

        if ( await target.get('immutable') && ! descendants_only ) {
            throw APIError.create('immutable');
        }

        const svc_fsEntry = svc.get('fsEntryService');
        const fs = svc.get('filesystem');

        const children = await svc_fsEntry.fast_get_direct_descendants(
            await target.get('uid')
        );

        if ( children.length > 0 && ! recursive ) {
            throw APIError.create('not_empty');
        }

        const tracer = svc.get('traceService').tracer;
        const tasks = new ParallelTasks({ tracer, max: max_tasks });

        for ( const child_uuid of children ) {
            tasks.add(`fs:rm:rm-child`, async () => {
                const child_node = await fs.node(
                    new NodeUIDSelector(child_uuid)
                );
                const type = await child_node.get('type');
                if ( type === FSNodeContext.TYPE_DIRECTORY ) {
                    const ll_rm = new LLRmDir();
                    await ll_rm.run({
                        target: await fs.node(
                            new NodeUIDSelector(child_uuid),
                        ),
                        user,
                        recursive: true,
                        descendants_only: false,

                        max_tasks: (v => v > 1 ? v : 1)(Math.floor(max_tasks / 2)),
                    });
                } else {
                    const ll_rm = new LLRmNode();
                    await ll_rm.run({
                        target: await fs.node(
                            new NodeUIDSelector(child_uuid),
                        ),
                        user,
                    });
                }
            });
        }

        await tasks.awaitAll();
        if ( ! descendants_only ) {
            await target.provider.rmdir({ context, node: target });
        }
    }
}

module.exports = {
    LLRmDir,
};
