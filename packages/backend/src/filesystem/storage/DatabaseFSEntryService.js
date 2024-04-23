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
const { id2path } = require("../../helpers");

const { PuterPath } = require("../lib/PuterPath");
const { NodeUIDSelector } = require("../node/selectors");
const { OtelTrait } = require("../../traits/OtelTrait");
const { Context } = require("../../util/context");
const { DB_WRITE } = require("../../services/database/consts");

class AbstractDatabaseFSEntryOperation {
    static STATUS_PENDING = {};
    static STATUS_RUNNING = {};
    static STATUS_DONE = {};
    constructor () {
        this.status_ = this.constructor.STATUS_PENDING;
        this.donePromise = new Promise((resolve, reject) => {
            this.doneResolve = resolve;
            this.doneReject = reject;
        });
    }
    get status () {
        return this.status_;
    }
    set status (status) {
        this.status_ = status;
        if ( status === this.constructor.STATUS_DONE ) {
            this.doneResolve();
        }
    }
    awaitDone () {
        return this.donePromise;
    }
    onComplete(fn) {
        this.donePromise.then(fn);
    }
}

class DatabaseFSEntryInsert extends AbstractDatabaseFSEntryOperation {
    static requiredForCreate = [
        'uuid',
        'parent_uid',
    ];

    static allowedForCreate = [
        ...this.requiredForCreate,
        'name',
        'user_id',
        'is_dir',
        'created',
        'modified',
        'immutable',
        'shortcut_to',
        'is_shortcut',
        'metadata',
        'bucket',
        'bucket_region',
        'thumbnail',
        'accessed',
        'size',
        'symlink_path',
        'is_symlink',
        'associated_app_id',
        'path',
    ];

    constructor (entry) {
        super();
        const requiredForCreate = this.constructor.requiredForCreate;
        const allowedForCreate = this.constructor.allowedForCreate;

        {
            const sanitized_entry = {};
            for ( const k of allowedForCreate ) {
                if ( entry.hasOwnProperty(k) ) {
                    sanitized_entry[k] = entry[k];
                }
            }
            entry = sanitized_entry;
        }

        for ( const k of requiredForCreate ) {
            if ( ! entry.hasOwnProperty(k) ) {
                throw new Error(`Missing required property: ${k}`);
            }
        }

        this.entry = entry;
    }

    getStatement () {
        const fields = Object.keys(this.entry);
        const statement = `INSERT INTO fsentries ` +
            `(${fields.join(', ')}) ` +
            `VALUES (${fields.map(() => '?').join(', ')})`;
        const values = fields.map(k => this.entry[k]);
        return { statement, values };
    }

    apply (answer) {
        answer.entry = { ...this.entry };
    }

    get uuid () {
        return this.entry.uuid;
    }
}

class DatabaseFSEntryUpdate extends AbstractDatabaseFSEntryOperation {
    static allowedForUpdate = [
        'name',
        'parent_uid',
        'user_id',
        'modified',
        'shortcut_to',
        'metadata',
        'thumbnail',
        'size',
        'path',
    ];

    constructor (uuid, entry) {
        super();
        const allowedForUpdate = this.constructor.allowedForUpdate;

        {
            const sanitized_entry = {};
            for ( const k of allowedForUpdate ) {
                if ( entry.hasOwnProperty(k) ) {
                    sanitized_entry[k] = entry[k];
                }
            }
            entry = sanitized_entry;
        }

        this.uuid = uuid;
        this.entry = entry;
    }

    getStatement () {
        const fields = Object.keys(this.entry);
        const statement = `UPDATE fsentries SET ` +
            `${fields.map(k => `${k} = ?`).join(', ')} ` +
            `WHERE uuid = ? LIMIT 1`;
        const values = fields.map(k => this.entry[k]);
        values.push(this.uuid);
        return { statement, values };
    }

    apply (answer) {
        if ( ! answer.entry ) {
            answer.is_diff = true;
            answer.entry = {};
        }
        Object.assign(answer.entry, this.entry);
    }
}

class DatabaseFSEntryDelete extends AbstractDatabaseFSEntryOperation {
    constructor (uuid) {
        super();
        this.uuid = uuid;
    }

    getStatement () {
        const statement = `DELETE FROM fsentries WHERE uuid = ? LIMIT 1`;
        const values = [this.uuid];
        return { statement, values };
    }

    apply (answer) {
        answer.entry = null;
    }
}


class DatabaseFSEntryService extends AdvancedBase {
    static STATUS_READY = {};
    static STATUS_RUNNING_JOB = {};

    static TRAITS = [
        new OtelTrait([
            'insert',
            'update',
            'delete',
            'fast_get_descendants',
            'fast_get_direct_descendants',
            'get',
            'get_descendants',
            'get_recursive_size',
            'enqueue_',
            'checkShouldExec_',
            'exec_',
        ]),
    ]

    constructor ({ services, label }) {
        super();
        this.db = services.get('database').get(DB_WRITE, 'filesystem');

        this.log = services.get('log-service').create('fsentry-service');

        this.label = label || 'DatabaseFSEntryService';

        const params = services.get('params');
        params.createParameters('fsentry-service', [
            {
                id: 'max_queue',
                description: 'Maximum queue size',
                default: 50,
            },
        ], this);

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

        // Register information providers
        const info = services.get('information');

        // uuid -> path via mysql
        info.given('fs.fsentry:uuid').provide('fs.fsentry:path')
            .addStrategy('mysql', async uuid => {
                // TODO: move id2path here
                return await id2path(uuid);
            });

        (async () => {
            await services.ready;
            if ( services.has('commands') ) {
                this._registerCommands(services.get('commands'));
            }
        })();
    }

    mkPromiseForQueueSize_ () {
        this.queueSizePromise = new Promise((resolve, reject) => {
            this.queueSizeResolve = resolve;
        });
    }

    async insert (entry) {
        const op = new DatabaseFSEntryInsert(entry);
        await this.enqueue_(op);
        return op;
    }

    async update (uuid, entry) {
        const op = new DatabaseFSEntryUpdate(uuid, entry);
        await this.enqueue_(op);
        return op;
    }

    async delete (uuid) {
        const op = new DatabaseFSEntryDelete(uuid);
        await this.enqueue_(op);
        return op;
    }

    async fast_get_descendants (uuid) {
        return (await this.db.read(`
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
            ? await this.db.read(
                `SELECT uuid FROM fsentries WHERE parent_uid IS NULL`)
            : await this.db.read(
                `SELECT uuid FROM fsentries WHERE parent_uid = ?`,
                [uuid])).map(x => x.uuid);
    }

    waitForEntry (node, callback) {
        // *** uncomment to debug slow waits ***
        // console.log('ATTEMPT TO WAIT FOR', selector.describe())
        let selector = node.get_selector_of_type(NodeUIDSelector);
        if ( selector === null ) {
            this.log.debug('cannot wait for this selector');
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
            }
        };

        this.entryListeners_[k].push(callback);

        return det;
    }

    async get (uuid, fetch_entry_options) {
        this.log.debug('--- finding ops for', { uuid })
        const answer = {};
        for ( const op of this.currentState.queue ) {
            if ( op.uuid != uuid ) continue;
            this.log.debug('=== found op!', { op });
            op.apply(answer);
        }
        for ( const op of this.deferredState.queue ) {
            if ( op.uuid != uuid ) continue;
            this.log.debug('=== found op**!', { op });
            op.apply(answer);
            op.apply(answer);
        }
        if ( answer.is_diff ) {
            const fsEntryFetcher = Context.get('services').get('fsEntryFetcher');
            const base_entry = await fsEntryFetcher.find(
                new NodeUIDSelector(uuid),
                fetch_entry_options,
            );
            answer.entry = { ...base_entry, ...answer.entry };
        }
        return answer.entry;
    }

    async get_descendants (uuid) {
        return uuid === PuterPath.NULL_UUID
            ? await this.db.read(
                `SELECT uuid FROM fsentries WHERE parent_uid IS NULL`,
                [uuid],
            )
            : await this.db.read(
                `SELECT uuid FROM fsentries WHERE parent_uid = ?`,
                [uuid],
            )
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
        const rows = await this.db.read(cte_query, [uuid]);
        return rows[0].total_size;
    }

    async enqueue_ (op) {
        while (
            this.currentState.queue.length > this.max_queue ||
            this.deferredState.queue.length > this.max_queue
        ) {
            await this.queueSizePromise;
        }

        if ( ! (op instanceof AbstractDatabaseFSEntryOperation) ) {
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

        this.log.info(
            `\x1B[36;1m[${this.label}]\x1B[0m ` +
            `Executing ${queue.length} operations...`
        );

        this.status = this.constructor.STATUS_RUNNING_JOB;

        // const conn = await this.db_primary.promise().getConnection();
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

        await this.db.batch_write(queue.map(op => op.getStatement()));


        for ( const op of queue ) {
            op.status = op.constructor.STATUS_DONE;
        }

        this.flipState_();
        this.status = this.constructor.STATUS_READY;

        this.log.info(
            `\x1B[36;1m[${this.label}]\x1B[0m ` +
            `Finished ${queue.length} operations.`
        )

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

    _registerCommands (commands) {
        commands.registerCommands('mysql-fsentry-service', [
            {
                id: 'get-queue-size-current',
                description: 'Get the current queue size',
                handler: async (args, log) => {
                    log.log(this.currentState.queue.length);
                }
            },
            {
                id: 'get-queue-size-deferred',
                description: 'Get the deferred queue size',
                handler: async (args, log) => {
                    log.log(this.deferredState.queue.length);
                }
            }
        ])
    }
}

module.exports = {
    DatabaseFSEntryService
};