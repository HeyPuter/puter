/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
export class Context {
    constructor (values) {
        for ( const k in values ) this[k] = values[k];
    }
    sub (newValues) {
        if ( newValues === undefined ) newValues = {};
        const sub = Object.create(this);

        const alreadyApplied = {};
        for ( const k in sub ) {
            if ( sub[k] instanceof Context ) {
                const newValuesForK =
                    newValues.hasOwnProperty(k)
                        ? newValues[k] : undefined;
                sub[k] = sub[k].sub(newValuesForK);
                alreadyApplied[k] = true;
            }
        }

        for ( const k in newValues ) {
            if ( alreadyApplied[k] ) continue;
            sub[k] = newValues[k];
        }

        return sub;
    }
}
