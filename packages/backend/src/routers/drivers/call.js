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
const eggspress = require("../../api/eggspress");
const { FileFacade } = require("../../services/drivers/FileFacade");
const { TypeSpec } = require("../../services/drivers/meta/Construct");
const { TypedValue } = require("../../services/drivers/meta/Runtime");
const { Context } = require("../../util/context");
const { TeePromise } = require("../../util/promise");

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

    const interface_name = req.body.interface;
    const test_mode = req.body.test_mode;

    const params = req.headers['content-type'].includes('multipart/form-data')
        ? await _handle_multipart(req)
        : req.body.args;

    let context = Context.get();
    if ( test_mode ) context = context.sub({ test_mode: true });

    const result = await context.arun(async () => {
        return await svc_driver.call(interface_name, req.body.method, params);
    });

    _respond(res, result);
});

const _respond = (res, result) => {
    if ( result.result instanceof TypedValue ) {
        const tv = result.result;
        if ( TypeSpec.adapt({ $: 'stream' }).equals(tv.type) ) {
            res.set('Content-Type', tv.type.raw.content_type);
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
    const busboy = require('busboy');
    const { Readable } = require('stream');

    const params = {};

    const bb = new busboy({
        headers: req.headers,
    });

    const p_ready = new TeePromise();
    bb.on('file', (fieldname, stream, details) => {
        const file_facade = new FileFacade();
        file_facade.values.set('stream', stream);
        file_facade.values.set('busboy:details', details);
        if ( params.hasOwnProperty(fieldname) ) {
            if ( ! Array.isArray(params[fieldname]) ) {
                params[fieldname] = [params[fieldname]];
            }
            params[fieldname].push(file_facade);
        } else {
            params[fieldname] = file_facade;
        }
    });
    bb.on('field', (fieldname, value, details) => {
        if ( params.hasOwnProperty(fieldname) ) {
            if ( ! Array.isArray(params[fieldname]) ) {
                params[fieldname] = [params[fieldname]];
            }
            params[fieldname].push(value);
        } else {
            params[fieldname] = value;
        }
    });
    bb.on('error', (err) => {
        p_ready.reject(err);
    });
    bb.on('close', () => {
        p_ready.resolve();
    });

    req.pipe(bb);

    await p_ready;

    return params;
}