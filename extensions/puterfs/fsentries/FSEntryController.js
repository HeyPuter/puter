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
    NodeUIDSelector,
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
                    return `/-void/${ uuid}`;
                }
            });
    }

    mkPromiseForQueueSize_ () {
        this.queueSizePromise = new Promise((resolve, reject) => {
            this.queueSizeResolve = resolve;
        });
    }

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
            const fsEntryFetcher = Context.get('services').get('fsEntryFetcher');
            const base_entry = await fsEntryFetcher.find(new NodeUIDSelector(uuid),
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
}