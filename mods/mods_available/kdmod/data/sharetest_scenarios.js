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
module.exports = [
    {
        sequence: [
            {
                title: 'Kyle creates a file',
                call: 'create-example-file',
                as: 'testuser_kyle',
                with: {
                    name: 'example.txt',
                    contents: 'secret file',
                },
            },
            {
                title: 'Eric tries to access it',
                call: 'assert-no-access',
                as: 'testuser_eric',
                with: {
                    path: '/testuser_kyle/Desktop/example.txt',
                },
            },
        ],
    },
    {
        sequence: [
            {
                title: 'Stan creates a file',
                call: 'create-example-file',
                as: 'testuser_stan',
                with: {
                    name: 'example.txt',
                    contents: 'secret file',
                },
            },
            {
                title: 'Stan grants permission to Eric',
                call: 'grant',
                as: 'testuser_stan',
                with: {
                    to: 'testuser_eric',
                    permission: 'fs:/testuser_stan/Desktop/example.txt:read',
                },
            },
            {
                title: 'Eric tries to access it',
                call: 'assert-access',
                as: 'testuser_eric',
                with: {
                    path: '/testuser_stan/Desktop/example.txt',
                    level: 'read',
                },
            },
        ],
    },
    {
        sequence: [
            {
                title: 'Stan grants Kyle\'s file to Eric',
                call: 'grant',
                as: 'testuser_stan',
                with: {
                    to: 'testuser_eric',
                    permission: 'fs:/testuser_kyle/Desktop/example.txt:read',
                },
            },
            {
                title: 'Eric tries to access it',
                call: 'assert-no-access',
                as: 'testuser_eric',
                with: {
                    path: '/testuser_kyle/Desktop/example.txt',
                },
            },
        ],
    },
];
