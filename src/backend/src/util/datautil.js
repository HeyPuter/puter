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
/**
 * Stringify an object in such a way that objects with differing
 * key orderings will still be considered equal.
 * @param {*} obj
 */
const stringify_serializable_object = obj => {
    if ( obj === undefined ) return '[undefined]';
    if ( obj === null ) return '[null]';
    if ( typeof obj === 'function' ) return '[function]';
    if ( typeof obj !== 'object' ) return JSON.stringify(obj);

    // ensure an error is thrown if the object is not serializable.
    // (instead of failing with a stack overflow)
    JSON.stringify(obj);

    const keys = Object.keys(obj).sort();
    const pairs = keys.map(key => {
        const value = stringify_serializable_object(obj[key]);
        const outer_json = JSON.stringify({ [key]: value });
        return outer_json.slice(1, -1);
    });

    return `{${ pairs.join(',') }}`;
};

const hash_serializable_object = obj => {
    const crypto = require('crypto');
    const str = stringify_serializable_object(obj);
    return crypto.createHash('sha1').update(str).digest('hex');
};

module.exports = {
    stringify_serializable_object,
    hash_serializable_object,
};
