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
const { AdvancedBase } = require('@heyputer/putility');
const PathResolver = require('../../routers/filesystem_api/batch/PathResolver');
const commands = require('./commands').commands;
const APIError = require('../../api/APIError');
const { Context } = require('../../util/context');
const config = require('../../config');
const { TeePromise } = require('@heyputer/putility').libs.promise;
const { WorkUnit } = require('../../modules/core/lib/expect');

class BatchExecutor extends AdvancedBase {
    constructor (x, { actor, log, errors }) {
        super();
        this.x = x;
        this.actor = actor
        this.pathResolver = new PathResolver({ actor });
        this.expectations = x.get('services').get('expectations');
        this.log = log;
        this.errors = errors;
        this.responsePromises = [];
        this.hasError = false;

        this.total_tbd = true;
        this.total = 0;
        this.counter = 0;

        this.concurrent_ops = 0;
        this.max_concurrent_ops = 20;
        this.ops_promise = null;
    }

    async ready_for_more () {
        if ( this.ops_promise === null ) {
            this.ops_promise = new TeePromise();
        }
        await this.ops_promise;
    }

    async exec_op (req, op, file) {
        while ( this.concurrent_ops >= this.max_concurrent_ops ) {
            await this.ready_for_more();
        }

        this.concurrent_ops++;
        if ( config.env == 'dev' ) {
            const wid = this.x.get('dev_batch-widget');
            wid.ops++;
        }

        const { expectations } = this;
        const command_cls = commands[op.op];
        console.log(command_cls, JSON.stringify(op, null, 2));
        delete op.op;

        const workUnit = WorkUnit.create();
        expectations.expect_eventually({
            workUnit,
            checkpoint: 'operation responded'
        });

        // TEMP: event service will handle this
        op.original_client_socket_id = req.body.original_client_socket_id;
        op.socket_id = req.body.socket_id;

        // run the operation
        let p = this.x.arun(async () => {
            const x= Context.get();
            if ( ! x ) throw new Error('no context');

            try {
                if ( ! command_cls ) {
                    throw APIError.create('invalid_operation', null, {
                        operation: op.op,
                    });
                }

                if ( file ) workUnit.checkpoint(
                    'about to run << ' +
                    (file.originalname ?? file.name) +
                    ' >> ' +
                    JSON.stringify(op)
                );
                const command_ins = await command_cls.run({
                    getFile: () => file,
                    pathResolver: this.pathResolver,
                    actor: this.actor,
                }, op);
                workUnit.checkpoint('operation invoked');

                const res = await command_ins.awaitValue('result');
                // const res = await opctx.awaitValue('response');
                workUnit.checkpoint('operation responded');
                return res;
            } catch (e) {
                this.hasError = true;
                if ( ! ( e instanceof APIError ) ) {
                    // TODO: alarm condition
                    this.errors.report('batch-operation', {
                        source: e,
                        trace: true,
                        alarm: true,
                    });

                    e = APIError.adapt(e); // eslint-disable-line no-ex-assign
                }

                // Consume stream if there's a file
                if ( file ) {
                    try {
                        // read entire stream
                        await new Promise((resolve, reject) => {
                            file.stream.on('end', resolve);
                            file.stream.on('error', reject);
                            file.stream.resume();
                        });
                    } catch (e) {
                        this.errors.report('batch-operation-2', {
                            source: e,
                            trace: true,
                            alarm: true,
                        });
                    }
                }

                if ( config.env == 'dev' ) {
                    console.error(e);
                    // process.exit(1);
                }

                const serialized_error = e.serialize();
                return serialized_error;
            } finally {
                if ( config.env == 'dev' ) {
                    const wid = x.get('dev_batch-widget');
                    wid.ops--;
                }
                this.concurrent_ops--;
                if ( this.ops_promise && this.concurrent_ops < this.max_concurrent_ops ) {
                    this.ops_promise.resolve();
                    this.ops_promise = null;
                }
            }
        });

        // decorate with logging
        p = p.then(result => {
            this.counter++;
            const { log, total, total_tbd, counter } = this;
            const total_str = total_tbd ? `TBD(>${total})` : `${total}`;
            log.noticeme(`Batch Progress: ${counter} / ${total_str} operations`);
            return result;
        });

        // this.responsePromises.push(p);

        // It doesn't really matter whether or not `await` is here
        // (that's a design flaw in the Promise API; what if you
        // want a promise that returns a promise?)
        const result = await p;
        return result;

    }
}

module.exports = {
    BatchExecutor,
};
