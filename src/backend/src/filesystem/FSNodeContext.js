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
const { get_user, get_dir_size, id2path, id2uuid, is_empty, is_shared_with_anyone, suggest_app_for_fsentry, get_app } = require("../helpers");

const putility = require('@heyputer/putility');
const { MultiDetachable } = putility.libs.listener;
const { TDetachable } = putility.traits;
const config = require("../config");
const _path = require('path');
const { NodeInternalIDSelector, NodeChildSelector, NodeUIDSelector, RootNodeSelector, NodePathSelector } = require("./node/selectors");
const { Context } = require("../util/context");
const { NodeRawEntrySelector } = require("./node/selectors");
const { DB_READ } = require("../services/database/consts");
const { UserActorType } = require("../services/auth/Actor");
const { PermissionUtil } = require("../services/auth/PermissionService");

/**
 * Container for information collected about a node
 * on the filesystem.
 *
 * Examples of such information include:
 * - data collected by querying an fsentry
 * - the location of a file's contents
 *
 * This is an implementation of the Facade design pattern,
 * so information about a filesystem node should be collected
 * via the methods on this class and not mutated directly.
 *
 * @class FSNodeContext
 * @property {object} entry the filesystem entry
 * @property {string} path the path to the filesystem entry
 * @property {string} uid the UUID of the filesystem entry
 */
module.exports = class FSNodeContext {
    static TYPE_FILE = { label: 'File' };
    static TYPE_DIRECTORY = { label: 'Directory' };
    static TYPE_SYMLINK = {};
    static TYPE_SHORTCUT = {};
    static TYPE_UNDETERMINED = {};

    static SELECTOR_PRIORITY_ORDER = [
        NodeRawEntrySelector,
        RootNodeSelector,
        NodeInternalIDSelector,
        NodeUIDSelector,
        NodeChildSelector,
        NodePathSelector,
    ];

    /**
     * Creates an instance of FSNodeContext.
     * @param {*} opt_identifier
     * @param {*} opt_identifier.path a path to the filesystem entry
     * @param {*} opt_identifier.uid a UUID of the filesystem entry
     * @param {*} opt_identifier.id please pass mysql_id instead
     * @param {*} opt_identifier.mysql_id a MySQL ID of the filesystem entry
     */
    constructor ({
        services,
        selector,
        provider,
        fs
    }) {
        this.log = services.get('log-service').create('fsnode-context');
        this.selector_ = null;
        this.selectors_ = [];
        this.selector = selector;
        this.provider = provider;
        this.entry = {};
        this.found = undefined;
        this.found_thumbnail = undefined;

        selector.setPropertiesKnownBySelector(this);

        this.services = services;

        this.fileContentsFetcher = null;

        this.fs = fs;

        // Decorate all fetch methods with otel span
        // TODO: Apply method decorators using a putility class feature
        const fetch_methods = [
            'fetchEntry',
            'fetchPath',
            'fetchSubdomains',
            'fetchOwner',
            'fetchShares',
            'fetchVersions',
            'fetchSize',
            'fetchSuggestedApps',
            'fetchIsEmpty',
        ];
        for ( const method of fetch_methods ) {
            const original_method = this[method];
            this[method] = async (...args) => {
                const tracer = this.services.get('traceService').tracer;
                let result;
                await tracer.startActiveSpan(`fs:nodectx:fetch:${method}`, async span => {
                    result = await original_method.call(this, ...args);
                    span.end();
                });
                return result;
            }
        }
    }

    set selector (new_selector) {
        // Only add the selector if we don't already have it
        for ( const selector of this.selectors_ ) {
            if ( selector instanceof new_selector.constructor ) return;
        }
        this.selectors_.push(new_selector);
        this.selector_ = new_selector;
    }

    get selector () {
        return this.get_optimal_selector();
    }

    get_selector_of_type (cls) {
        // Reverse iterate over selectors
        for ( let i = this.selectors_.length - 1; i >= 0; i-- ) {
            const selector = this.selectors_[i];
            if ( selector instanceof cls ) {
                return selector;
            }
        }

        if ( cls.implyFromFetchedData ) {
            return cls.implyFromFetchedData(this);
        }

        return null;
    }

    get_optimal_selector () {
        for ( const cls of FSNodeContext.SELECTOR_PRIORITY_ORDER ) {
            const selector = this.get_selector_of_type(cls);
            if ( selector ) return selector;
        }
        this.log.warn('Failed to get optimal selector');
        return this.selector_;
    }

    get isRoot () {
        return this.path === '/';
    }

    async isUserDirectory () {
        if ( this.isRoot ) return false;
        if ( this.found === undefined ) {
            await this.fetchEntry();
        }
        if ( this.isRoot ) return false;
        if ( this.found === false ) return undefined;
        return ! this.entry.parent_uid;
    }

    async isAppDataDirectory () {
        if ( this.isRoot ) return false;
        if ( this.found === undefined ) {
            await this.fetchEntry();
        }
        if ( this.isRoot ) return false;

        const components = await this.getPathComponents();
        if ( components.length < 2 ) return false;
        return components[1] === 'AppData';
    }
    
    async isPublic () {
        if ( this.isRoot ) return false;
        const components = await this.getPathComponents();
        if ( await this.isUserDirectory() ) return false;
        if ( components[1] === 'Public' ) return true;
        return false;
    }
    
    async getPathComponents () {
        if ( this.isRoot ) return [];

        // We can get path components for non-existing nodes if they
        // have a path selector
        if ( ! await this.exists() ) {
            if ( this.selector instanceof NodePathSelector ) {
                let path = this.selector.value;
                if ( path.startsWith('/') ) path = path.slice(1);
                return path.split('/');
            }

            // TODO: add support for NodeChildSelector as well
        }

        let path = await this.get('path');
        if ( path.startsWith('/') ) path = path.slice(1);
        return path.split('/');
    }
    
    async getUserPart () {
        if ( this.isRoot ) return;
        const components = await this.getPathComponents();
        return components[0];
    }

    async getPathSize () {
        if ( this.isRoot ) return;
        const components = await this.getPathComponents();
        return components.length;
    }
    
    async exists (fetch_options = {}) {
        await this.fetchEntry();
        if ( ! this.found ) {
            this.log.debug(
                'here\'s why it doesn\'t exist: ' +
                this.selector.describe() + ' -> ' +
                this.uid + ' ' +
                JSON.stringify(this.entry, null, '  ')
            );
        }
        return this.found;
    }

    async fetchPath () {
        if ( this.path ) return;

        this.path = await this.services.get('information')
            .with('fs.fsentry')
            .obtain('fs.fsentry:path')
            .exec(this.entry);
    }

    /**
     * Fetches the filesystem entry associated with a
     * filesystem node identified by a path or UID.
     *
     * If a UID exists, the path is ignored.
     * If neither a UID nor a path is set, an error is thrown.
     *
     * @param {*} fsEntryFetcher fetches the filesystem entry
     * @void
     */
    async fetchEntry (fetch_entry_options = {}) {
        if (
            this.found === true &&
            ! fetch_entry_options.force &&
            (
                // thumbnail already fetched, or not asked for
                ! fetch_entry_options.thumbnail || this.entry?.thumbnail ||
                this.found_thumbnail !== undefined
            )
        ) {
            return;
        }

        const controls = {
            log: this.log,
            provide_selector: selector => {
                this.selector = selector;
            },
        };

        this.log.info('fetching entry: ' + this.selector.describe());

        const entry = await this.provider.stat({
            selector: this.selector,
            options: fetch_entry_options,
            node: this,
            controls,
        });

        if ( entry === null ) {
            this.found = false;
            this.entry = false;
        } else {
            this.found = true;

            if ( ! this.uid && entry.uuid ) {
                this.uid = entry.uuid;
            }

            if ( ! this.mysql_id && entry.id ) {
                this.mysql_id = entry.id;
            }

            if ( ! this.path && entry.path ) {
                this.path = entry.path;
            }

            if ( ! this.name && entry.name ) {
                this.name = entry.name;
            }

            Object.assign(this.entry, entry);
        }
    }

    /**
     * Wait for an fsentry which might be enqueued for insertion
     * into the database.
     *
     * This just calls ResourceService under the hood.
     */
    async awaitStableEntry () {
        const resourceService = Context.get('services').get('resourceService');
        await resourceService.waitForResource(this.selector);
    }

    /**
     * Fetches the subdomains associated with a directory or file
     * and stores them on the `subdomains` property of the fsentry.
     * @param {object} user the user is needed to query subdomains
     * @param {bool} force fetch subdomains if they were already fetched
     *
     * @param fs:decouple-subdomains
     */
    async fetchSubdomains (user, force) {
        if ( ! this.entry.is_dir ) return;

        const db = this.services.get('database').get(DB_READ, 'filesystem');

        this.entry.subdomains = []
        let subdomains = await db.read(
            `SELECT * FROM subdomains WHERE root_dir_id = ? AND user_id = ?`,
            [this.entry.id, user.id]
        );
        if(subdomains.length > 0){
            subdomains.forEach((sd)=>{
                this.entry.subdomains.push({
                    subdomain: sd.subdomain,
                    address: config.protocol + '://' + sd.subdomain + "." + 'puter.site',
                    uuid: sd.uuid,
                })
            })
            this.entry.has_website = true;
        }
    }

    /**
     * Fetches the owner of a directory or file and stores it on the
     * `owner` property of the fsentry.
     * @param {bool} force fetch owner if it was already fetched
     */
    async fetchOwner (force) {
        if ( this.isRoot ) return;
        const owner = await get_user({ id: this.entry.user_id });
        this.entry.owner = {
            username: owner.username,
            email: owner.email,
        };
    }

    /**
     * Fetches shares, AKA "permissions", for a directory or file;
     * then, stores them on the `permissions` property
     * of the fsentry.
     * @param {bool} force fetch shares if they were already fetched
     */
    async fetchShares (force) {
        if (this.entry.shares && ! force ) return;
        
        const actor = Context.get('actor');
        if ( ! actor ) {
            this.entry.shares = { users: [], apps: [] };
            return;
        }
        
        if ( ! (actor.type instanceof UserActorType) ) {
            this.entry.shares = { users: [], apps: [] };
            return;
        }
        
        const svc_permission = this.services.get('permission');
        
        const permissions =
            await svc_permission.query_issuer_permissions_by_prefix(
                actor.type.user, `fs:${await this.get('uid')}:`);
                
        this.entry.shares = { users: [], apps: [] };

        for ( const user_perm of permissions.users ) {
            const access =
                PermissionUtil.split(user_perm.permission).slice(-1)[0];
            this.entry.shares.users.push({
                user: {
                    uid: user_perm.user.uuid,
                    username: user_perm.user.username,
                },
                access,
                permission: user_perm.permission,
            });
        }

        for ( const app_perm of permissions.apps ) {
            const access =
                PermissionUtil.split(app_perm.permission).slice(-1)[0];
            this.entry.shares.apps.push({
                app: {
                    icon: app_perm.app.icon,
                    uid: app_perm.app.uid,
                    name: app_perm.app.name,
                },
                access,
                permission: app_perm.permission,
            });
        }
    }

    /**
     * Fetches versions associated with a filesystem entry,
     * then stores them on the `versions` property of
     * the fsentry.
     * @param {bool} force fetch versions if they were already fetched
     *
     * @todo fs:decouple-versions
     */
    async fetchVersions (force) {
        if ( this.entry.versions && ! force ) return;

        const db = this.services.get('database').get(DB_READ, 'filesystem');

        let versions = await db.read(
            `SELECT * FROM fsentry_versions WHERE fsentry_id = ?`,
            [this.entry.id]
        );
        const versions_tidy = [];
        for ( const version of versions ) {
            let username = version.user_id ? (await get_user({id: version.user_id})).username : null;
            versions_tidy.push({
                id: version.version_id,
                message: version.message,
                timestamp: version.ts_epoch,
                user: {
                    username: username,
                }
            })
        }

        this.entry.versions = versions_tidy;
    }

    /**
     * Fetches the size of a file or directory if it was not
     * already fetched.
     */
    async fetchSize () {
        const { fsEntryService } = Context.get('services').values;

        // we already have the size for files
        if ( ! this.entry.is_dir ) {
            await this.fetchEntry();
            return this.entry.size;
        }

        this.entry.size = await fsEntryService.get_recursive_size(
            this.entry.uuid,
        );

        return this.entry.size;
    }

    async fetchSuggestedApps (user, force) {
        if ( this.entry.suggested_apps && ! force ) return;

        await this.fetchEntry();
        if ( ! this.entry ) return;

        this.entry.suggested_apps =
            await suggest_app_for_fsentry(this.entry, { user });
    }

    async fetchIsEmpty () {
        if ( ! this.entry ) return;
        if ( ! this.entry.is_dir ) return;
        if ( ! this.uid ) return;

        this.entry.is_empty = await is_empty(this.uid);
    }

    async fetchAll(fsEntryFetcher, user, force) {
        await this.fetchEntry({ thumbnail: true });
        await this.fetchSubdomains(user);
        await this.fetchOwner();
        await this.fetchShares();
        await this.fetchVersions();
        await this.fetchSize(user);
        await this.fetchSuggestedApps(user);
        await this.fetchIsEmpty();
    }

    async get (key) {
        /*
            This isn't supposed to stay like this!

            """ if ( key === something ) return this """

                         ^ we should use a map of getters instead

            Ideally I'd like to make a class trait for classes like
            FSNodeContext that provide a key-value facade to access
            information about some entity.
        */

        if ( this.found === false ) {
            throw new Error(
                `Tried to get ${key} of non-existent fsentry: ` +
                this.selector.describe(true)
            );
        }

        if ( key === 'entry' ) {
            await this.fetchEntry();
            if ( this.found === false ) {
                throw new Error(
                    `Tried to get entry of non-existent fsentry: ` +
                    this.selector.describe(true)
                );
            }
            return this.entry;
        }

        if ( key === 'path' ) {
            if ( ! this.path ) await this.fetchEntry();
            if ( this.found === false ) {
                throw new Error(
                    `Tried to get path of non-existent fsentry: ` +
                    this.selector.describe(true)
                );
            }
            if ( ! this.path ) {
                await this.fetchPath();
            }
            if ( ! this.path ) {
                throw new Error(`failed to get path`);
            }
            return this.path;
        }

        if ( key === 'uid' ) {
            await this.fetchEntry();
            return this.uid;
        }

        if ( key === 'mysql-id' ) {
            await this.fetchEntry();
            return this.mysql_id;
        }

        const values_from_entry = ['immutable', 'user_id', 'name', 'size', 'parent_uid', 'metadata'];
        for ( const k of values_from_entry ) {
            if ( key === k ) {
                await this.fetchEntry();
                if ( this.found === false ) {
                    throw new Error(
                        `Tried to get ${key} of non-existent fsentry: ` +
                        this.selector.describe(true)
                    );
                }
                return this.entry[k];
            }
        }

        if ( key === 'type' ) {
            await this.fetchEntry();

            // Longest ternary operator chain I've ever written?
            return this.entry.is_shortcut
                ? FSNodeContext.TYPE_SHORTCUT
                : this.entry.is_symlink
                    ? FSNodeContext.TYPE_SYMLINK
                    : this.entry.is_dir
                        ? FSNodeContext.TYPE_DIRECTORY
                        : FSNodeContext.TYPE_FILE;
        }

        if ( key === 'has-s3' ) {
            await this.fetchEntry();
            if ( this.entry.is_dir ) return false;
            if ( this.entry.is_shortcut ) return false;
            return true;
        }

        if ( key === 's3:location' ) {
            await this.fetchEntry();
            if ( ! await this.exists() ) {
                throw new Error('file does not exist');
            }
            // return null for local filesystem
            if ( ! this.entry.bucket ) {
                return null;
            }
            return {
                bucket: this.entry.bucket,
                bucket_region: this.entry.bucket_region,
                key: this.entry.uuid,
            };
        }

        if ( key === 'is-root' ) {
            await this.fetchEntry();
            return this.isRoot;
        }
        
        if ( key === 'writable' ) {
            const actor = Context.get('actor');
            if ( !actor || !actor.type.user ) return undefined;
            const svc_acl = this.services.get('acl');
            return await svc_acl.check(actor, this, 'write');
        }

        throw new Error(`unrecognize key for FSNodeContext.get: ${key}`);
    }

    async getParent () {
        if ( this.isRoot ) {
            throw new Error('tried to get parent of root');
        }

        if ( this.path ) {
            const parent_fsNode = await this.fs.node({
                path: _path.dirname(this.path),
            })
            return parent_fsNode;
        }

        if ( this.selector instanceof NodeChildSelector ) {
            return this.fs.node(this.selector.parent);
        }

        if ( ! await this.exists() ) {
            throw new Error('unable to get parent');
        }

        const parent_uid = this.entry.parent_uid;

        if ( ! parent_uid ) {
            return this.fs.node(new RootNodeSelector());
        }

        return this.fs.node(new NodeUIDSelector(parent_uid));
    }

    async getChild (name) {
        // If we have a path, we can get an FSNodeContext for the child
        // without fetching anything.
        if ( this.path ) {
            const child_fsNode = await this.fs.node({
                path: _path.join(this.path, name),
            })
            return child_fsNode;
        }

        return await this.fs.node(new NodeChildSelector(
            this.selector, name));
    }

    async getTarget () {
        await this.fetchEntry();
        const type = await this.get('type');

        if ( type === FSNodeContext.TYPE_SYMLINK ) {
            const path = await this.entry.symlink_path;
            return await this.fs.node({ path });
        }

        if ( type === FSNodeContext.TYPE_SHORTCUT ) {
            const target_id = await this.entry.shortcut_to;
            return await this.fs.node({ mysql_id: target_id });
        }

        return this;
    }

    async is_above (child_fsNode) {
        if ( this.isRoot ) return true;

        const path_this = await this.get('path');
        const path_child = await child_fsNode.get('path');

        return path_child.startsWith(path_this + '/');
    }

    async is (fsNode) {
        if ( this.mysql_id && fsNode.mysql_id ) {
            return this.mysql_id === fsNode.mysql_id;
        }

        if ( this.uid && fsNode.uid ) {
            return this.uid === fsNode.uid;
        }

        await this.fetchEntry();
        await fsNode.fetchEntry();
        return this.uid === fsNode.uid;
    }

    async getSafeEntry (fetch_options = {}) {
        if ( this.found === false ) {
            throw new Error(
                `Tried to get entry of non-existent fsentry: ` +
                this.selector.describe(true)
            );
        }
        await this.fetchEntry(fetch_options);

        const res = this.entry;
        const fsentry = {};

        // This property will not be serialized, but it can be checked
        // by other code to verify that API calls do not send
        // unsanitized filsystem entries.
        Object.defineProperty(fsentry, '__is_safe__', {
            enumerable: false,
            value: true,
        });

        for ( const k in res ) {
            fsentry[k] = res[k];
        }

        let actor; try {
            actor = Context.get('actor');
        } catch (e) {}
        if ( ! actor?.type?.user || actor.type.user.id !== res.user_id ) {
            if ( ! fsentry.owner ) await this.fetchOwner();
            fsentry.owner = {
                username: res.owner?.username,
            };
        }

        const info = this.services.get('information');

        if ( ! this.uid && ! this.entry.uuid ) {
            this.log.noticeme(
                'whats even happening!?!? ' +
                    this.selector.describe() + ' ' +
                    JSON.stringify(this.entry, null, '  ')
            );
        }

        // If fsentry was found by a path but the entry doesn't
        // have a path, use the path that was used to find it.
        fsentry.path = res.path ?? this.path ?? await info
            .with('fs.fsentry:uuid')
            .obtain('fs.fsentry:path')
            .exec(this.uid ?? this.entry.uuid);
        
        if ( fsentry.path && fsentry.path.startsWith('/-void/') ) {
            fsentry.broken = true;
        }

        fsentry.dirname = _path.dirname(fsentry.path);
        fsentry.dirpath = fsentry.dirname;
        fsentry.writable = await this.get('writable');

        // Do not send internal IDs to clients
        fsentry.id = res.uuid;
        fsentry.parent_id = res.parent_uid;
        // The client calls it uid, not uuid.
        fsentry.uid = res.uuid;
        delete fsentry.uuid;
        delete fsentry.user_id;
        if ( fsentry.suggested_apps ) {
            for ( const app of fsentry.suggested_apps ) {
                if ( app === null ) {
                    this.log.warn('null app');
                    continue;
                }
                delete app.owner_user_id;
            }
        }

        // Do not send S3 bucket information to clients
        delete fsentry.bucket;
        delete fsentry.bucket_region;

        // Use client-friendly IDs for shortcut_to
        fsentry.shortcut_to = (res.shortcut_to
            ? await id2uuid(res.shortcut_to) : undefined);
        try {
            fsentry.shortcut_to_path = (res.shortcut_to
                ? await id2path(res.shortcut_to) : undefined);
        } catch (e) {
            fsentry.shortcut_invalid = true;
            fsentry.shortcut_uid = res.shortcut_to;
        }

        // Add file_request_url
        if(res.file_request_token && res.file_request_token !== ''){
            fsentry.file_request_url  = config.origin +
                '/upload?token=' + res.file_request_token;
        }

        if ( fsentry.associated_app_id ) {
            const app = await get_app({ id: fsentry.associated_app_id });
            fsentry.associated_app = app;
        }

        fsentry.is_dir = !! fsentry.is_dir;

        // Ensure `size` is numeric
        if ( fsentry.size ) {
            fsentry.size = parseInt(fsentry.size);
        }

        return fsentry;
    }

    static sanitize_pending_entry_info (res) {
        const fsentry = {};

        // This property will not be serialized, but it can be checked
        // by other code to verify that API calls do not send
        // unsanitized filsystem entries.
        Object.defineProperty(fsentry, '__is_safe__', {
            enumerable: false,
            value: true,
        });

        for ( const k in res ) {
            fsentry[k] = res[k];
        }

        fsentry.dirname = _path.dirname(fsentry.path);

        // Do not send internal IDs to clients
        fsentry.id = res.uuid;
        fsentry.parent_id = res.parent_uid;
        // The client calls it uid, not uuid.
        fsentry.uid = res.uuid;

        delete fsentry.uuid;
        delete fsentry.user_id;

        // Do not send S3 bucket information to clients
        delete fsentry.bucket;
        delete fsentry.bucket_region;

        delete fsentry.shortcut_to;
        delete fsentry.shortcut_to_path;

        return fsentry;
    }
}
