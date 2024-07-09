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
const { AdvancedBase } = require("@heyputer/puter-js-common");

/**
 * PathBuilder implements the builder pattern for building paths.
 * This makes it clear which path fragments are allowed to traverse
 * to parent directories.
 */
class PathBuilder extends AdvancedBase {
    static MODULES = {
        path: require('path'),
    }

    constructor() {
        super();
        this.path_ = '';
    }

    static create () {
        return new PathBuilder();
    }

    static add (fragment, options) {
        return PathBuilder.create().add(fragment, options);
    }

    static resolve (fragment) {
        const p = PathBuilder.create();
        const require = p.require;
        const node_path = require('path');
        fragment = node_path.resolve(fragment);
        return p.add(fragment).build();
    }
    
    add (fragment, options) {
        const require = this.require;
        const node_path = require('path');

        options = options || {};
        if ( ! options.allow_traversal ) {
            fragment = node_path.normalize(fragment);
            fragment = fragment.replace(/(\.+\/|\.+\\)/g, '');
            if ( fragment === '..' ) {
                fragment = '';
            }
        }

        this.path_ = this.path_
            ? node_path.join(this.path_, fragment)
            : fragment;

        return this;
    }

    build () {
        return this.path_;
    }
}

module.exports = {
    PathBuilder,
};
