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
const APIError = require("../../../api/APIError");
const eggspress = require("../../../api/eggspress");
const config = require("../../../config");
const { Context } = require("../../../util/context");
const Busboy = require('busboy');
const { BatchExecutor } = require("../../../filesystem/batch/BatchExecutor");
const { TeePromise } = require('@heyputer/putility').libs.promise;
const { MovingMode } = require("../../../util/opmath");
const { get_app } = require('../../../helpers');
const { valid_file_size } = require("../../../util/validutil");
const { OnlyOnceFn } = require("../../../util/fnutil.js");

module.exports = eggspress('/batch', {
    subdomain: 'api',
    verified: true,
    auth2: true,
    fs: true,
    // json: true,
    // files: ['file'],
    // multest: true,
    // multipart_jsons: ['operation'],
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const log = req.services.get('log-service').create('batch');
    const errors = req.services.get('error-service').create(log);

    const x = Context.get();
    x.set('dbrr_channel', 'batch');

    let app;
    if ( req.body.app_uid ) {
        app = await get_app({uid: req.body.app_uid})
    }

    const expected_metadata = {
        original_client_socket_id: undefined,
        socket_id: undefined,
        operation_id: undefined,
    };

    // Errors not within operations that can only be detected
    // while the request is streaming will be assigned to this
    // value.
    let request_errors_ = [];

    let frame;
    const create_frame = () => {
        const operationTraceSvc = x.get('services').get('operationTrace');
        frame = operationTraceSvc.add_frame_sync('api:/batch', x)
            .attr('gui_metadata', {
                ...expected_metadata,
                user_id: req.user.id,
            })
            ;
        x.set(operationTraceSvc.ckey('frame'), frame);

        const svc_clientOperation = x.get('services').get('client-operation');
        const tracker = svc_clientOperation.add_operation({
            name: 'batch',
            tags: ['fs'],
            frame,
            metadata: {
                user_id: req.user.id,
            }
        });
        x.set(svc_clientOperation.ckey('tracker'), tracker);
    }

    // Make sure usage is cached
    await req.fs.sizeService.get_usage(req.user.id);

    globalThis.average_chunk_size = new MovingMode({
        alpha: 0.7,
        initial: 1,
    });

    const batch_widget = {
        ic: 0,
        ops: 0,
        sc: 0,
        ec: 0,
        wc: 0,
        output () {
            let s = `Batch Operation: ${this.ic}`;
            s += `; oc = ${this.ops}`;
            s += `; sc = ${this.sc}`;
            s += `; ec = ${this.ec}`;
            s += `; wc = ${this.wc}`;
            s += `; cz = ${globalThis.average_chunk_size.get()}`;
            return s;
        }
    };
    if ( config.env == 'dev' ) {
        const svc_devConsole = x.get('services').get('dev-console');
        svc_devConsole.remove_widget('batch');
        svc_devConsole.add_widget(batch_widget.output.bind(batch_widget), "batch");
        x.set('dev_batch-widget', batch_widget);
    }

    //-------------------------------------------------------------
    // Variables used by busboy callbacks
    //-------------------------------------------------------------
    // --- library
    const operation_requires_file = op_spec => {
        if ( op_spec.op === 'write' ) return true;
        return false;
    }
    if ( ! req.actor ) {
        throw new Error('Actor is missing here');
    }
    const batch_exe = new BatchExecutor(x, {
        log, errors,
        actor: req.actor,
    });
    // --- state
    const pending_operations = [];
    const response_promises = [];
    const fileinfos = [];

    const on_nonfile_data_end = OnlyOnceFn(() => {
        if ( request_error ) {
            return;
        }

        const indexes_to_remove = [];

        for ( let i=0 ; i < pending_operations.length ; i++ ) {
            const op_spec = pending_operations[i];
            if ( ! operation_requires_file(op_spec) ) {
                indexes_to_remove.push(i);
                log.info(`executing ${op_spec.op}`);
                response_promises.push(
                    batch_exe.exec_op(req, op_spec)
                );
            }
        }

        for ( let i=indexes_to_remove.length-1 ; i >= 0 ; i-- ) {
            const index = indexes_to_remove[i];
            pending_operations.splice(index, 1)[0];
            response_promises.splice(index, 1);
        }
    });


    //-------------------------------------------------------------
    // Multipart processing (using busboy)
    //-------------------------------------------------------------
    const busboy = Busboy({
        headers: req.headers,
    });

    const still_reading = new TeePromise();
    let request_error = null;

    busboy.on('field', (fieldname, value, details) => {
        try {
            if ( details.fieldnameTruncated ) {
                throw new Error('fieldnameTruncated');
            }
            if ( details.valueTruncated ) {
                throw new Error('valueTruncated');
            }

            if ( expected_metadata.hasOwnProperty(fieldname) ) {
                expected_metadata[fieldname] = value;
                req.body[fieldname] = value;
                return;
            }

            if ( fieldname === 'fileinfo' ) {
                const fileinfo = JSON.parse(value);
                const { v: size, ok: size_ok } = valid_file_size(fileinfo.size);
                if ( ! size_ok ) {
                    throw APIError.create('invalid_file_metadata');
                }
                fileinfo.size = size;
                fileinfos.push(fileinfo);
                return;
            }

            if ( ! frame ) {
                create_frame();
            }

            if ( fieldname === 'operation' ) {
                const op_spec = JSON.parse(value);
                batch_exe.total++;
                pending_operations.push(op_spec);
                response_promises.push(null);
                return;
            }

            req.body[fieldname] = value;
        } catch (e) {
            request_error = e;
            req.unpipe(busboy);
            res.set("Connection", "close");
            res.sendStatus(400);
        }
    });

    busboy.on('file', async (fieldname, stream, detais) => {
        if ( batch_exe.total_tbd ) {
            batch_exe.total_tbd = false;
            batch_widget.ic = pending_operations.length;
            on_nonfile_data_end();
        }

        if ( fileinfos.length == 0 ) {
            request_errors_.push(
                new APIError('batch_too_many_files')
            );
            stream.on('data', () => {});
            stream.on('end', () => {
                stream.destroy();
            });
            return;
        }

        const file = fileinfos.shift();
        file.stream = stream;

        if ( pending_operations.length == 0 ) {
            request_errors_.push(
                new APIError('batch_too_many_files')
            );
            // Elimiate the stream
            stream.on('data', () => {});
            stream.on('end', () => {
                stream.destroy();
            });
            return;
        }

        const op_spec = pending_operations.shift();

        // index in response_promises is first null value
        const index = response_promises.findIndex(p => p === null);
        response_promises[index] = batch_exe.exec_op(req, op_spec, file);
        // response_promises[index] = Promise.resolve(out);
    });

    busboy.on('close', () => {
        log.info('busboy close');
        still_reading.resolve();
    });

    req.pipe(busboy);

    //-------------------------------------------------------------
    // Awaiting responses
    //-------------------------------------------------------------
    await still_reading;
    on_nonfile_data_end();

    if ( request_error ) {
        return;
    }

    log.info('waiting for operations')
    let responsePromises = response_promises;
    // let responsePromises = batch_exe.responsePromises;
    const results = await Promise.all(responsePromises);
    log.info('sending response');

    frame.done();

    if ( pending_operations.length ) {
        for ( const op_spec of pending_operations ) {
            const err = new APIError('batch_missing_file');
            request_errors_.push(err);
        }
    }

    if ( request_errors_ ) {
        results.push(...request_errors_.map(e => {
            return e.serialize();
        }));
    }

    res.status(batch_exe.hasError ? 218 : 200).send({ results });
});