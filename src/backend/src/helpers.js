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
const _path = require('path');
const micromatch = require('micromatch');
const config = require('./config')
const mime = require('mime-types');
const { ManagedError } = require('./util/errorutil.js');
const { spanify } = require('./util/otelutil.js');
const APIError = require('./api/APIError.js');
const { DB_READ, DB_WRITE } = require('./services/database/consts.js');
const { BaseDatabaseAccessService } = require('./services/database/BaseDatabaseAccessService.js');
const { Context } = require('./util/context');
const { NodeUIDSelector } = require('./filesystem/node/selectors');

let services = null;
const tmp_provide_services = async ss => {
    services = ss;
    await services.ready;
}

async function is_empty(dir_uuid){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    // first check if this entry is shared
    let rows = await db.read(
        `SELECT EXISTS(SELECT 1 FROM fsentries WHERE parent_uid = ? LIMIT 1) AS not_empty`,
        [dir_uuid]
    );

    return !rows[0].not_empty;
}

/**
 * @deprecated - sharing will be implemented with user-to-user ACL
 */
async function has_shared_with(user_id, recipient_user_id){
    return false;
}

/**
 * Checks to see if this file/directory is shared with the user identified by `recipient_user_id`
 *
 * @param {*} fsentry_id
 * @param {*} recipient_user_id
 *
 * @deprecated - sharing will be implemented with user-to-user ACL
 */
async function is_shared_with(fsentry_id, recipient_user_id){
    return false;
}

/**
 * Checks to see if this file/directory is shared with at least one other user
 *
 * @param {*} fsentry_id
 * @param {*} recipient_user_id
 * 
 * @deprecated - sharing will be implemented with user-to-user ACL
 */
 async function is_shared_with_anyone(fsentry_id){
    return false;
}

/**
 * Checks to see if temp_users is disabled and return a boolean
 * @returns {boolean}
 */
async function is_temp_users_disabled() {
    const svc_feature_flag = await services.get("feature-flag");
    return await svc_feature_flag.check("temp-users-disabled");
}

/**
 * Checks to see if user_signup is disabled and return a boolean
 * @returns {boolean}
 */
async function is_user_signup_disabled() {
    const svc_feature_flag = await services.get("feature-flag");
    return await svc_feature_flag.check("user-signup-disabled");
}

const chkperm = spanify('chkperm', async (target_fsentry, requester_user_id, action) => {
    // basic cases where false is the default response
    if(!target_fsentry)
        return false;

    // pseudo-entry from FSNodeContext
    if ( target_fsentry.is_root ) {
        return action === 'read';
    }

    // requester is the owner of this entry
    if(target_fsentry.user_id === requester_user_id){
        return true;
    }
    // this entry was shared with the requester
    else if(await is_shared_with(target_fsentry.id, requester_user_id)){
        return true;
    }
    // special case: owner of entry has shared at least one entry with requester and requester is asking for the owner's root directory: /[owner_username]
    else if(target_fsentry.parent_uid === null && await has_shared_with(target_fsentry.user_id, requester_user_id) && action !== 'write')
        return true;
    else
        return false;
});

/**
 * Checks if the string provided is a valid FileSystem Entry name.
 *
 * @param {string} name
 * @returns
 */
function validate_fsentry_name(name){
    if(!name)
        throw {message: 'Name can not be empty.'}
    else if(!isString(name))
        throw {message: "Name can only be a string."}
    else if(name.includes('/'))
        throw {message: "Name can not contain the '/' character."}
    else if(name === '.')
        throw {message: "Name can not be the '.' character."};
    else if(name === '..')
        throw {message: "Name can not be the '..' character."};
    else if(name.length > config.max_fsentry_name_length)
        throw {message: `Name can not be longer than ${config.max_fsentry_name_length} characters`}
    else
        return true
}

/**
 * Convert a FSEntry ID to UUID
 *
 * @param {integer} id - `id` of FSEntry
 * @returns {Promise} Promise object represents the UUID of the FileSystem Entry
 */
async function id2uuid(id){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    let fsentry = await db.requireRead("SELECT `uuid`, immutable FROM `fsentries` WHERE `id` = ? LIMIT 1", [id]);

    if(!fsentry[0])
        return null;
    else
        return fsentry[0].uuid;
}

/**
 * Get total data stored by a user
 *
 * @param {integer} user_id - `user_id` of user
 * @returns {Promise} Promise object represents the UUID of the FileSystem Entry
 */
 async function df(user_id){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    const fsentry = await db.read("SELECT SUM(size) AS total FROM `fsentries` WHERE `user_id` = ? LIMIT 1", [user_id]);
    if(!fsentry[0] || !fsentry[0].total)
        return 0;
    else
        return fsentry[0].total;
}

/**
 * Get user by a variety of IDs
 *
 * Pass `cached: false` to options if a cached user entry would not be appropriate;
 * for example: when performing authentication.
 *
 * @param {string} options - `options`
 * @returns {Promise}
 */
async function get_user(options) {
    return await services.get('get-user').get_user(options);
}

/**
 * Invalidate the cached entries for a user object
 *
 * @param {User} userID - the user entry to invalidate
 */
function invalidate_cached_user (user) {
    kv.del('users:username:' + user.username);
    kv.del('users:uuid:' + user.uuid);
    kv.del('users:email:' + user.email);
    kv.del('users:id:' + user.id);
}

/**
 * Invalidate the cached entries for the user specified by an id
 * @param {number} id - the id of the user to invalidate
 */
function invalidate_cached_user_by_id (id) {
    const user = kv.get('users:id:' + id);
    if ( ! user ) return;
    invalidate_cached_user(user);
}

/**
 * Refresh apps cache
 *
 * @param {string} options - `options`
 * @returns {Promise}
 */
async function refresh_apps_cache(options, override){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'apps');
    const svc_event = services.get('event');

    const log = services.get('log-service').create('refresh_apps_cache');
    log.tick('refresh apps cache');
    // if options is not provided, refresh all apps
    if(!options){
        let apps = await db.read('SELECT * FROM apps');
        for (let index = 0; index < apps.length; index++) {
            const app = apps[index];
            kv.set('apps:name:' + app.name, app);
            kv.set('apps:id:' + app.id, app);
            kv.set('apps:uid:' + app.uid, app);
        }
        svc_event.emit('apps.invalidate', {
            options, apps,
        });
    }
    // refresh only apps that are approved for listing
    else if(options.only_approved_for_listing){
        let apps = await db.read('SELECT * FROM apps WHERE approved_for_listing = 1');
        for (let index = 0; index < apps.length; index++) {
            const app = apps[index];
            kv.set('apps:name:' + app.name, app);
            kv.set('apps:id:' + app.id, app);
            kv.set('apps:uid:' + app.uid, app);
        }
        svc_event.emit('apps.invalidate', {
            options, apps,
        });
    }
    // if options is provided, refresh only the app specified
    else{
        let app;

        if(options.name)
            app = await db.pread('SELECT * FROM apps WHERE name = ?', [options.name]);
        else if(options.uid)
            app = await db.pread('SELECT * FROM apps WHERE uid = ?', [options.uid]);
        else if(options.id)
            app = await db.pread('SELECT * FROM apps WHERE id = ?', [options.id]);
        else {
            log.error('invalid options to refresh_apps_cache');
            throw new Error('Invalid options provided');
        }

        if(!app || !app[0]) {
            log.error('refresh_apps_cache could not find the app');
            return;
        } else {
            app = app[0];
            if ( override ) {
                Object.assign(app, override);
            }
            kv.set('apps:name:' + app.name, app);
            kv.set('apps:id:' + app.id, app);
            kv.set('apps:uid:' + app.uid, app);
        }

        svc_event.emit('apps.invalidate', {
            options, app,
        });
    }
}

async function refresh_associations_cache(){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'apps');

    const log = services.get('log-service').create('helpers.js');
    log.tick('refresh file associations');
    const associations = await db.read('SELECT * FROM app_filetype_association');
    const lists = {};
    for ( const association of associations ) {
        let ext = association.type;
        if ( ext.startsWith('.') ) ext = ext.slice(1);
        // Default file association entries were added with empty types;
        // this prevents those from showing up.
        if ( ext === '' ) continue;
        if ( ! lists.hasOwnProperty(ext) ) lists[ext] = [];
        lists[ext].push(association.app_id);
    }

    for ( const k in lists ) {
        kv.set(`assocs:${k}:apps`, lists[k]);
    }
}

/**
 * Get App by a variety of IDs
 *
 * @param {string} options - `options`
 * @returns {Promise}
 */
 async function get_app(options){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'apps');

    const log = services.get('log-service').create('get_app');
    let app = [];

    // This condition should be updated if the code below is re-ordered.
    if ( options.follow_old_names && ! options.uid && options.name ) {
        const svc_oldAppName = services.get('old-app-name');
        const old_name = await svc_oldAppName.check_app_name(options.name);
        if ( old_name ) {
            options.uid = old_name.app_uid;

            // The following line is technically pointless, but may avoid a bug
            // if the if...else chain below is re-ordered.
            delete options.name;
        }
    }

    if(options.uid){
        // try cache first
        app[0] = kv.get(`apps:uid:${options.uid}`);
        // not in cache, try db
        if(!app[0]) {
            log.cache(false, 'apps:uid:' + options.uid);
            app = await db.read("SELECT * FROM `apps` WHERE `uid` = ? LIMIT 1", [options.uid]);
        }
    }else if(options.name){
        // try cache first
        app[0] = kv.get(`apps:name:${options.name}`);
        // not in cache, try db
        if(!app[0]) {
            log.cache(false, 'apps:name:' + options.name);
            app = await db.read("SELECT * FROM `apps` WHERE `name` = ? LIMIT 1", [options.name]);
        }
    }
    else if(options.id){
        // try cache first
        app[0] = kv.get(`apps:id:${options.id}`);
        // not in cache, try db
        if(!app[0]) {
            log.cache(false, 'apps:id:' + options.id);
            app = await db.read("SELECT * FROM `apps` WHERE `id` = ? LIMIT 1", [options.id]);
        }
    }
    app = app && app[0] ? app[0] : null;

    if ( app === null ) return null;

    // shallow clone because we use the `delete` operator
    // and it corrupts the cache otherwise
    app = { ...app };
    return app;
}

/**
 * Checks to see if an app exists
 *
 * @param {string} options - `options`
 * @returns {Promise}
 */
 async function app_exists(options){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'apps');

    let app;
    if(options.uid)
        app = await db.read("SELECT `id` FROM `apps` WHERE `uid` = ? LIMIT 1", [options.uid]);
    else if(options.name)
        app = await db.read("SELECT `id` FROM `apps` WHERE `name` = ? LIMIT 1", [options.name]);
    else if(options.id)
        app = await db.read("SELECT `id` FROM `apps` WHERE `id` = ? LIMIT 1", [options.id]);

    return app[0];
}


/**
 * change username
 *
 * @param {string} options - `options`
 * @returns {Promise}
 */
 async function change_username(user_id, new_username){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_WRITE, 'auth');

    const old_username = (await get_user({id: user_id})).username;

    // update username
    await db.write("UPDATE `user` SET username = ? WHERE `id` = ? LIMIT 1", [new_username, user_id]);
    // update root directory name for this user
    await db.write("UPDATE `fsentries` SET `name` = ?, `path` = ? " +
        "WHERE `user_id` = ? AND parent_uid IS NULL LIMIT 1",
        [new_username, '/' + new_username, user_id]
    );

    const log = services.get('log-service').create('change_username');
    log.noticeme(`User ${old_username} changed username to ${new_username}`);
    await services.get('filesystem').update_child_paths(`/${old_username}`, `/${new_username}`, user_id);

    invalidate_cached_user_by_id(user_id);
}


/**
 * Find a FSEntry by its uuid
 *
 * @param {integer} id - `id` of FSEntry
 * @returns {Promise} Promise object represents the UUID of the FileSystem Entry
 * @deprecated Use fs middleware instead
 */
async function uuid2fsentry(uuid, return_thumbnail){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    // todo optim, check if uuid is not exactly 36 characters long, if not it's invalid
    // and we can avoid one unnecessary DB lookup
    let fsentry = await db.requireRead(
        `SELECT
            id,
            associated_app_id,
            uuid,
            public_token,
            bucket,
            bucket_region,
            file_request_token,
            user_id,
            parent_uid,
            is_dir,
            is_public,
            is_shortcut,
            shortcut_to,
            sort_by,
            ${return_thumbnail ? 'thumbnail,' : ''}
            immutable,
            name,
            metadata,
            modified,
            created,
            accessed,
            size
            FROM fsentries WHERE uuid = ? LIMIT 1`,
        [uuid]
    );

    if(!fsentry[0])
        return false;
    else
        return fsentry[0];
}

/**
 * Find a FSEntry by its id
 *
 * @param {integer} id - `id` of FSEntry
 * @returns {Promise} Promise object represents the UUID of the FileSystem Entry
 */
 async function id2fsentry(id, return_thumbnail){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    // todo optim, check if uuid is not exactly 36 characters long, if not it's invalid
    // and we can avoid one unnecessary DB lookup
    let fsentry = await db.requireRead(
        `SELECT
            id,
            uuid,
            public_token,
            file_request_token,
            associated_app_id,
            user_id,
            parent_uid,
            is_dir,
            is_public,
            is_shortcut,
            shortcut_to,
            sort_by,
            ${return_thumbnail ? 'thumbnail,' : ''}
            immutable,
            name,
            metadata,
            modified,
            created,
            accessed,
            size
            FROM fsentries WHERE id = ? LIMIT 1`,
        [id]
    );

    if(!fsentry[0]){
        return false;
    }else
        return fsentry[0];
}

/**
 * Takes a an absolute path and returns its corresponding FSEntry.
 *
 * @param {string} path - absolute path of the filesystem entry to be resolved
 * @param {boolean} return_content - if FSEntry is a file, determines whether its content should be returned
 * @returns {false|object} - `false` if path could not be resolved, otherwise an object representing the FSEntry
 * @deprecated Use fs middleware instead
 */
async function convert_path_to_fsentry(path){
        // todo optim, check if path is valid (e.g. contaisn valid characters)
        // if syntactical errors are found we can potentially avoid some expensive db lookups

        // '/' means that parent_uid is null
        // TODO: facade fsentry for root (devlog:2023-06-01)
        if(path === '/')
            return null;
        //first slash is redundant
        path = path.substr(path.indexOf('/') + 1)
        //last slash, if existing is redundant
        if(path[path.length - 1] === '/')
            path = path.slice(0, -1);
        //split path into parts
        const fsentry_names = path.split('/');

        // if no parts, return false
        if(fsentry_names.length === 0)
            return false;

        let parent_uid = null;
        let final_res = null;
        let is_public = false
        let result

        /** @type BaseDatabaseAccessService */
        const db = services.get('database').get(DB_READ, 'filesystem');

        // Try stored path first
        result = await db.read(
            `SELECT * FROM fsentries WHERE path=? LIMIT 1`,
            ['/' + path],
        );

        if ( result[0] ) {
            return result[0];
        }

        for(let i=0; i < fsentry_names.length; i++){
            if(parent_uid === null){
                result = await db.read(
                    `SELECT * FROM fsentries WHERE parent_uid IS NULL AND name=? LIMIT 1`,
                    [fsentry_names[i]]
                );
            }
            else{
                result = await db.read(
                    `SELECT * FROM fsentries WHERE parent_uid = ? AND name=? LIMIT 1`,
                    [parent_uid, fsentry_names[i]]
                );
            }

            if(result[0] ){
                parent_uid = result[0].uuid;
                // is_public is either directly specified or inherited from parent dir
                if(result[0].is_public === null)
                    result[0].is_public = is_public
                else
                    is_public = result[0].is_public

            }else{
                return false;
            }
            final_res = result
        }
        return final_res[0];
}

/**
 *
 * @param {integer} bytes - size in bytes
 * @returns {string} bytes in human-readable format
 */
function byte_format(bytes){
    // calculate and return bytes in human-readable format
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    if (typeof bytes !== "number" || bytes < 1) {
        return '0 B';
    }
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
};

const get_dir_size = async (path, user)=>{
    let size = 0;
    const descendants = await get_descendants(path, user);
    for(let i=0; i < descendants.length; i++){
        if(!descendants[i].is_dir){
            size += descendants[i].size;
        }
    }

    return size;
}

/**
 * Recursively retrieve all files, directories, and subdirectories under `path`.
 * Optionally the `depth` can be set.
 *
 * @param {string} path
 * @param {object} user
 * @param {integer} depth
 * @returns
 */
const get_descendants_0 = async (path, user, depth, return_thumbnail = false) => {
    const log = services.get('log-service').create('get_descendants');
    log.called();

    // decrement depth if it's set
    depth !== undefined && depth--;
    // turn path into absolute form
    path = _path.resolve('/', path)
    // get parent dir
    const parent = await convert_path_to_fsentry(path);
    // holds array that will be returned
    const ret = [];
    // holds immediate children of this path
    let children;

    // try to extract username from path
    let username;
    let split_path = path.split('/');
    if(split_path.length === 2 && split_path[0] === '')
        username = split_path[1];


    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    // -------------------------------------
    // parent is root ('/')
    // -------------------------------------
    if(parent === null){
        path = '';
        // direct children under root
        children = await db.read(
            `SELECT
                id, uuid, parent_uid, name, metadata, is_dir, bucket, bucket_region,
                modified, created, immutable, shortcut_to, is_shortcut, sort_by, associated_app_id,
                ${return_thumbnail ? 'thumbnail, ' : ''}
                accessed, size
                FROM fsentries
                WHERE user_id = ? AND parent_uid IS NULL`,
            [user.id]
        );
        // users that have shared files/dirs with this user
        const sharing_users = await db.read(
            `SELECT DISTINCT(owner_user_id), user.username
                FROM share
                INNER JOIN user ON user.id = share.owner_user_id
                WHERE share.recipient_user_id = ?`,
            [user.id]
        );
        if(sharing_users.length>0){
            for(let i=0; i<sharing_users.length; i++){
                let dir = {};
                dir.id = null;
                dir.uuid = null;
                dir.parent_uid = null;
                dir.name = sharing_users[i].username;
                dir.is_dir = true;
                dir.immutable = true;
                children.push(dir)
            }
        }
    }
    // -------------------------------------
    // parent doesn't exist
    // -------------------------------------
    else if(parent === false){
        return [];
    }
    // -------------------------------------
    // Parent is a shared-user directory: /[some_username](/)
    // but make sure `[some_username]` is not the same as the requester's username
    // -------------------------------------
    else if(username && username !== user.username){
        children = [];
        let sharing_user;
        sharing_user = await get_user({username: username});
        if(!sharing_user)
            return [];

        // shared files/dirs with this user
        const shared_fsentries = await db.read(
            `SELECT
                fsentries.id, fsentries.user_id, fsentries.uuid, fsentries.parent_uid, fsentries.bucket, fsentries.bucket_region,
                fsentries.name, fsentries.shortcut_to, fsentries.is_shortcut, fsentries.metadata, fsentries.is_dir, fsentries.modified,
                fsentries.created, fsentries.accessed, fsentries.size, fsentries.sort_by, fsentries.associated_app_id,
                fsentries.is_symlink, fsentries.symlink_path,
                fsentries.immutable ${return_thumbnail ? ', fsentries.thumbnail' : ''}
                FROM share
                INNER JOIN fsentries ON fsentries.id = share.fsentry_id
                WHERE share.recipient_user_id = ? AND owner_user_id = ?`,
            [user.id, sharing_user.id]
        );
        // merge `children` and `shared_fsentries`
        if(shared_fsentries.length>0){
            for(let i=0; i<shared_fsentries.length; i++){
                shared_fsentries[i].path = await id2path(shared_fsentries[i].id);
                children.push(shared_fsentries[i])
            }
        }
    }
    // -------------------------------------
    // All other cases
    // -------------------------------------
    else{
        children = [];
        let temp_children = await db.read(
            `SELECT
                id, user_id, uuid, parent_uid, name, metadata, is_shortcut,
                shortcut_to, is_dir, modified, created, accessed, size, sort_by, associated_app_id,
                is_symlink, symlink_path,
                immutable ${return_thumbnail ? ', thumbnail' : ''}
                FROM fsentries
                WHERE parent_uid = ?`,
            [parent.uuid]
        );
        // check if user has access to each file, if yes add it
        if(temp_children.length>0){
            for(let i=0; i<temp_children.length; i++){
                const tchild = temp_children[i];
                if(await chkperm(tchild, user.id))
                    children.push(tchild);
            }
        }
    }

    // shortcut on empty result set
    if ( children.length === 0 ) return [];

    const ids = children.map(child => child.id);
    const qmarks = ids.map(() => '?').join(',');

    let rows = await db.read(
        `SELECT root_dir_id FROM subdomains WHERE root_dir_id IN (${qmarks}) AND user_id=?`,
        [...ids, user.id]);

    log.debug('rows???', rows);

    const websiteMap = {};
    for ( const row of rows ) websiteMap[row.root_dir_id] = true;

    for(let i=0; i<children.length; i++){
        const contentType = mime.contentType(children[i].name)

        // has_website
        let has_website = false;
        if(children[i].is_dir){
            has_website = websiteMap[children[i].id];
        }

        // object to return
        // TODO: DRY creation of response fsentry from db fsentry
        ret.push({
            path:       children[i].path ?? (path + '/' + children[i].name),
            name:       children[i].name,
            metadata:   children[i].metadata,
            _id:         children[i].id,
            id:         children[i].uuid,
            uid:        children[i].uuid,
            is_shortcut: children[i].is_shortcut,
            shortcut_to: (children[i].shortcut_to ? await id2uuid(children[i].shortcut_to) : undefined),
            shortcut_to_path: (children[i].shortcut_to  ? await id2path(children[i].shortcut_to) : undefined),
            is_symlink: children[i].is_symlink,
            symlink_path: children[i].symlink_path,
            immutable:  children[i].immutable,
            is_dir:     children[i].is_dir,
            modified:   children[i].modified,
            created:    children[i].created,
            accessed:   children[i].accessed,
            size:       children[i].size,
            sort_by:    children[i].sort_by,
            thumbnail:  children[i].thumbnail,
            associated_app_id:  children[i].associated_app_id,
            type:       contentType ? contentType : null,
            has_website:    has_website,
        })
        if( children[i].is_dir &&
            (depth === undefined || (depth !== undefined && depth > 0))
            ){
            ret.push(await get_descendants(path + '/' + children[i].name, user, depth))
        }
    }
    return ret.flat();
}

const get_descendants = async (...args) => {
    const tracer = services.get('traceService').tracer;
    let ret;
    await tracer.startActiveSpan('get_descendants', async span => {
        ret = await get_descendants_0(...args);
        span.end();
    });
    return ret;
}

/**
 *
 * @param {integer} entry_id
 * @returns
 */
 const id2path = async (entry_uid)=>{
    if ( entry_uid == null ) {
        throw new Error('got null or undefined entry id');
    }

    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    const traces = services.get('traceService');
    const log = services.get('log-service').create('helpers.id2path');
    log.traceOn();
    const errors = services.get('error-service').create(log);
    log.called();

    let result;

    return await traces.spanify(`helpers:id2path`, async () => {
        log.debug(`entry id: ${entry_uid}`)
        if ( typeof entry_uid === 'number' ) {
            const old = entry_uid;
            entry_uid = await id2uuid(entry_uid);
            log.debug(`entry id resolved: resolved ${old} ${entry_uid}`)
        }

        try {
            result = await db.read(`
                WITH RECURSIVE cte AS (
                    SELECT uuid, parent_uid, name, name AS path
                    FROM fsentries
                    WHERE uuid = ?

                    UNION ALL

                    SELECT e.uuid, e.parent_uid, e.name, ${
                        db.case({
                            sqlite: `e.name || '/' || cte.path`,
                            otherwise: `CONCAT(e.name, '/', cte.path)`,
                        })
                    }
                    FROM fsentries e
                    INNER JOIN cte ON cte.parent_uid = e.uuid
                )
                SELECT *
                FROM cte
                WHERE parent_uid IS NULL
            `, [entry_uid]);
        } catch (e) {
            errors.report('id2path.select', {
                alarm: true,
                source: e,
                message: `error while resolving path for ${entry_uid}: ${e.message}`,
                extra: {
                    entry_uid,
                }
            });
            throw new ManagedError(`cannot create path for ${entry_uid}`);
        }

        if ( ! result || ! result[0] ) {
            errors.report('id2path.select', {
                alarm: true,
                message: `no result for ${entry_uid}`,
                extra: {
                    entry_uid,
                }
            });
            throw new ManagedError(`cannot create path for ${entry_uid}`);
        }

        return '/' + result[0].path;
    })
}

/**
 *
 * @param {string} glob
 * @param {object} user
 * @returns
 */
async function resolve_glob(glob, user){
    //turn glob into abs path
    glob = _path.resolve('/', glob)
    //get base of glob
    const base = micromatch.scan(glob).base
    //estimate needed depth
    let depth = 1
    const dirs = glob.split('/')
    for(let i=0; i< dirs.length; i++){
        if(dirs[i].includes('**')){
            depth = undefined
            break
        }else{
            depth++
        }
    }

    const descendants = await get_descendants(base, user, depth)

    return descendants.filter((fsentry) => {
        return fsentry.path && micromatch.isMatch(fsentry.path, glob)
    })
}

/**
 * Copies a FSEntry represented by `source_path` to `dest_path`.
 *
 * @param {string} source_path
 * @param {string} dest_path
 * @param {object} user
 * @returns
 */
function cp(source_path, dest_path, user, overwrite, change_name, check_perms = true){
    throw new Error(`legacy copy function called`);
}

function isString(variable) {
    return typeof variable === 'string' || variable instanceof String;
}

// checks to see if given variable is an object
function isObject(variable) {
    return variable !== null && typeof variable === 'object';
}

/**
 * Recusrively deletes all files under `path`
 *
 * @param {string} source_path
 * @param {object} user
 * @returns
 */
function rm(source_path, user, descendants_only = false){
    throw new Error(`legacy remove function called`);
}

const body_parser_error_handler = (err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).send(err); // Bad request
    }
    next();
}

/**
 * Given a uid, returns a file node.
 * 
 * TODO (xiaochen): It only works for MemoryFSProvider currently.
 * 
 * @param {string} uid - The uid of the file to get.
 * @returns {Promise<MemoryFile|null>} The file node, or null if the file does not exist.
 */
async function get_entry(uid) {
    const svc_mountpoint = Context.get('services').get('mountpoint');
    const uid_selector = new NodeUIDSelector(uid);
    const provider = await svc_mountpoint.get_provider(uid_selector);

    // NB: We cannot import MemoryFSProvider here because it will cause a circular dependency.
    if ( provider.constructor.name !== 'MemoryFSProvider' ) {
        return null;
    }

    return provider.stat({
        selector: uid_selector,
    });
}

async function is_ancestor_of(ancestor_uid, descendant_uid){
    const ancestor = await get_entry(ancestor_uid);
    const descendant = await get_entry(descendant_uid);

    if ( ancestor && descendant ) {
        return descendant.path.startsWith(ancestor.path);
    }


    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    // root is an ancestor to all FSEntries
    if(ancestor_uid === null)
        return true;
    // root is never a descendant to any FSEntries
    if(descendant_uid === null)
        return false;

    if ( typeof ancestor_uid === 'number' ) {
        ancestor_uid = await id2uuid(ancestor_uid);
    }
    if ( typeof descendant_uid === 'number' ) {
        descendant_uid = await id2uuid(descendant_uid);
    }

    let parent = await db.read("SELECT `uuid`, `parent_uid` FROM `fsentries` WHERE `uuid` = ? LIMIT 1", [descendant_uid]);
    if(parent[0] === undefined)
        parent = await db.pread("SELECT `uuid`, `parent_uid` FROM `fsentries` WHERE `uuid` = ? LIMIT 1", [descendant_uid]);
    if(parent[0].uuid === ancestor_uid || parent[0].parent_uid === ancestor_uid){
        return true;
    }
    // keep checking as long as parent of parent is not root
    while(parent[0].parent_uid !== null){
        parent = await db.read("SELECT `uuid`, `parent_uid` FROM `fsentries` WHERE `uuid` = ? LIMIT 1", [parent[0].parent_uid]);
        if(parent[0] === undefined) {
            parent = await db.pread("SELECT `uuid`, `parent_uid` FROM `fsentries` WHERE `uuid` = ? LIMIT 1", [descendant_uid]);
        }

        if(parent[0].uuid === ancestor_uid || parent[0].parent_uid === ancestor_uid){
            return true;
        }
    }

    return false;
}

async function sign_file(fsentry, action){
    const sha256 = require('js-sha256').sha256;

    // fsentry not found
    if(fsentry === false){
        throw {message: 'No entry found with this uid'};
    }

    const uid = fsentry.uuid ?? (fsentry.uid ?? fsentry._id);
    const ttl = 9999999999999;
    const secret = config.url_signature_secret;
    const expires = Math.ceil(Date.now() / 1000) + ttl;
    const signature = sha256(`${uid}/${action}/${secret}/${expires}`);
    const contentType = mime.contentType(fsentry.name);

    // return
    return {
        uid: uid,
        expires: expires,
        signature: signature,
        url: `${config.api_base_url}/file?uid=${uid}&expires=${expires}&signature=${signature}`,
        read_url: `${config.api_base_url}/file?uid=${uid}&expires=${expires}&signature=${signature}`,
        write_url: `${config.api_base_url}/writeFile?uid=${uid}&expires=${expires}&signature=${signature}`,
        metadata_url: `${config.api_base_url}/itemMetadata?uid=${uid}&expires=${expires}&signature=${signature}`,
        fsentry_type: contentType,
        fsentry_is_dir: !! fsentry.is_dir,
        fsentry_name: fsentry.name,
        fsentry_size: fsentry.size,
        fsentry_accessed: fsentry.accessed,
        fsentry_modified: fsentry.modified,
        fsentry_created: fsentry.created,
    }
}

async function gen_public_token(file_uuid, ttl = 24 * 60 * 60){
    const { v4: uuidv4 } = require('uuid');

    // get fsentry
    let fsentry = await uuid2fsentry(file_uuid);

    // fsentry not found
    if(fsentry === false){
        throw {message: 'No entry found with this uid'};
    }

    const uid = fsentry.uuid;
    const token = uuidv4();
    const contentType = mime.contentType(fsentry.name);

    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_WRITE, 'filesystem');

    // insert into DB
    try{
        await db.write(
            `UPDATE fsentries SET public_token = ? WHERE id = ?`,
            [
                //token
                token,
                //fsentry_id
                fsentry.id,
            ]);
    }catch(e){
        console.log(e);
        return false;
    }

    // return
    return {
        uid: uid,
        token: token,
        url: `${config.api_base_url}/pubfile?token=${token}`,
        fsentry_type: contentType,
        fsentry_is_dir: fsentry.is_dir,
        fsentry_name: fsentry.name,
    }
}

async function deleteUser(user_id){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    // get a list of up to 5000 files owned by this user
    for ( let offset=0; true; offset += 5000 ) {
        let files = await db.read(
            `SELECT uuid, bucket, bucket_region FROM fsentries WHERE user_id = ? AND is_dir = 0 LIMIT 5000 OFFSET `+offset,
            [user_id]
        );
        
        if ( !files || files.length == 0 ) break;

        // delete all files from S3
        if(files !== null && files.length > 0){
            for(let i=0; i<files.length; i++){
                // init S3 SDK
                const svc_fs = Context.get('services').get('filesystem');
                const svc_mountpoint =
                    Context.get('services').get('mountpoint');
                // NB: We use a hard-coded string to avoid circular dependency.
                // 
                // TODO (xiaochen): what if the provider is not PuterFSProvider?
                const storage = svc_mountpoint.get_storage('PuterFSProvider');
                const op_delete = storage.create_delete();
                await op_delete.run({
                    node: await svc_fs.node(new NodeUIDSelector(files[i].uuid))
                });
            }
        }
    }

    // delete all fsentries from DB
    await db.write(`DELETE FROM fsentries WHERE user_id = ?`,[user_id]);

    // delete user
    await db.write(`DELETE FROM user WHERE id = ?`,[user_id]);
}

function subdomain(req){
    if ( config.experimental_no_subdomain ) return 'api';
    return req.hostname.slice(0, -1 * (config.domain.length + 1));
}

async function jwt_auth(req){
    let token;
    // HTTML Auth header
    if(req.header && req.header('Authorization'))
        token = req.header('Authorization');
    // Cookie
    else if(req.cookies && req.cookies[config.cookie_name])
        token = req.cookies[config.cookie_name];
    // Auth token in URL
    else if(req.query && req.query.auth_token)
        token = req.query.auth_token;
    // Socket
    else if(req.handshake && req.handshake.auth && req.handshake.auth.auth_token)
        token = req.handshake.auth.auth_token;

    if(!token || token === 'null')
        throw('No auth token found');
    else if (typeof token !== 'string')
        throw('token must be a string.')
    else
        token = token.replace('Bearer ', '')

    try{
        const svc_auth = Context.get('services').get('auth');
        const actor = await svc_auth.authenticate_from_token(token);

        if ( ! actor.type?.constructor?.name === 'UserActorType' ) {
            throw({
                message: APIError.create('token_unsupported')
                    .serialize(),
            });
        }

        return {
            actor,
            user: actor.type.user,
            token: token,
        };
    }catch(e){
        if ( ! (e instanceof APIError) ) {
            console.log('ERROR', e);
        }
        throw(e.message);
    }
}

/**
 * returns all ancestors of an fsentry
 *
 * @param {*} fsentry_id
 */
 async function ancestors(fsentry_id){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    const ancestors = [];
    // first parent
    let parent = await db.read("SELECT * FROM `fsentries` WHERE `id` = ? LIMIT 1", [fsentry_id]);
    if(parent.length === 0){
        return ancestors;
    }
    // get all subsequent parents
    while(parent[0].parent_uid !== null){
        const parent_fsentry = await uuid2fsentry(parent[0].parent_uid);
        parent = await db.read("SELECT * FROM `fsentries` WHERE `id` = ? LIMIT 1", [parent_fsentry.id]);
        if(parent[0].length !== 0){
            ancestors.push(parent[0])
        }
    }

    return ancestors;
}

function hyphenize_confirm_code(email_confirm_code){
    email_confirm_code = email_confirm_code.toString();
    email_confirm_code =
        email_confirm_code[0] +
        email_confirm_code[1] +
        email_confirm_code[2] +
        '-' +
        email_confirm_code[3] +
        email_confirm_code[4] +
        email_confirm_code[5];
    return email_confirm_code;
}

async function username_exists(username){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    let rows = await db.read(`SELECT EXISTS(SELECT 1 FROM user WHERE username=?) AS username_exists`, [username]);
    if(rows[0].username_exists)
        return true;
}

async function app_name_exists(name){
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_READ, 'filesystem');

    let rows = await db.read(`SELECT EXISTS(SELECT 1 FROM apps WHERE apps.name=?) AS app_name_exists`, [name]);
    if(rows[0].app_name_exists)
        return true;

    const svc_oldAppName = services.get('old-app-name');
    const name_info = await svc_oldAppName.check_app_name(name);
    if ( name_info ) return true;
}

function send_email_verification_code(email_confirm_code, email){
    const svc_email = Context.get('services').get('email');
    svc_email.send_email({ email }, 'email_verification_code', {
        code: hyphenize_confirm_code(email_confirm_code),
    })
}

function send_email_verification_token(email_confirm_token, email, user_uuid){
    const svc_email = Context.get('services').get('email');
    const link = `${config.origin}/confirm-email-by-token?user_uuid=${user_uuid}&token=${email_confirm_token}`;
    svc_email.send_email({ email }, 'email_verification_link', { link });
}

function generate_random_str(length) {
    let result           = '';
    const characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const charactersLength = characters.length;
    for ( let i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() *
 charactersLength));
   }
   return result;
}

/**
 * Converts a given number of seconds into a human-readable string format.
 *
 * @param {number} seconds - The number of seconds to be converted.
 * @returns {string} The time represented in the format: 'X years Y days Z hours A minutes B seconds'.
 * @throws {TypeError} If the `seconds` parameter is not a number.
 */
function seconds_to_string(seconds) {
    const numyears = Math.floor(seconds / 31536000);
    const numdays = Math.floor((seconds % 31536000) / 86400);
    const numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
    const numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
    const numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
    return numyears + " years " + numdays + " days " + numhours + " hours " + numminutes + " minutes " + numseconds + " seconds";
}


/**
 * returns a list of apps that could open the fsentry, ranked by relevance
 * @param {*} fsentry
 * @param {*} options
 */
async function suggest_app_for_fsentry(fsentry, options){
    const svc_performanceMonitor = services.get('performance-monitor');
    const monitor = svc_performanceMonitor.createContext("suggest_app_for_fsentry");
    const suggested_apps = [];

    let content_type = mime.contentType(fsentry.name);
    if( ! content_type ) content_type = '';

    // IIFE just so fsname can stay `const`
    const fsname = (() => {
        if ( ! fsentry.name ) {
            return 'missing-fsentry-name';
        }
        let fsname = fsentry.name.toLowerCase();
        // We add `.directory` so that this works as a file association
        if ( fsentry.is_dir ) fsname += '.directory';
        return fsname;
    })();
    const file_extension = _path.extname(fsname).toLowerCase();
    
    const any_of = (list, name) => {
        return list.some(v => name.endsWith(v));
    }

    //---------------------------------------------
    // Code
    //---------------------------------------------
    const exts_code = [
        '.asm',
        '.asp',
        '.aspx',
        '.bash',
        '.c',
        '.cpp',
        '.css',
        '.csv',
        '.dhtml',
        '.f',
        '.go',
        '.h',
        '.htm',
        '.html',
        '.html5',
        '.java',
        '.jl',
        '.js',
        '.jsa',
        '.json',
        '.jsonld',
        '.jsf',
        '.jsp',
        '.kt',
        '.log',
        '.lock',
        '.lua',
        '.md',
        '.perl',
        '.phar',
        '.php',
        '.pl',
        '.py',
        '.r',
        '.rb',
        '.rdata',
        '.rda',
        '.rdf',
        '.rds',
        '.rs',
        '.rlib',
        '.rpy',
        '.scala',
        '.sc',
        '.scm',
        '.sh',
        '.sol',
        '.sql',
        '.ss',
        '.svg',
        '.swift',
        '.toml',
        '.ts',
        '.wasm',
        '.xhtml',
        '.xml',
        '.yaml',
    ];

    if ( any_of(exts_code, fsname) || !fsname.includes('.') ) {
        suggested_apps.push(await get_app({name: 'code'}))
        suggested_apps.push(await get_app({name: 'editor'}))
    }

    //---------------------------------------------
    // Editor
    //---------------------------------------------
    if(
        fsname.endsWith('.txt') ||
        // files with no extension
        !fsname.includes('.')
    ){
        suggested_apps.push(await get_app({name: 'editor'}))
        suggested_apps.push(await get_app({name: 'code'}))
    }
    //---------------------------------------------
    // Markus
    //---------------------------------------------
    if(fsname.endsWith('.md')){
        suggested_apps.push(await get_app({name: 'markus'}))
    }
    //---------------------------------------------
    // Viewer
    //---------------------------------------------
    if(
        fsname.endsWith('.jpg') ||
        fsname.endsWith('.png') ||
        fsname.endsWith('.webp') ||
        fsname.endsWith('.svg') ||
        fsname.endsWith('.bmp') ||
        fsname.endsWith('.jpeg')
    ){
        suggested_apps.push(await get_app({name: 'viewer'}));
    }
    //---------------------------------------------
    // Draw
    //---------------------------------------------
    if(
        fsname.endsWith('.bmp') ||
        content_type.startsWith('image/')
    ){
        suggested_apps.push(await get_app({name: 'draw'}));
    }
    //---------------------------------------------
    // PDF
    //---------------------------------------------
    if(fsname.endsWith('.pdf')){
        suggested_apps.push(await get_app({name: 'pdf'}));
    }
    //---------------------------------------------
    // Player
    //---------------------------------------------
    if(
        fsname.endsWith('.mp4') ||
        fsname.endsWith('.webm') ||
        fsname.endsWith('.mpg') ||
        fsname.endsWith('.mpv') ||
        fsname.endsWith('.mp3') ||
        fsname.endsWith('.m4a') ||
        fsname.endsWith('.ogg')
    ){
        suggested_apps.push(await get_app({name: 'player'}));
    }

    //---------------------------------------------
    // 3rd-party apps
    //---------------------------------------------
    const apps = kv.get(`assocs:${file_extension.slice(1)}:apps`) ?? [];

    monitor.label("third party associations");
    for ( const app_id of apps ) {
        // retrieve app from DB
        const third_party_app = await get_app({id: app_id})
        if ( ! third_party_app ) continue;
        // only add if the app is approved for opening items or the app is owned by this user
        if( third_party_app.approved_for_opening_items ||
            (options !== undefined && options.user !== undefined && options.user.id === third_party_app.owner_user_id))
            suggested_apps.push(third_party_app)
    }
    monitor.stamp();
    monitor.end();

    // return list
    return suggested_apps.filter((suggested_app, pos, self) => {
        // Remove any null values caused by calling `get_app()` for apps that don't exist.
        // This happens on self-host because we don't include `code`, among others.
        if (!suggested_app)
            return false;

        // Remove any duplicate entries
        return self.indexOf(suggested_app) === pos;
    });
}

async function get_taskbar_items(user, { icon_size, no_icons } = {}) {
    /** @type BaseDatabaseAccessService */
    const db = services.get('database').get(DB_WRITE, 'filesystem');

    let taskbar_items_from_db = [];
    // If taskbar items don't exist (specifically NULL)
    // add default apps.
    if(!user.taskbar_items){
        taskbar_items_from_db = [
            {name: 'app-center', type: 'app'},
            {name: 'dev-center', type: 'app'},
            {name: 'editor', type: 'app'},
            {name: 'code', type: 'app'},
            {name: 'camera', type: 'app'},
            {name: 'recorder', type: 'app'},
        ];
        await db.write(
            `UPDATE user SET taskbar_items = ? WHERE id = ?`,
            [
                JSON.stringify(taskbar_items_from_db),
                user.id,
            ]
        );
        invalidate_cached_user(user);
    }
    // there are items from before
    else{
        try {
            taskbar_items_from_db = JSON.parse(user.taskbar_items);
        }catch(e){
            // ignore errors
        }
    }

    // get apps that these taskbar items represent
    let taskbar_items = [];
    for (let index = 0; index < taskbar_items_from_db.length; index++) {
        const taskbar_item_from_db = taskbar_items_from_db[index];
        if ( taskbar_item_from_db.type !== 'app' ) continue;
        if ( taskbar_item_from_db.name === 'explorer' ) continue;

        let item = {};
        if(taskbar_item_from_db.name)
            item = await get_app({name: taskbar_item_from_db.name});
        else if(taskbar_item_from_db.id)
            item = await get_app({id: taskbar_item_from_db.id});
        else if(taskbar_item_from_db.uid)
            item = await get_app({uid: taskbar_item_from_db.uid});

        // if item not found, skip it
        if(!item) continue;

        // delete sensitive attributes
        delete item.id;
        delete item.owner_user_id;
        delete item.timestamp;
        // delete item.godmode;
        delete item.approved_for_listing;
        delete item.approved_for_opening_items;

        if ( no_icons ) {
            delete item.icon;
        } else {
            const svc_appIcon = services.get('app-icon');
            const icon_result = await svc_appIcon.get_icon_stream({
                app_icon: item.icon,
                app_uid: item.uid,
                size: icon_size,
            });

            item.icon = await icon_result.get_data_url();
        }

        // add to final object
        taskbar_items.push(item)
    }

    return taskbar_items;
}

function validate_signature_auth(url, action, options = {}) {
    const query = new URL(url).searchParams;

    if(!query.get('uid'))
        throw {message: '`uid` is required for signature-based authentication.'}
    else if(!action)
        throw {message: '`action` is required for signature-based authentication.'}
    else if(!query.get('expires'))
        throw {message: '`expires` is required for signature-based authentication.'}
    else if(!query.get('signature'))
        throw {message: '`signature` is required for signature-based authentication.'}
    
    if ( options.uid ) {
        if ( query.get('uid') !== options.uid ) {
            throw {message: 'Authentication failed. `uid` does not match.'}
        }
    }

    const expired = query.get('expires') && (query.get('expires') < Date.now() / 1000);

    // expired?
    if(expired)
        throw {message: 'Authentication failed. Signature expired.'}

    const uid = query.get('uid');
    const secret = config.url_signature_secret;
    const sha256 = require('js-sha256').sha256;

    // before doing anything, see if this signature is valid for 'write' action, if yes that means every action is allowed
    if(!expired && query.get('signature') === sha256(`${uid}/write/${secret}/${query.get('expires')}`))
        return true;
    // if not, check specific actions
    else if(!expired && query.get('signature') === sha256(`${uid}/${action}/${secret}/${query.get('expires')}`))
        return true;
    // auth failed
    else
        throw {message: 'Authentication failed'}
}

function get_url_from_req(req) {
    return req.protocol + '://' + req.get('host') + req.originalUrl;
}

async function mv(options){
    throw new Error('legacy mv function called');
}

/**
 * Formats a number with grouped thousands.
 *
 * @param {number|string} number - The number to be formatted. If a string is provided, it must only contain numerical characters, plus and minus signs, and the letter 'E' or 'e' (for scientific notation).
 * @param {number} decimals - The number of decimal points. If a non-finite number is provided, it defaults to 0.
 * @param {string} [dec_point='.'] - The character used for the decimal point. Defaults to '.' if not provided.
 * @param {string} [thousands_sep=','] - The character used for the thousands separator. Defaults to ',' if not provided.
 * @returns {string} The formatted number with grouped thousands, using the specified decimal point and thousands separator characters.
 * @throws {TypeError} If the `number` parameter cannot be converted to a finite number, or if the `decimals` parameter is non-finite and cannot be converted to an absolute number.
 */
function number_format (number, decimals, dec_point, thousands_sep) {
    // Strip all characters but numerical ones.
    number = (number + '').replace(/[^0-9+\-Ee.]/g, '');
    let n = !isFinite(+number) ? 0 : +number,
        prec = !isFinite(+decimals) ? 0 : Math.abs(decimals),
        sep = (typeof thousands_sep === 'undefined') ? ',' : thousands_sep,
        dec = (typeof dec_point === 'undefined') ? '.' : dec_point,
        s = '',
        toFixedFix = function (n, prec) {
            const k = Math.pow(10, prec);
            return '' + Math.round(n * k) / k;
        };
    // Fix for IE parseFloat(0.55).toFixed(0) = 0;
    s = (prec ? toFixedFix(n, prec) : '' + Math.round(n)).split('.');
    if (s[0].length > 3) {
        s[0] = s[0].replace(/\B(?=(?:\d{3})+(?!\d))/g, sep);
    }
    if ((s[1] || '').length < prec) {
        s[1] = s[1] || '';
        s[1] += new Array(prec - s[1].length + 1).join('0');
    }
    return s.join(dec);
}

module.exports = {
    ancestors,
    app_name_exists,
    app_exists,
    body_parser_error_handler,
    byte_format,
    change_username,
    chkperm,
    convert_path_to_fsentry,
    cp,
    deleteUser,
    get_descendants,
    get_dir_size,
    gen_public_token,
    get_taskbar_items,
    get_url_from_req,
    generate_random_str,
    get_app,
    get_user,
    invalidate_cached_user,
    invalidate_cached_user_by_id,
    has_shared_with,
    hyphenize_confirm_code,
    id2fsentry,
    id2path,
    id2uuid,
    is_ancestor_of,
    is_empty,
    is_shared_with,
    is_shared_with_anyone,
    ...require('@heyputer/backend-core-0').validation,
    is_temp_users_disabled,
    is_user_signup_disabled,
    jwt_auth,
    mv,
    number_format,
    refresh_apps_cache,
    refresh_associations_cache,
    resolve_glob,
    rm,
    seconds_to_string,
    send_email_verification_code,
    send_email_verification_token,
    sign_file,
    subdomain,
    suggest_app_for_fsentry,
    df,
    username_exists,
    uuid2fsentry,
    validate_fsentry_name,
    validate_signature_auth,
    tmp_provide_services,
};
