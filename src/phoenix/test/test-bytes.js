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
import assert from 'assert';
import { Uint8List } from '../src/util/bytes.js';

describe('bytes', () => {
    describe('Uint8List', () => {
        it ('should satisfy: 5 bytes of input', () => {
            const list = new Uint8List();
            for ( let i = 0 ; i < 5 ; i++ ) {
                list.append(i);
            }
            const array = list.toArray();
            assert.equal(array.length, 5);
            for ( let i = 0 ; i < 5 ; i++ ) {
                assert.equal(array[i], i);
            }
        })
    })
})