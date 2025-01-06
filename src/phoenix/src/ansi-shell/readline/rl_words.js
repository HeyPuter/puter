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
export const findNextWord = (str, from, reverse) => {
    let stage = 0;
    let incr = reverse ? -1 : 1;
    const cond = reverse ? i => i > 0 : i => i < str.length;
    if ( reverse && from !== 0 ) from--;
    for ( let i=from ; cond(i) ; i += incr ) {
        if ( stage === 0 ) {
            if ( str[i] !== ' ' ) stage++;
            continue;
        }
        if ( stage === 1 ) {
            if ( str[i] === ' ' ) return reverse ? i + 1 : i;
        }
    }
    return reverse ? 0 : str.length;
}
