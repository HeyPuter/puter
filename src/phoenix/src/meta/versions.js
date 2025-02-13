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
export const SHELL_VERSIONS = [
    {
        v: '0.2.6',
        changes: [
            'add PDE execution from /admin/Public/bin',
        ]
    },
    {
        v: '0.2.5',
        changes: [
            'fixed app command provider exit',
        ]
    },
    {
        v: '0.2.4',
        changes: [
            'more completers for tab-completion',
            'help updates',
            '"which" command added',
            '"date" command added',
            'improvements when running under node.js',
        ]
    },
    {
        v: '0.2.3',
        changes: [
            '"printf" command added',
            '"help" command updated',
            '"errno" command added',
            'POSIX error code associations added',
        ]
    },
    {
        v: '0.2.2',
        changes: [
            'wc works with BLOB inputs',
            '"~" path resolution fixed',
            '"head" command added',
            '"tail" command updated',
            '"ls" symlink support improved',
            '"sort" command added',
            'Testing improved',
            '"cd" with no arguments works',
            'Filesystem errors are more consistent',
            '"help" output improved',
            '"pwd" argument processing updated'

        ]
    },
    {
        v: '0.2.1',
        changes: [
            'commands: true, false',
            'commands: basename, dirname',
            'more node.js support',
            'wc command',
            'sleep command',
            'improved coreutils documentation',
            'updates to existing coreutils',
            'readline fixes',
        ]
    },
    {
        v: '0.2.0',
        changes: [
            'brand change: Phoenix Shell',
            'open-sourced under AGPL-3.0',
            'new commands: ai, txt2img, jq, and more',
            'added login command',
            'coreutils updates',
            'added command substitution',
            'parser improvements',
        ]
    },
    {
        v: '0.1.10',
        changes: [
            'new input parser',
            'add pwd command',
        ]
    },
    {
        v: '0.1.9',
        changes: [
            'add help command',
            'add changelog command',
            'add ioctl messages for window size',
            'add env.ROWS and env.COLS',
        ]
    },
    {
        v: '0.1.8',
        changes: [
            'add neofetch command',
            'add simple tab completion',
        ]
    },
    {
        v: '0.1.7',
        changes: [
            'add clear and printenv',
        ]
    },
    {
        v: '0.1.6',
        changes: [
            'add redirect syntax',
        ],
    },
    {
        v: '0.1.5',
        changes: [
            'add cp command',
        ],
    },
    {
        v: '0.1.4',
        changes: [
            'improve error handling',
        ],
    },
    {
        v: '0.1.3',
        changes: [
            'fixes for existing commands',
            'mv added',
            'cat added',
            'readline history (transient) added',
        ]
    },
    {
        v: '0.1.2',
        changes: [
            'add echo',
            'fix synchronization of pipe coupler',
        ]
    }
];
