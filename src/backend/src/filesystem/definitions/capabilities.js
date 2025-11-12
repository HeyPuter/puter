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

const capabilityNames = [
    // PuterFS Capabilities
    'thumbnail',
    'uuid',
    'operation-trace',
    'readdir-uuid-mode',
    'update-thumbnail',

    // Standard Capabilities
    'read',
    'write',
    'symlink',
    'trash',

    // Macro Capabilities
    'copy-tree',
    'move-tree',
    'remove-tree',
    'get-recursive-size',

    // Behavior Capabilities
    'case-sensitive',

    // POSIX Capabilities
    'readdir-inode-numbers',
    'unix-perms',
];

const fsCapabilities = {};
for ( const capabilityName of capabilityNames ) {
    const key = capabilityName.toUpperCase().replace(/-/g, '_');
    fsCapabilities[key] = Symbol(capabilityName);
}

module.exports = fsCapabilities;
