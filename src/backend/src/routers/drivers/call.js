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
const APIError = require("../../api/APIError");
const eggspress = require("../../api/eggspress");
const { FileFacade } = require("../../services/drivers/FileFacade");
const { TypeSpec } = require("../../services/drivers/meta/Construct");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { Context } = require("../../util/context");
const { whatis } = require("../../util/langutil");
const { TeePromise } = require('@heyputer/putility').libs.promise;
const { valid_file_size } = require("../../util/validutil");

let _handle_multipart;

/**
 * POST /drivers/call
 *
 * This endpoint is used to call methods offered by driver interfaces.
 * The implementation used by each interface depends on the user's
 * configuration.
 *
 * The request body can be a JSON object or multipart/form-data.
 * For multipart/form-data, the caller must be aware that all fields
 * are required to be sent before files so that the request handler
 * and underlying driver implementation can decide what to do with
 * file streams as they come.
 *
 * Example request body:
 * {
 *   "interface": "puter-ocr",
 *   "method": "recognize",
 *   "args": {
 *     "file": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB...
 *   }
 * }
 */
module.exports = eggspress('/drivers/call', {
    subdomain: 'api',
    auth2: true,
    allowedMethods: ['POST'],
}, async (req, res, next) => {
    const x = Context.get();
    const svc_driver = x.get('services').get('driver');

    let p_request = null;
    let body;
    if ( req.headers['content-type'].includes('multipart/form-data') ) {
        ({ params: body, p_data_end: p_request } = await _handle_multipart(req));
    } else body = req.body;

    const interface_name = body.interface;
    const test_mode = body.test_mode;

    let context = Context.get();
    if ( test_mode ) context = context.sub({ test_mode: true });

    const result = await context.arun(async () => {
        return await svc_driver.call({
            iface: interface_name,
            driver: body.driver ?? body.service,
            method: body.method,
            format: body.format,
            args: body.args,
        });
    });

    // We can't wait for the request to finish before responding;
    // consider the case where a driver method implements a
    // stream transformation, thus the stream from the request isn't
    // consumed until the response is being sent.
    
    _respond(res, result);

    // What we _can_ do is await the request promise while responding
    // to ensure errors are caught here.
    await p_request;
});

const _respond = (res, result) => {
    if ( result.result instanceof TypedValue ) {
        const tv = result.result;
        debugger;
        if ( TypeSpec.adapt({ $: 'stream' }).equals(tv.type) ) {
            res.set('Content-Type', tv.type.raw.content_type);
            if ( tv.type.raw.chunked ) {
                res.set('Transfer-Encoding', 'chunked');
            }
            tv.value.pipe(res);
            return;
        }

        // This is the
        if ( typeof result.value === 'object' ) {
            result.value.type_fallback = true;
        }
        res.json(result.value);
        return;
    }
    res.json(result);
};

_handle_multipart = async (req) => {
    const Busboy = require('busboy');
    const { PassThrough } = require('stream');

    const params = {};
    const files = [];
    let file_index = 0;

    const bb = Busboy({
        headers: req.headers,
    });

    const p_data_end = new TeePromise();
    const p_nonfile_data_end = new TeePromise();
    bb.on('file', (fieldname, stream, details) => {
        p_nonfile_data_end.resolve();
        const fileinfo = files[file_index++];
        stream.pipe(fileinfo.stream);
    });

    const on_field = (fieldname, value) => {
        const key_parts = fieldname.split('.');
        const last_key = key_parts.pop();
        let dst = params;
        for ( let i = 0; i < key_parts.length; i++ ) {
            if ( ! dst.hasOwnProperty(key_parts[i]) ) {
                dst[key_parts[i]] = {};
            }
            if ( whatis(dst[key_parts[i]]) !== 'object' ) {
                throw new Error(
                    `Tried to set member of non-object: ${key_parts[i]} in ${fieldname}`
                );
            }
            dst = dst[key_parts[i]];
        }
        if ( whatis(value) === 'object' && value.$ === 'file' ) {
            const fileinfo = value;
            const { v: size, ok: size_ok } =
                valid_file_size(fileinfo.size);
            if ( ! size_ok ) {
                throw APIError.create('invalid_file_metadata');
            }
            fileinfo.size = size;
            fileinfo.stream = new PassThrough();
            const file_facade = new FileFacade();
            file_facade.values.set('stream', fileinfo.stream);
            fileinfo.facade = file_facade,
            files.push(fileinfo);
            value = file_facade;
        }
        if ( dst.hasOwnProperty(last_key) ) {
            if ( ! Array.isArray(dst[last_key]) ) {
                dst[last_key] = [dst[last_key]];
            }
            dst[last_key].push(value);
        } else {
            dst[last_key] = value;
        }
    };

    bb.on('field', (fieldname, value, details) => {
        const o = JSON.parse(value);
        for ( const k in o ) {
            on_field(k, o[k]);
        }
    });
    bb.on('error', (err) => {
        p_data_end.reject(err);
    });
    bb.on('close', () => {
        p_data_end.resolve();
    });

    req.pipe(bb);

    (async () => {
        await p_data_end;
        p_nonfile_data_end.resolve();
    })();

    await p_nonfile_data_end;

    return { params, p_data_end };
}
