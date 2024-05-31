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
let waiti = 0;
const {
    NodePathSelector,
    NodeUIDSelector,
    NodeInternalIDSelector,
    NodeChildSelector,
} = require("../node/selectors");

const RESOURCE_STATUS_PENDING_CREATE = {};
const RESOURCE_STATUS_PENDING_UPDATE = {};
const RS_DIRECTORY_PENDING_CHILD_INSERT = {};

/**
 * ResourceService is a very simple locking mechanism meant
 * only to ensure consistency between requests being sent
 * to the same server.
 *
 * For example, if you send an HTTP request to `/write`, and
 * then a subsequent HTTP request to `/read`, you would expect
 * the newly written file to be available. Therefore, the call
 * to `/read` should wait until the write is complete.
 *
 * At least for now; I'm sure we'll think of a smarter way to
 * handle this in the future.
 */
class ResourceService {
    constructor ({ services }) {
        this.uidToEntry = {};
        this.uidToPath = {};
        this.pathToEntry = {};

        this.log = services.get('log-service').create('resource-service');
    }

    register (entry) {
        entry = { ...entry };

        if ( ! entry.uid ) {
            // TODO: resource service needs logger access
            return;
        }

        entry.freePromise = new Promise((resolve, reject) => {
            entry.free = () => {
                resolve();
            };
        });
        entry.onFree = entry.freePromise.then.bind(entry.freePromise);
        this.log.info(`registering resource`, { uid: entry.uid });
        this.uidToEntry[entry.uid] = entry;
        if ( entry.path ) {
            this.uidToPath[entry.uid] = entry.path;
            this.pathToEntry[entry.path] = entry;
        }
        return entry;
    }

    free (uid) {
        this.log.info(`freeing`, { uid });
        const entry = this.uidToEntry[uid];
        if ( ! entry ) return;
        delete this.uidToEntry[uid];
        if ( this.uidToPath.hasOwnProperty(uid) ) {
            const path = this.uidToPath[uid];
            delete this.pathToEntry[path];
            delete this.uidToPath[uid];
        }
        entry.free();
    }

    async waitForResourceByPath (path) {
        const entry = this.pathToEntry[path];
        if (!entry) {
            return;
        }
        await entry.freePromise;
    }

    async waitForResourceByUID (uid) {
        const entry = this.uidToEntry[uid];
        if (!entry) {
            return;
        }
        await entry.freePromise;
    }

    async waitForResource (selector) {
        const i = waiti++;
        if ( selector instanceof NodePathSelector ) {
            await this.waitForResourceByPath(selector.value);
        }
        else
        if ( selector instanceof NodeUIDSelector ) {
            await this.waitForResourceByUID(selector.value);
        }
        else
        if ( selector instanceof NodeInternalIDSelector ) {
            // Can't wait intelligently for this
        }
        if ( selector instanceof NodeChildSelector ) {
            await this.waitForResource(selector.parent);
        }
    }

    getResourceInfo (uid) {
        if ( ! uid ) return;
        return this.uidToEntry[uid];
    }
}

module.exports = {
    ResourceService,
    RESOURCE_STATUS_PENDING_CREATE,
    RESOURCE_STATUS_PENDING_UPDATE,
    RS_DIRECTORY_PENDING_CHILD_INSERT,
};
