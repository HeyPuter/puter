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
const { PuterPath } = require("../lib/PuterPath");
const _path = require('path');

// Redis keys:
// <env>:<service>:<class>:<type>:<property>:<id>
//
// note: <environment> is added by redisService automatically.
//
// If `<type>` is `multi`, then the format differs slightly:
// <env>:<service>:<class>:multi:<type>:<property>:<id-property>:<id>
// where `<id-property>` specifies the propery being used for the id

class SystemFSEntryService {
    constructor ({ services }) {
        this.redis = { enabled: false };
        this.DatabaseFSEntryService = services.get('fsEntryService');

        this.log = services.get('log-service').create('system-fsentry-service');

        // Register information providers
        const info = services.get('information');
        this.info = info;
        
        if ( ! this.redis.enabled ) return;
        
        // path -> uuid via redis
        info.given('fs.fsentry:path').provide('fs.fsentry:uuid')
            .addStrategy('redis', async path => {
                return await this.get_uuid_from_path(path);
            });
        // uuid -> path via redis
        info.given('fs.fsentry:uuid').provide('fs.fsentry:path')
            .addStrategy('redis', async uuid => {
                this.log.debug('getting path for: ' + uuid);
                if ( uuid === PuterPath.NULL_UUID ) return '/';
                const res =  ( await this.redis.get(`fs:fsentry:path:path:${uuid}`) ) ?? undefined;
                this.log.debug('got path: ' + res);
                return res;
            });
        // uuid -> parent_uuid via redis
        info.given('fs.fsentry:uuid').provide('fs.fsentry:children(fs.fsentry:uuid)')
            .addStrategy('redis', async uuid => {
                return await this.get_child_uuids(uuid);
            });
    }

    async insert (entry) {
        if ( this.redis.enabled ) {
            await this._link(entry.uuid, entry.parent_uid, entry.name);
        }
        return await this.DatabaseFSEntryService.insert(entry);
    }

    async update (uuid, entry) {
        // If parent_uid is set during an update, we assume that it
        // has been changed. If it hasn't, no problem: just an extra
        // cache invalidation; but the code that set it should know
        // better because it probably has the fsentry data already.
        if ( entry.hasOwnProperty('parent_uid') ) {
            await this._relocate(uuid, entry.parent_uid)
        }
        return await this.DatabaseFSEntryService.update(uuid, entry);
    }

    async delete (uuid) {
        //
    }

    async get_child_uuids (uuid) {
        let members;
        members = await this.redis.smembers(`fs:fsentry:set:childs:${uuid}`);
        if ( members ) return members;
        members = await this.DatabaseFSEntryService.get_descendants(uuid);
        return members ?? [];
    }

    async get_uuid_from_path (path) {
        path = PuterPath.adapt(path);

        let current = path.reference;
        let pathOfReference = path.reference === PuterPath.NULL_UUID
            ? '/' : this.get_path_from_uuid(path.reference);
        
        const fullPath = _path.join(pathOfReference, path.relativePortion);
        let uuid = await this.redis.get(`fs:fsentry:multi:uuid:uuid:path:${fullPath}`);
        return uuid;
    }

    // Cache related functions
    async _link (subject_uuid, parent_uuid, subject_name) {
        this.log.info(`linking ${subject_uuid} to ${parent_uuid}`);
        // We need the parent's path to update everything
        
        let pathOfParent = await this.info.with('fs.fsentry:uuid')
            .obtain('fs.fsentry:path').exec(parent_uuid);

        this.log.debug(`path of parent: ${pathOfParent}`);

        if ( ! subject_name ) {
            subject_name = await this.redis.get(`fs:fsentry:str:name:${subject_uuid}`);
        }

        // Register properties
        await this.redis.set(`fs:fsentry:uuid:parent:${subject_uuid}`, parent_uuid);
        await this.redis.set(`fs:fsentry:str:name:${subject_uuid}`, subject_name);
        
        // Add as child of parent
        await this.redis.sadd(`fs:fsentry:set:childs:${parent_uuid}`, subject_uuid);
        
        // Register path
        const subject_path = `${pathOfParent}/${subject_name}`;
        this.log.debug(`registering path: ${subject_path} for ${subject_uuid}`);
        await this.redis.set(`fs:fsentry:path:path:${subject_uuid}`, subject_path);
        await this.redis.set(`fs:fsentry:multi:uuid:uuid:path:${subject_path}`, subject_uuid);
    }

    async _unlink (subject_uuid) {
        let parent_uuid = await this.redis.get(`fs:fsentry:uuid:parent:${subject_uuid}`);
        // TODO: try getting from database

        // Remove from parent
        await this.redis.srem(`fs:fsentry:set:childs:${parent_uuid}`, subject_uuid);
    }

    async _purge (subject_uuid) {
        await this._unlink(subject_uuid);
    
        // Remove properties
        await this.redis.del(`fs:fsentry:uuid:parent:${subject_uuid}`);
        await this.redis.del(`fs:fsentry:str:name:${subject_uuid}`);

        // Remove path
        const subject_path =
            await this.redis.get(`fs:fsentry:path:path:${subject_uuid}`);
        await this.redis.del(`fs:fsentry:path:path:${subject_uuid}`);
        if ( subject_path ) {
            await this.redis.del(`fs:fsentry:multi:uuid:path:${subject_path}`);
        }
    }

    async _relocate (subject_uuid, new_parent_uuid) {
        await this._unlink(subject_uuid);
        await this._link(subject_uuid, new_parent_uuid);
    }
}

module.exports = SystemFSEntryService;