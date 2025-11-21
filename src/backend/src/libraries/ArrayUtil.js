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
class ArrayUtil extends use.Library {
    /**
     *
     * @param {*} marked_map
     * @param {*} subject
     */
    remove_marked_items (marked_map, subject) {
        for ( let i = 0 ; i < marked_map.length ; i++ ) {
            let ii = marked_map[i];
            // track: type check
            if ( ! Number.isInteger(ii) ) {
                throw new Error('marked_map can only contain integers');
            }
            // track: bounds check
            if ( ii < 0 && ii >= subject.length ) {
                throw new Error('each item in `marked_map` must be within that bounds ' +
                    'of `subject`');
            }
        }

        marked_map.sort((a, b) => b - a);

        for ( let i = 0 ; i < marked_map.length ; i++ ) {
            let ii = marked_map[i];
            subject.splice(ii, 1);
        }

        return subject;
    }

    _test ({ assert }) {
        // inner indices
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
            ];
            //   0    1    2    3    4    5    6    7
            const marked_map = [2, 5];
            this.remove_marked_items(marked_map, subject);
            assert(() => subject.join('') === 'abdegh');
        }
        // left edge
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
            ];
            //   0    1    2    3    4    5    6    7
            const marked_map = [0];
            this.remove_marked_items(marked_map, subject);
            assert(() => subject.join('') === 'bcdefgh');
        }
        // right edge
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
            ];
            //   0    1    2    3    4    5    6    7
            const marked_map = [7];
            this.remove_marked_items(marked_map, subject);
            assert(() => subject.join('') === 'abcdefg');
        }
        // both edges
        {
            const subject = [
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
            ];
            //   0    1    2    3    4    5    6    7
            const marked_map = [0, 7];
            this.remove_marked_items(marked_map, subject);
            assert(() => subject.join('') === 'bcdefg');
        }
    }
}

module.exports = ArrayUtil;
