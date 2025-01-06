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
"use strict"
const eggspress = require('../../api/eggspress.js');
const FSNodeParam = require('../../api/filesystem/FSNodeParam.js');
const { HLWrite } = require('../../filesystem/hl_operations/hl_write.js');
const { boolify } = require('../../util/hl_types.js');
const { Context } = require('../../util/context.js');
const Busboy = require('busboy');
const { TeePromise } = require('@heyputer/putility').libs.promise;
const APIError = require('../../api/APIError.js');
const { valid_file_size } = require('../../util/validutil.js');

// -----------------------------------------------------------------------//
// POST /up | /write
// -----------------------------------------------------------------------//
module.exports = eggspress(['/up', '/write'], {
    subdomain: 'api',
    verified: true,
    auth2: true,
    fs: true,
    json: true,
    allowedMethods: ['POST'],
    // files: ['file'],
    // multest: true,
    alias: { uid: 'path' },
    // parameters: {
    //     fsNode: new FSNodeParam('path'),
    //     target: new FSNodeParam('shortcut_to', { optional: true }),
    // }
}, async (req, res, next) => {
    // Note: parameters moved here because the parameter
    // middleware won't work while using busboy
    const parameters = {
        fsNode: new FSNodeParam('path'),
        target: new FSNodeParam('shortcut_to', { optional: true }),
    };

    // modules
    const {get_app} = require('../../helpers.js')

    // Is this an entry for an app?
    let app;
    if ( req.body.app_uid ) {
        app = await get_app({uid: req.body.app_uid})
    }

    const x = Context.get();
    let frame;
    const frame_meta_ready = async () => {
        const operationTraceSvc = x.get('services').get('operationTrace');
        frame = (await operationTraceSvc.add_frame('api:/write'))
            .attr('gui_metadata', {
                original_client_socket_id: req.body.original_client_socket_id,
                socket_id: req.body.socket_id,
                operation_id: req.body.operation_id,
                user_id: req.user.id,
                item_upload_id: req.body.item_upload_id,
            })
            ;
        x.set(operationTraceSvc.ckey('frame'), frame);

        const svc_clientOperation = x.get('services').get('client-operation');
        const tracker = svc_clientOperation.add_operation({
            frame,
            metadata: {
                user_id: req.user.id,
            }
        });
        x.set(svc_clientOperation.ckey('tracker'), tracker);
    }

    //-------------------------------------------------------------
    // Multipart processing (using busboy)
    //-------------------------------------------------------------
    const busboy = Busboy({ headers: req.headers });

    let uploaded_file = null;
    const p_ready = new TeePromise();

    busboy.on('field', (fieldname, value, details) => {
        if ( details.fieldnameTruncated ) {
            throw new Error('fieldnameTruncated');
        }
        if ( details.valueTruncated ) {
            throw new Error('valueTruncated');
        }

        req.body[fieldname] = value;
    });

    busboy.on('file', (fieldname, stream, details) => {
        const {
            filename, mimetype,
        } = details;
        
        const { v: size, ok: size_ok } =
            valid_file_size(req.body.size);
            
        if ( ! size_ok ) {
            p_ready.reject(
                APIError.create('invalid_file_metadata')
            );
            return;
        }

        uploaded_file = {
            size: size,
            name: filename,
            mimetype,
            stream,

            // TODO: Standardize the fileinfo object

            // thumbnailer expects `mimetype` to be `type`
            type: mimetype,

            // alias for name, used only in here it seems
            originalname: filename,
        };

        p_ready.resolve();
    });

    busboy.on('error', err => {
        console.log('GOT ERROR READING', err )
        p_ready.reject(err);
    });

    busboy.on('close', () => {
        console.log('GOT DNE RADINGR')
        p_ready.resolve();
    });

    req.pipe(busboy);

    console.log('Awaiting ready');
    await p_ready;
    console.log('Done awaiting ready');

    // Copied from eggspress; needed here because we're using busboy
    for ( const key in parameters ) {
        const param = parameters[key];
        if ( ! req.values ) req.values = {};

        const values = req.method === 'GET' ? req.query : req.body;
        const getParam = (key) => values[key];
        const result = await param.consolidate({ req, getParam });
        req.values[key] = result;
    }

    if ( req.body.size === undefined ) {
        throw APIError.create('missing_expected_metadata', null, {
            keys: ['size'],
        })
    }

    console.log('TRGET', req.values.target);

    const hl_write = new HLWrite();
    const response = await hl_write.run({
        destination_or_parent: req.values.fsNode,
        specified_name: req.body.name,
        fallback_name: uploaded_file.originalname,
        overwrite: await boolify(req.body.overwrite),
        dedupe_name: await boolify(req.body.dedupe_name),
        shortcut_to: req.values.target,

        create_missing_parents: boolify(
            req.body.create_missing_ancestors ??
            req.body.create_missing_parents
        ),

        user: req.user,
        file: uploaded_file,

        app_id: app ? app.id : null,
    });

    if ( frame ) frame.done();
    return res.send(response);
});
