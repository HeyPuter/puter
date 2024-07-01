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
"use strict"
const APIError = require('../../api/APIError.js');
const eggspress = require('../../api/eggspress');
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { HLRead } = require('../../filesystem/hl_operations/hl_read');
const { Context } = require('../../util/context');
const { AccessTokenActorType } = require('../../services/auth/Actor');
const mime = require('mime-types');

module.exports = eggspress('/token-read', {
    subdomain: 'api',
    verified: true,
    fs: true,
    json: true,
    allowedMethods: ['GET'],
    alias: {
        path: 'file',
        uid: 'file',
    },
    parameters: {
        fsNode: new FSNodeParam('file')
    }
}, async (req, res, next) => {
    const line_count    = !req.query.line_count ? undefined : parseInt(req.query.line_count);
    const byte_count    = !req.query.byte_count ? undefined : parseInt(req.query.byte_count);
    const offset        = !req.query.offset ? undefined : parseInt(req.query.offset);

    const access_jwt = req.query.token;

    const svc_auth = Context.get('services').get('auth');
    const actor = await svc_auth.authenticate_from_token(access_jwt);

    if ( ! actor ) {
        throw APIError.create('token_auth_failed');
    }

    if ( ! (actor.type instanceof AccessTokenActorType) ) {
        throw APIError.create('token_auth_failed');
    }

    const context = Context.get();
    context.set('actor', actor);
    console.log('actor', actor);

    if (line_count && (!Number.isInteger(line_count) || line_count < 1)) {
        throw new APIError(400, '`line_count` must be a positive integer');
    }
    if (byte_count && (!Number.isInteger(byte_count) || byte_count < 1) ){
        throw new APIError(400, '`byte_count` must be a positive integer');
    }
    if (offset && (!Number.isInteger(offset) || offset < 0)) {
        throw new APIError(400, '`offset` must be a positive integer');
    }
    if (byte_count && line_count) {
        throw new APIError(400, 'cannot use both line_count and byte_count');
    }

    if (offset && !byte_count) {
        throw APIError.create('field_only_valid_with_other_field', null, {
            key: 'offset',
            other_key: 'byte_count',
        });
    }

    const hl_read = new HLRead();
    const stream = await context.arun(async () => await hl_read.run({
        fsNode: req.values.fsNode,
        user: req.user,
        actor,
        line_count,
        byte_count,
        offset,
        version_id: req.query.version_id,
    }));

    const name = await req.values.fsNode.get('name');
    const mime_type = mime.contentType(name);
    res.setHeader('Content-Type', mime_type);

    stream.pipe(res);
});

