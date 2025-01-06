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
const APIError = require('./APIError');
const _path = require('path');

/**
 * PathOrUIDValidator validates that either `path` or `uid` is present
 * in the request and requires a valid value for the parameter that was
 * used. Additionally, resolves the path if a path was provided.
 * 
 * @class PathOrUIDValidator
 * @static
 * @throws {APIError} if `path` and `uid` are both missing
 * @throws {APIError} if `path` and `uid` are both present
 * @throws {APIError} if `path` is not a string
 * @throws {APIError} if `path` is empty
 * @throws {APIError} if `uid` is not a valid uuid
 */
module.exports = class PathOrUIDValidator {
    static validate (req) {
        const params = req.method === 'GET'
            ? req.query : req.body ;

        if(!params.path && !params.uid)
            throw new APIError(400, '`path` or `uid` must be provided.');
        // `path` must be a string
        else if (params.path && !params.uid && typeof params.path !== 'string')
            throw new APIError(400, '`path` must be a string.');
        // `path` cannot be empty
        else if(params.path && !params.uid && params.path.trim() === '')
            throw new APIError(400, '`path` cannot be empty');
        // `uid` must be a valid uuid
        else if(params.uid && !params.path && !require('uuid').validate(params.uid))
            throw new APIError(400, '`uid` must be a valid uuid');

        // resolve path if provided
        if(params.path)
            params.path = _path.resolve('/', params.path);
    }
};
