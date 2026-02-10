const APIError = require('../api/APIError');

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
const valid_file_size = v => {
    v = Number(v);
    if ( ! Number.isInteger(v) ) {
        return { ok: false, v };
    }
    if ( v < 0 ) {
        return { ok: false, v };
    }
    return { ok: true, v };
};

const validate_fields = (fields, values) => {
    // First, check for missing fields (undefined)
    const missing_fields = Object.keys(fields).filter(field => !fields[field].optional && values[field] === undefined);
    if ( missing_fields.length > 0 ) {
        throw APIError.create('fields_missing', null, { keys: missing_fields });
    }

    // Next, check for invalid fields (based on )
    const invalid_fields = Object.entries(fields).filter(([field, field_def]) => {
        if ( field_def.type === 'string' ) {
            return typeof values[field] !== 'string';
        }
        if ( field_def.type === 'number' ) {
            return typeof values[field] !== 'number';
        }
    });
    if ( invalid_fields.length > 0 ) {
        throw APIError.create('fields_invalid', null, {
            errors: invalid_fields.map(([field, field_def]) => ({
                key: field,
                expected: field_def.type,
                got: typeof values[field],
            })),
        });
    }
};

const validate_nonEmpty_string = value => {
    if ( typeof value !== 'string' ) {
        return false;
    }
    if ( value.length === 0 ) {
        return false;
    }
    return true;
};

module.exports = {
    valid_file_size,
    validate_nonEmpty_string,
    validate_fields,
};
