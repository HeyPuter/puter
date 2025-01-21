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
const APIError = require('../../../api/APIError.js');
const { relativeSelector } = require('../../../filesystem/node/selectors.js');
const ERR_INVALID_PATHREF = 'Invalid path reference in path: ';
const ERR_UNKNOWN_PATHREF = 'Unknown path reference in path: ';

/**
 * Resolves path references in batch requests.
 *
 * A path reference is a path that starts with a dollar sign ($).
 * It will resolve to the path that was returned by the operation
 * with the same name in its `as` field.
 *
 * For example, if the operation `mkdir` has an `as` field with the
 * value `newdir`, then the path `$newdir` will resolve to the path
 * that was returned by the `mkdir` operation.
 */
module.exports = class PathResolver {
    constructor ({ actor }) {
        this.references = {};
        this.selectors = {};
        this.meta = {};
        this.actor = actor;

        this.listeners = {};

        this.log = globalThis.services.get('log-service').create('path-resolver');
    }

    /**
     * putPath - Add a path reference.
     *
     * The path reference will be resolved to the given path.
     *
     * @param {string} refName - The name of the path reference.
     * @param {string} path - The path to resolve to.
     */
    putPath (refName, path) {
        this.references[refName] = { path };
    }

    putSelector (refName, selector, meta) {
        this.log.debug(`putSelector called for: ${refName}`)
        this.selectors[refName] = selector;
        this.meta[refName] = meta;
        if ( ! this.listeners.hasOwnProperty(refName) ) return;

        for ( const lis of this.listeners[refName] ) lis();
    }

    /**
     * resolve - Resolve a path reference.
     *
     * If the given path does not start with a dollar sign ($),
     * it will be returned as-is. Otherwise, the path reference
     * will be resolved to the path that was given to `putPath`.
     *
     * @param {string} inputPath
     * @returns {string} The resolved path.
     */

    resolve (inputPath) {
        const refName = this.getReferenceUsed(inputPath);
        if ( refName === null ) return inputPath;
        if ( ! this.references.hasOwnProperty(refName) ) {
            throw APIError.create(400, ERR_UNKNOWN_PATHREF + refName);
        }

        return this.references[refName].path +
            inputPath.substring(refName.length + 1);
    }

    async awaitSelector (inputPath) {
        // TODO: I feel like there's a better way to get username
        const username = this.actor.type.user.username;
        if ( inputPath.startsWith('~/') ) {
            return `/${username}/${inputPath.substring(2)}`;
        }
        if ( inputPath === '~' ) {
            return `/${username}`;
        }
        const refName = this.getReferenceUsed(inputPath);
        if ( refName === null ) return inputPath;

        this.log.debug(`-- awaitSelector -- input path is ${inputPath}`);
        this.log.debug(`-- awaitSelector -- refName is ${refName}`);
        if ( ! this.selectors.hasOwnProperty(refName) ) {
            this.log.debug(`-- awaitSelector -- doing the await`);
            if ( ! this.listeners[refName] ) {
                this.listeners[refName] = [];
            }
            await new Promise (rslv => {
                this.listeners[refName].push(rslv);
            });
        }

        const subpath = inputPath.substring(refName.length + 1);
        const selector =  this.selectors[refName];

        return relativeSelector(selector, subpath);
    }

    getMeta (inputPath) {
        const refName = this.getReferenceUsed(inputPath);
        if ( refName === null ) return null;

        return this.meta[refName];
    }

    getReferenceUsed (inputPath) {
        if ( ! inputPath.startsWith('$') ) return null;

        const endOfRefName = inputPath.includes('/')
            ? inputPath.indexOf('/', 1) : inputPath.length;
        const refName = inputPath.substring(1, endOfRefName);

        if ( refName === '' ) {
            throw APIError.create(400, ERR_INVALID_PATHREF + inputPath);
        }

        return refName;
    }
}
