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
const APIError = require('../../api/APIError.js');
const eggspress = require('../../api/eggspress');
const FSNodeParam = require('../../api/filesystem/FSNodeParam');
const { HLRead } = require('../../filesystem/hl_operations/hl_read');

module.exports = eggspress('/read', {
    subdomain: 'api',
    auth2: true,
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

    // Helper function to parse Range header
    const parseRangeHeader = (rangeHeader) => {
        // Check if this is a multipart range request
        if (rangeHeader.includes(',')) {
            // For now, we'll only serve the first range in multipart requests
            // as the underlying storage layer doesn't support multipart responses
            const firstRange = rangeHeader.split(',')[0].trim();
            const matches = firstRange.match(/bytes=(\d+)-(\d*)/);
            if (!matches) return null;
            
            const start = parseInt(matches[1], 10);
            const end = matches[2] ? parseInt(matches[2], 10) : null;
            
            return { start, end, isMultipart: true };
        }
        
        // Single range request
        const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (!matches) return null;
        
        const start = parseInt(matches[1], 10);
        const end = matches[2] ? parseInt(matches[2], 10) : null;
        
        return { start, end, isMultipart: false };
    };

    if (req.headers["range"]) {
        res.status(206);
        
        // Parse the Range header and set Content-Range
        const rangeInfo = parseRangeHeader(req.headers["range"]);
        if (rangeInfo) {
            const { start, end, isMultipart } = rangeInfo;
            const contentRange = end !== null 
                ? `bytes ${start}-${end}/*`
                : `bytes ${start}-*/*`;
            res.set("Content-Range", contentRange);
            
            // If this was a multipart request, modify the range header to only include the first range
            if (isMultipart) {
                req.headers["range"] = end !== null 
                    ? `bytes=${start}-${end}`
                    : `bytes=${start}-`;
            }
        }
    }
    res.set({"Accept-Ranges": "bytes"});

    const hl_read = new HLRead();
    const stream = await hl_read.run({
        ...(req.headers["range"] ? { range: req.headers["range"] } : {
            line_count,
            byte_count,
            offset
        }),
        fsNode: req.values.fsNode,
        user: req.user,

        version_id: req.query.version_id,
    });

    res.set('Content-Type', 'application/octet-stream');

    stream.pipe(res);
});
