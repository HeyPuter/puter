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
import { privacy_aware_path } from '../src/util/desktop.js';

const cases = [
    {
        title: 'path in user home',
        username: 'user',
        input: '/home/user/test.txt',
        expected: '~/test.txt',
    },
    {
        title: 'path on user desktop',
        username: 'user',
        input: '/home/user/Desktop/test.txt',
        expected: '~/Desktop/test.txt',
    },
    {
        title: 'prefix (ed3/ed) bug',
        username: 'ed',
        input: '/home/ed3/Desktop/test.txt',
        expected: '/home/ed3/Desktop/test.txt',
    },
];

describe('window.privacy_aware_path', () => {
    for (const { title, username, input, expected } of cases) {
        it(title, () => {
            assert.equal(privacy_aware_path({
                window: { home_path: `/home/${username}` },
            })(input), expected);
        });
    }
});