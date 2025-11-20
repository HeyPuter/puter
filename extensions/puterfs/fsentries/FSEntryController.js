import BaseOperation from './BaseOperation.js';
import Delete from './Delete.js';
import Insert from './Insert.js';
import Update from './Update.js';

const { db } = extension.import('data');
const svc_params = extension.import('service:params');
const svc_info = extension.import('service:information');

const { PuterPath } = extension.import('fs');

const { Context } = extension.import('core');

const {
    RootNodeSelector,
    NodeChildSelector,
    NodeUIDSelector,
    NodePathSelector,
    NodeInternalIDSelector,
} = extension.import('core').fs.selectors;

export default class {
    static CONCERN = 'filesystem';

    static STATUS_READY = {};
    static STATUS_RUNNING_JOB = {};

    constructor () {
        this.status = this.constructor.STATUS_READY;

        this.currentState = {
            queue: [],
            updating_uuids: {},
        };
        this.deferredState = {
            queue: [],
            updating_uuids: {},
        };

        this.entryListeners_ = {};

        this.mkPromiseForQueueSize_();

        // this list of properties is for read operations
        // (originally in FSEntryFetcher)
        this.defaultProperties = [
            'id',
            'associated_app_id',
            'uuid',
            'public_token',
            'bucket',
            'bucket_region',
            'file_request_token',
            'user_id',
            'parent_uid',
            'is_dir',
            'is_public',
            'is_shortcut',
            'is_symlink',
            'symlink_path',
            'shortcut_to',
            'sort_by',
            'sort_order',
            'immutable',
            'name',
            'metadata',
            'modified',
            'created',
            'accessed',
            'size',
            'layout',
            'path',
        ];
    }

    init () {
        svc_params.createParameters('fsentry-service', [
            {
                id: 'max_queue',
                description: 'Maximum queue size',
                default: 50,
            },
        ], this);

        // Register information providers

        // uuid -> path via mysql
        svc_info.given('fs.fsentry:uuid').provide('fs.fsentry:path')
            .addStrategy('mysql', async uuid => {
                // TODO: move id2path here
                try {
                    return await id2path(uuid);
                } catch (e) {
                    console.error('DASH VOID ERROR !!', e);
                    return `/-void/${ uuid}`;
                }
            });
    }

    mkPromiseForQueueSize_ () {
        this.queueSizePromise = new Promise((resolve, reject) => {
            this.queueSizeResolve = resolve;
        });
    }

    // #region write operations
    async insert (entry) {
        const op = new Insert(entry);
        await this.enqueue_(op);
        return op;
    }

    async update (uuid, entry) {
        const op = new Update(uuid, entry);
        await this.enqueue_(op);
        return op;
    }

    async delete (uuid) {
        const op = new Delete(uuid);
        await this.enqueue_(op);
        return op;
    }
    // #endregion

    // #region read operations
    async fast_get_descendants (uuid) {
        return (await db.read(`
            WITH RECURSIVE descendant_cte AS (
                SELECT uuid, parent_uid
                FROM fsentries
                WHERE parent_uid = ?

                UNION ALL

                SELECT f.uuid, f.parent_uid
                FROM fsentries f
                INNER JOIN descendant_cte d ON f.parent_uid = d.uuid
            )
            SELECT uuid FROM descendant_cte
        `, [uuid])).map(x => x.uuid);
    }

    async fast_get_direct_descendants (uuid) {
        return (uuid === PuterPath.NULL_UUID
            ? await db.read('SELECT uuid FROM fsentries WHERE parent_uid IS NULL')
            : await db.read('SELECT uuid FROM fsentries WHERE parent_uid = ?',
                            [uuid])).map(x => x.uuid);
    }

    waitForEntry (node, callback) {
        // *** uncomment to debug slow waits ***
        // console.log('ATTEMPT TO WAIT FOR', selector.describe())
        let selector = node.get_selector_of_type(NodeUIDSelector);
        if ( selector === null ) {
            // console.log(new Error('========'));
            return;
        }

        const entry_already_enqueued =
            this.currentState.updating_uuids.hasOwnProperty(selector.value) ||
            this.deferredState.updating_uuids.hasOwnProperty(selector.value) ;

        if ( entry_already_enqueued ) {
            callback();
            return;
        }

        const k = `uid:${selector.value}`;
        if ( ! this.entryListeners_.hasOwnProperty(k) ) {
            this.entryListeners_[k] = [];
        }

        const det = {
            detach: () => {
                const i = this.entryListeners_[k].indexOf(callback);
                if ( i === -1 ) return;
                this.entryListeners_[k].splice(i, 1);
                if ( this.entryListeners_[k].length === 0 ) {
                    delete this.entryListeners_[k];
                }
            },
        };

        this.entryListeners_[k].push(callback);

        return det;
    }

    async get (uuid, fetch_entry_options) {
        const answer = {};
        for ( const op of this.currentState.queue ) {
            if ( op.uuid != uuid ) continue;
            op.apply(answer);
        }
        for ( const op of this.deferredState.queue ) {
            if ( op.uuid != uuid ) continue;
            op.apply(answer);
            op.apply(answer);
        }
        if ( answer.is_diff ) {
            const base_entry = await this.find(new NodeUIDSelector(uuid),
                            fetch_entry_options);
            answer.entry = { ...base_entry, ...answer.entry };
        }
        return answer.entry;
    }

    async get_descendants (uuid) {
        return uuid === PuterPath.NULL_UUID
            ? await db.read('SELECT uuid FROM fsentries WHERE parent_uid IS NULL',
                            [uuid])
            : await db.read('SELECT uuid FROM fsentries WHERE parent_uid = ?',
                            [uuid])
        ;
    }

    async get_recursive_size (uuid) {
        const cte_query = `
            WITH RECURSIVE descendant_cte AS (
                SELECT uuid, parent_uid, size
                FROM fsentries
                WHERE parent_uid = ?

                UNION ALL

                SELECT f.uuid, f.parent_uid, f.size
                FROM fsentries f
                INNER JOIN descendant_cte d
                ON f.parent_uid = d.uuid
            )
            SELECT SUM(size) AS total_size FROM descendant_cte
        `;
        const rows = await db.read(cte_query, [uuid]);
        return rows[0].total_size;
    }

    /**
     * Finds a filesystem entry using the provided selector.
     * @param {Object} selector - The selector object specifying how to find the entry
     * @param {Object} fetch_entry_options - Options for fetching the entry
     * @returns {Promise<Object|null>} The filesystem entry or null if not found
     */
    async find (selector, fetch_entry_options) {
        if ( selector instanceof RootNodeSelector ) {
            return selector.entry;
        }
        if ( selector instanceof NodePathSelector ) {
            return await this.findByPath(selector.value, fetch_entry_options);
        }
        if ( selector instanceof NodeUIDSelector ) {
            return await this.findByUID(selector.value, fetch_entry_options);
        }
        if ( selector instanceof NodeInternalIDSelector ) {
            return await this.findByID(selector.id, fetch_entry_options);
        }
        if ( selector instanceof NodeChildSelector ) {
            let id;

            if ( selector.parent instanceof RootNodeSelector ) {
                id = await this.findNameInRoot(selector.name);
            } else {
                const parentEntry = await this.find(selector.parent);
                if ( ! parentEntry ) return null;
                id = await this.findNameInParent(parentEntry.uuid, selector.name);
            }

            if ( id === undefined ) return null;
            if ( typeof id !== 'number' ) {
                throw new Error('unexpected type for id value',
                                typeof id,
                                id);
            }
            return this.find(new NodeInternalIDSelector('mysql', id));
        }
    }

    /**
     * Finds a filesystem entry by its UUID.
     * @param {string} uuid - The UUID of the entry to find
     * @param {Object} fetch_entry_options - Options including thumbnail flag
     * @returns {Promise<Object|undefined>} The filesystem entry or undefined if not found
     */
    async findByUID (uuid, fetch_entry_options = {}) {
        const { thumbnail } = fetch_entry_options;

        let fsentry = await db.tryHardRead(`SELECT ${
            this.defaultProperties.join(', ')
        }${thumbnail ? ', thumbnail' : ''
        } FROM fsentries WHERE uuid = ? LIMIT 1`,
        [uuid]);

        return fsentry[0];
    }

    /**
     * Finds a filesystem entry by its internal database ID.
     * @param {number} id - The internal ID of the entry to find
     * @param {Object} fetch_entry_options - Options including thumbnail flag
     * @returns {Promise<Object|undefined>} The filesystem entry or undefined if not found
     */
    async findByID (id, fetch_entry_options = {}) {
        const { thumbnail } = fetch_entry_options;

        let fsentry = await db.tryHardRead(`SELECT ${
            this.defaultProperties.join(', ')
        }${thumbnail ? ', thumbnail' : ''
        } FROM fsentries WHERE id = ? LIMIT 1`,
        [id]);

        return fsentry[0];
    }

    /**
     * Finds a filesystem entry by its full path.
     * @param {string} path - The full path of the entry to find
     * @param {Object} fetch_entry_options - Options including thumbnail flag and tracer
     * @returns {Promise<Object|false>} The filesystem entry or false if not found
     */
    async findByPath (path, fetch_entry_options = {}) {
        const { thumbnail } = fetch_entry_options;

        if ( path === '/' ) {
            return this.find(new RootNodeSelector());
        }

        const parts = path.split('/').filter(path => path !== '');
        if ( parts.length === 0 ) {
            // TODO: invalid path; this should be an error
            return false;
        }

        // TODO: use a closure table for more efficient path resolving
        let parent_uid = null;
        let result;

        const resultColsSql = this.defaultProperties.join(', ') +
            (thumbnail ? ', thumbnail' : '');

        result = await db.read(`SELECT ${ resultColsSql
        } FROM fsentries WHERE path=? LIMIT 1`,
        [path]);

        // using knex instead

        if ( result[0] ) return result[0];

        const loop = async () => {
            for ( let i = 0 ; i < parts.length ; i++ ) {
                const part = parts[i];
                const isLast = i == parts.length - 1;
                const colsSql = isLast ? resultColsSql : 'uuid';
                if ( parent_uid === null ) {
                    result = await db.read(`SELECT ${ colsSql
                    } FROM fsentries WHERE parent_uid IS NULL AND name=? LIMIT 1`,
                    [part]);
                } else {
                    result = await db.read(`SELECT ${ colsSql
                    } FROM fsentries WHERE parent_uid=? AND name=? LIMIT 1`,
                    [parent_uid, part]);
                }

                if ( ! result[0] ) return false;
                parent_uid = result[0].uuid;
            }
        };

        if ( fetch_entry_options.tracer ) {
            const tracer = fetch_entry_options.tracer;
            const options = fetch_entry_options.trace_options;
            await tracer.startActiveSpan('fs:sql:findByPath',
                            ...(options ? [options] : []),
                            async span => {
                                await loop();
                                span.end();
                            });
        } else {
            await loop();
        }

        return result[0];
    }

    /**
     * Finds the ID of a child entry with the given name in the root directory.
     * @param {string} name - The name of the child entry to find
     * @returns {Promise<number|undefined>} The ID of the child entry or undefined if not found
     */
    async findNameInRoot (name) {
        let child_id = await db.read('SELECT `id` FROM `fsentries` WHERE `parent_uid` IS NULL AND name = ? LIMIT 1',
                        [name]);
        return child_id[0]?.id;
    }

    /**
     * Finds the ID of a child entry with the given name under a specific parent.
     * @param {string} parent_uid - The UUID of the parent directory
     * @param {string} name - The name of the child entry to find
     * @returns {Promise<number|undefined>} The ID of the child entry or undefined if not found
     */
    async findNameInParent (parent_uid, name) {
        let child_id = await db.read('SELECT `id` FROM `fsentries` WHERE `parent_uid` = ? AND name = ? LIMIT 1',
                        [parent_uid, name]);
        return child_id[0]?.id;
    }

    /**
     * Checks if an entry with the given name exists under a specific parent.
     * @param {string} parent_uid - The UUID of the parent directory
     * @param {string} name - The name to check for
     * @returns {Promise<boolean>} True if the name exists under the parent, false otherwise
     */
    async nameExistsUnderParent (parent_uid, name) {
        let check_dupe = await db.read('SELECT `id` FROM `fsentries` WHERE `parent_uid` = ? AND name = ? LIMIT 1',
                        [parent_uid, name]);
        return !!check_dupe[0];
    }

    /**
     * Checks if an entry with the given name exists under a parent specified by ID.
     * @param {number} parent_id - The internal ID of the parent directory
     * @param {string} name - The name to check for
     * @returns {Promise<boolean>} True if the name exists under the parent, false otherwise
     */
    async nameExistsUnderParentID (parent_id, name) {
        const parent = await this.findByID(parent_id);
        if ( ! parent ) {
            return false;
        }
        return this.nameExistsUnderParent(parent.uuid, name);
    }
    // #endregion

    // #region queue logic
    async enqueue_ (op) {
        while (
            this.currentState.queue.length > this.max_queue ||
            this.deferredState.queue.length > this.max_queue
        ) {
            await this.queueSizePromise;
        }

        if ( ! (op instanceof BaseOperation) ) {
            throw new Error('Invalid operation');
        }

        const state = this.status === this.constructor.STATUS_READY ?
            this.currentState : this.deferredState;

        if ( ! state.updating_uuids.hasOwnProperty(op.uuid) ) {
            state.updating_uuids[op.uuid] = [];
        }
        state.updating_uuids[op.uuid].push(state.queue.length);

        state.queue.push(op);

        // DRY: same pattern as FSOperationContext:provideValue
        // DRY: same pattern as FSOperationContext:rejectValue
        if ( this.entryListeners_.hasOwnProperty(op.uuid) ) {
            const listeners = this.entryListeners_[op.uuid];

            delete this.entryListeners_[op.uuid];

            for ( const lis of listeners ) lis();
        }

        this.checkShouldExec_();
    }

    checkShouldExec_ () {
        if ( this.status !== this.constructor.STATUS_READY ) return;
        if ( this.currentState.queue.length === 0 ) return;
        this.exec_();
    }

    async exec_ () {
        if ( this.status !== this.constructor.STATUS_READY ) {
            throw new Error('Duplicate exec_ call');
        }

        const queue = this.currentState.queue;

        this.status = this.constructor.STATUS_RUNNING_JOB;

        // const conn = await db_primary.promise().getConnection();
        // await conn.beginTransaction();

        for ( const op of queue ) {
            op.status = op.constructor.STATUS_RUNNING;
            // await conn.execute(stmt, values);
        }

        // await conn.commit();
        // conn.release();

        // const stmtAndVals = queue.map(op => op.getStatementAndValues());
        // const stmts = stmtAndVals.map(x => x.stmt).join('; ');
        // const vals = stmtAndVals.reduce((acc, x) => acc.concat(x.values), []);

        // *** uncomment to debug batch queries ***
        // this.log.debug({ stmts, vals });
        // console.log('<<========================');
        // console.log({ stmts, vals });
        // console.log('>>========================');

        // this.log.debug('array?', Array.isArray(vals))

        await db.batch_write(queue.map(op => op.getStatement()));

        for ( const op of queue ) {
            op.status = op.constructor.STATUS_DONE;
        }

        this.flipState_();
        this.status = this.constructor.STATUS_READY;

        for ( const op of queue ) {
            op.status = op.constructor.STATUS_DONE;
        }

        this.checkShouldExec_();
    }

    flipState_ () {
        this.currentState = this.deferredState;
        this.deferredState = {
            queue: [],
            updating_uuids: {},
        };
        const queueSizeResolve = this.queueSizeResolve;
        this.mkPromiseForQueueSize_();
        queueSizeResolve();
    }
    // #endregion
}