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
const { chkperm } = require('../../helpers');

const { RootNodeSelector, NodeChildSelector, NodePathSelector } = require('../node/selectors');
const APIError = require('../../api/APIError');

const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const StringParam = require('../../api/filesystem/StringParam');
const FlagParam = require('../../api/filesystem/FlagParam');
const UserParam = require('../../api/filesystem/UserParam');
const FSNodeContext = require('../FSNodeContext');
const { OtelFeature } = require('../../traits/OtelFeature');
const { HLFilesystemOperation } = require('./definitions');
const { is_valid_path } = require('../validation');
const { HLRemove } = require('./hl_remove');
const { LLMkdir } = require('../ll_operations/ll_mkdir');

class MkTree extends HLFilesystemOperation {
    static DESCRIPTION = `
        High-level operation for making directory trees

        The following input for 'tree':
        ['a/b/c', ['i/j/k'], ['p', ['q'], ['r/s']]]]

        Would create a directory tree like this:
        a
        └── b
            └── c
                ├── i
                │   └── j
                │       └── k
                └── p
                    ├── q
                    └── r
                        └── s
    `;

    static PARAMETERS = {
        parent: new FSNodeParam('parent', { optional: true }),
    };

    static PROPERTIES = {
        leaves: () => [],
        directories_created: () => [],
    };

    async _run () {
        const { values, context } = this;
        const fs = context.get('services').get('filesystem');

        await this.create_branch_({
            parent_node: values.parent || await fs.node(new RootNodeSelector()),
            tree: values.tree,
            parent_exists: true,
        });
    }

    async create_branch_ ({ parent_node, tree, parent_exists }) {
        const { context } = this;
        const fs = context.get('services').get('filesystem');
        const actor = context.get('actor');

        const trunk = tree[0];
        const branches = tree.slice(1);

        let current = parent_node.selector;

        // trunk = a/b/c

        const dirs = trunk === '.' ? []
            : trunk.split('/').filter(Boolean);

        // dirs = [a, b, c]

        let parent_did_exist = parent_exists;

        // This is just a loop that goes through each part of the path
        // until it finds the first directory that doesn't exist yet.
        let i = 0;
        if ( parent_exists ) {
            for ( ; i < dirs.length ; i++ ) {
                const dir = dirs[i];
                const currentParent = current;
                current = new NodeChildSelector(current, dir);

                const maybe_dir = await fs.node(current);

                if ( maybe_dir.isRoot ) continue;
                if ( await maybe_dir.isUserDirectory() ) continue;

                if ( await maybe_dir.exists() ) {

                    if ( await maybe_dir.get('type') !== FSNodeContext.TYPE_DIRECTORY ) {
                        throw APIError.create('dest_is_not_a_directory');
                    }

                    continue;
                }

                current = currentParent;
                parent_exists = false;
                break;
            }
        }

        if ( parent_did_exist && !parent_exists ) {
            const node = await fs.node(current);
            const has_perm = await chkperm(await node.get('entry'), actor.type.user.id, 'write');
            if ( ! has_perm ) throw APIError.create('permission_denied');
        }

        // This next loop creates the new directories

        // We break into a second loop because we know none of these directories
        // exist yet. If we continued those checks each child operation would
        // wait for the previous one to complete because FSNodeContext::fetchEntry
        // will notice ResourceService has a lock on the previous operation
        // we started.

        // In this way it goes nyyyoooom because all the database inserts
        // happen concurrently (and probably end up in the same batch).

        for ( ; i < dirs.length ; i++ ) {
            const dir = dirs[i];
            const currentParent = current;
            current = new NodeChildSelector(current, dir);

            const ll_mkdir = new LLMkdir();
            const node = await ll_mkdir.run({
                parent: await fs.node(currentParent),
                name: current.name,
                actor,
            });

            current = node.selector;

            this.directories_created.push(node);
        }

        const bottom_parent = await fs.node(current);

        if ( branches.length === 0 ) {
            this.leaves.push(bottom_parent);
        }

        for ( const branch of branches ) {
            await this.create_branch_({
                parent_node: bottom_parent,
                tree: branch,
                parent_exists,
            });
        }
    }
}

class QuickMkdir extends HLFilesystemOperation {
    async _run () {
        const { context, values } = this;
        let { parent, path } = values;
        const { _path } = this.modules;
        const fs = context.get('services').get('filesystem');
        const actor = context.get('actor');

        parent = parent || await fs.node(new RootNodeSelector());

        let current = parent.selector;

        const dirs = path === '.' ? []
            : path.split('/').filter(Boolean);

        const api = require('@opentelemetry/api');
        const currentSpan = api.trace.getSpan(api.context.active());
        if ( currentSpan ) {
            currentSpan.setAttribute('path', path);
            currentSpan.setAttribute('dirs', dirs.join('/'));
            currentSpan.setAttribute('parent', parent.selector.describe());
        }

        for ( let i = 0 ; i < dirs.length ; i++ ) {
            const dir = dirs[i];
            const currentParent = current;
            current = new NodeChildSelector(current, dir);

            const ll_mkdir = new LLMkdir();
            const node = await ll_mkdir.run({
                parent: await fs.node(currentParent),
                name: current.name,
                actor,
            });

            current = node.selector;

            // this.directories_created.push(node);
        }

        this.created = await fs.node(current);
    }
}

class HLMkdir extends HLFilesystemOperation {
    static DESCRIPTION = `
        High-level mkdir operation.

        This operation is a wrapper around the low-level mkdir operation.
        It provides the following features:
        - create missing parent directories
        - overwrite existing files
        - dedupe names
        - create shortcuts
    `;

    static PARAMETERS = {
        parent: new FSNodeParam('parent', { optional: true }),
        path: new StringParam('path'),
        overwrite: new FlagParam('overwrite', { optional: true }),
        create_missing_parents: new FlagParam('create_missing_parents', { optional: true }),
        user: new UserParam(),

        shortcut_to: new FSNodeParam('shortcut_to', { optional: true }),
    };

    static MODULES = {
        _path: require('path'),
    };

    static PROPERTIES = {
        parent_directories_created: () => [],
    };

    static FEATURES = [
        new OtelFeature([
            '_get_existing_parent',
            '_create_parents',
        ]),
    ];

    async _run () {
        const { context, values } = this;
        const { _path } = this.modules;
        const fs = context.get('services').get('filesystem');

        if ( ! is_valid_path(values.path, {
            no_relative_components: true,
            allow_path_fragment: true,
        }) ) {
            throw APIError.create('field_invalid', null, {
                key: 'path',
                expected: 'valid path',
                got: 'invalid path',
            });
        }

        // Unify the following formats:
        // - full path: {"path":"/foo/bar", args...}, used by apitest (./tools/api-tester/apitest.js)
        // - parent + path: {"parent": "/foo", "path":"bar", args...}, used by puter-js (puter.fs.mkdir("/foo/bar"))
        if ( !values.parent && values.path ) {
            values.parent = await fs.node(new NodePathSelector(_path.dirname(values.path)));
            values.path = _path.basename(values.path);
        }

        let parent_node = values.parent || await fs.node(new RootNodeSelector());

        let target_basename = _path.basename(values.path);

        // "top_parent" is the immediate parent of the target directory
        // (e.g: /home/foo/bar -> /home/foo)
        const top_parent = values.create_missing_parents
            ? await this._create_dir(parent_node)
            : await this._get_existing_top_parent({ top_parent: parent_node })
            ;

        // TODO: this can be removed upon completion of: https://github.com/HeyPuter/puter/issues/1352
        if ( top_parent.isRoot ) {
            // root directory is read-only
            throw APIError.create('forbidden', null, {
                message: 'Cannot create directories in the root directory.',
            });
        }

        // `parent_node` becomes the parent of the last directory name
        // specified under `path`.
        parent_node = await this._create_parents({
            parent_node: top_parent,
            actor: values.actor,
        });

        const user_id = values.actor.type.user.id;

        const has_perm = await chkperm(await parent_node.get('entry'), user_id, 'write');
        if ( ! has_perm ) throw APIError.create('permission_denied');

        const existing = await fs.node(new NodeChildSelector(parent_node.selector, target_basename));

        await existing.fetchEntry();

        if ( existing.found ) {
            const { overwrite, dedupe_name, create_missing_parents } = values;
            if ( overwrite ) {
                // TODO: tag rm operation somehow
                const has_perm = await chkperm(await existing.get('entry'), user_id, 'write');
                if ( ! has_perm ) throw APIError.create('permission_denied');
                const hl_remove = new HLRemove();
                await hl_remove.run({
                    target: existing,
                    actor: values.actor,
                    recursive: true,
                });
            }
            else if ( dedupe_name ) {
                const fs = context.get('services').get('filesystem');
                const parent_selector = parent_node.selector;
                for ( let i = 1 ;; i++ ) {
                    let try_new_name = `${target_basename} (${i})`;
                    const selector = new NodeChildSelector(parent_selector, try_new_name);
                    const exists = await parent_node.provider.quick_check({
                        selector,
                    });
                    if ( ! exists ) {
                        target_basename = try_new_name;
                        break;
                    }
                }
            }
            else if ( create_missing_parents ) {
                if ( ! existing.entry.is_dir ) {
                    throw APIError.create('dest_is_not_a_directory');
                }
                this.created = existing;
                this.used_existing = true;
                return await this.created.getSafeEntry();
            } else {
                throw APIError.create('item_with_same_name_exists', null, {
                    entry_name: target_basename,
                });
            }
        }

        if ( values.shortcut_to ) {
            const shortcut_to = values.shortcut_to;
            if ( ! await shortcut_to.exists() ) {
                throw APIError.create('shortcut_to_does_not_exist');
            }
            if ( ! shortcut_to.entry.is_dir ) {
                throw APIError.create('shortcut_target_is_a_directory');
            }
            const has_perm = await chkperm(shortcut_to.entry, user_id, 'read');
            if ( ! has_perm ) throw APIError.create('forbidden');

            this.created = await fs.mkshortcut({
                parent: parent_node,
                name: target_basename,
                actor: values.actor,
                target: shortcut_to,
            });

            await this.created.awaitStableEntry();
            return await this.created.getSafeEntry();
        }

        const ll_mkdir = new LLMkdir();
        this.created = await ll_mkdir.run({
            parent: parent_node,
            name: target_basename,
            actor: values.actor,
        });

        const all_nodes = [
            ...this.parent_directories_created,
            this.created,
        ];

        await Promise.all(all_nodes.map(node => node.awaitStableEntry()));

        const response = await this.created.getSafeEntry();
        response.parent_dirs_created = [];
        for ( const node of this.parent_directories_created ) {
            response.parent_dirs_created.push(await node.getSafeEntry());
        }
        response.requested_path = values.path;

        return response;
    }

    async _create_parents ({ parent_node }) {
        const { context, values } = this;
        const { _path } = this.modules;

        const fs = context.get('services').get('filesystem');

        // Determine the deepest existing node
        let deepest_existing = parent_node;
        let remaining_path  = _path.dirname(values.path).split('/').filter(Boolean);
        {
            const parts = remaining_path.slice();
            for ( ;; ) {
                if ( remaining_path.length === 0 ) {
                    return deepest_existing;
                }
                const component = remaining_path[0];
                const next_selector = new NodeChildSelector(deepest_existing.selector, component);
                const next_node = await fs.node(next_selector);
                if ( ! await next_node.exists() ) {
                    break;
                }
                deepest_existing = next_node;
                remaining_path.shift();
            }
        }

        const tree_op = new MkTree();
        await tree_op.run({
            parent: deepest_existing,
            tree: [remaining_path.join('/')],
        });

        this.parent_directories_created = tree_op.directories_created;

        return tree_op.leaves[0];
    }

    async _get_existing_parent ({ parent_node }) {
        const { context, values } = this;
        const { _path } = this.modules;
        const fs = context.get('services').get('filesystem');

        const target_dirname = _path.dirname(values.path);
        const dirs = target_dirname === '.' ? []
            : target_dirname.split('/').filter(Boolean);

        let current = parent_node.selector;
        for ( let i = 0 ; i < dirs.length ; i++ ) {
            current = new NodeChildSelector(current, dirs[i]);
        }

        const node = await fs.node(current);

        if ( ! await node.exists() ) {
            // console.log('HERE FROM', node.selector.describe(), parent_node.selector.describe());
            throw APIError.create('dest_does_not_exist');
        }

        if ( ! node.entry.is_dir ) {
            throw APIError.create('dest_is_not_a_directory');
        }

        return node;
    }

    /**
     * Creates a directory and all its ancestors.
     *
     * @param {FSNodeContext} dir - The directory to create.
     * @returns {Promise<FSNodeContext>} The created directory.
     */
    async _create_dir (dir) {
        if ( await dir.exists() ) {
            if ( ! dir.entry.is_dir ) {
                throw APIError.create('dest_is_not_a_directory');
            }
            return dir;
        }

        const maybe_path_selector =
            dir.get_selector_of_type(NodePathSelector);

        if ( ! maybe_path_selector ) {
            throw APIError.create('dest_does_not_exist');
        }

        const path = maybe_path_selector.value;

        const fs = this.context.get('services').get('filesystem');

        const tree_op = new MkTree();
        await tree_op.run({
            parent: await fs.node(new RootNodeSelector()),
            tree: [path],
        });

        return tree_op.leaves[0];
    }

    async _get_existing_top_parent ({ top_parent }) {
        if ( ! await top_parent.exists() ) {
            throw APIError.create('dest_does_not_exist');
        }

        if ( ! top_parent.entry.is_dir ) {
            throw APIError.create('dest_is_not_a_directory');
        }

        return top_parent;
    }
}

module.exports = {
    QuickMkdir,
    HLMkdir,
    MkTree,
};
