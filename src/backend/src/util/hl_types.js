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
const { quot } = require('@heyputer/putility').libs.string;

const hl_type_definitions = {
    flag: {
        fallback: false,
        required_check: v => {
            if ( v === undefined || v === '' ) {
                return false;
            }
            return true;
        },
        adapt: (v) => {
            if ( typeof v === 'string' ) {
                if (
                    v === 'true' || v === '1' || v === 'yes'
                ) return true;

                if (
                    v === 'false' || v === '0' || v === 'no'
                ) return false;

                throw new Error(`could not adapt string to boolean: ${quot(v)}`);
            }

            if ( typeof v === 'boolean' ) {
                return v;
            }

            if ( v === 1 ) return true;
            if ( v === 0 ) return false
            if ( typeof v === 'object' ) {
                return v !== null;
            }

            throw new Error(`could not adapt value to boolean: ${quot(v)}`);
        }
    }
};

class HLTypeFacade {
    static REQUIRED = {};
    static convert (type, value, opt_default) {
        const type_definition = hl_type_definitions[type];
        const has_value = type_definition.required_check(value);
        if ( ! has_value ) {
            if ( opt_default === HLTypeFacade.REQUIRED ) {
                throw new Error(`required value is missing`);
            }
            return opt_default ?? type_definition.fallback;
        }
        return type_definition.adapt(value);
    }
}

module.exports = {
    hl_type_definitions,
    HLTypeFacade,
    boolify: HLTypeFacade.convert.bind(HLTypeFacade, 'flag'),
};
