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

import { bench, describe } from 'vitest';
const { is_valid_path, is_valid_node_name } = require('./validation');

// Test data
const shortPath = '/home/user/file.txt';
const mediumPath = '/home/user/documents/projects/puter/src/backend/file.js';
const longPath = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/file.txt';
const deeplyNestedPath = `${Array(50).fill('directory').join('/') }/file.txt`;

const simpleFilename = 'document.pdf';
const filenameWithSpaces = 'my document file.pdf';
const filenameWithNumbers = 'report_2024_final_v2.xlsx';
const maxLengthFilename = 'a'.repeat(255);

// Invalid paths for testing rejection speed
const pathWithNull = '/home/user/\x00file.txt';
const pathWithRTL = '/home/user/\u202Efile.txt';
const pathWithLTR = '/home/user/\u200Efile.txt';

describe('is_valid_path - Valid paths', () => {
    bench('short path (/home/user/file.txt)', () => {
        is_valid_path(shortPath);
    });

    bench('medium path (~50 chars)', () => {
        is_valid_path(mediumPath);
    });

    bench('long path (26 components)', () => {
        is_valid_path(longPath);
    });

    bench('deeply nested path (50 components)', () => {
        is_valid_path(`/${ deeplyNestedPath}`);
    });

    bench('relative path starting with dot', () => {
        is_valid_path('./relative/path/to/file.txt');
    });
});

describe('is_valid_path - With options', () => {
    bench('with no_relative_components option', () => {
        is_valid_path(mediumPath, { no_relative_components: true });
    });

    bench('with allow_path_fragment option', () => {
        is_valid_path('partial/path/fragment', { allow_path_fragment: true });
    });

    bench('with both options', () => {
        is_valid_path(shortPath, { no_relative_components: true, allow_path_fragment: true });
    });
});

describe('is_valid_path - Invalid paths (rejection speed)', () => {
    bench('path with null character', () => {
        is_valid_path(pathWithNull);
    });

    bench('path with RTL override', () => {
        is_valid_path(pathWithRTL);
    });

    bench('path with LTR mark', () => {
        is_valid_path(pathWithLTR);
    });

    bench('empty string', () => {
        is_valid_path('');
    });

    bench('non-string input (number)', () => {
        is_valid_path(12345);
    });

    bench('path not starting with / or .', () => {
        is_valid_path('invalid/path/start');
    });
});

describe('is_valid_node_name - Valid names', () => {
    bench('simple filename', () => {
        is_valid_node_name(simpleFilename);
    });

    bench('filename with spaces', () => {
        is_valid_node_name(filenameWithSpaces);
    });

    bench('filename with numbers and underscores', () => {
        is_valid_node_name(filenameWithNumbers);
    });

    bench('filename at max length (255 chars)', () => {
        is_valid_node_name(maxLengthFilename);
    });

    bench('filename with multiple extensions', () => {
        is_valid_node_name('archive.tar.gz');
    });
});

describe('is_valid_node_name - Invalid names (rejection speed)', () => {
    bench('name with forward slash', () => {
        is_valid_node_name('invalid/name');
    });

    bench('name with null character', () => {
        is_valid_node_name('invalid\x00name');
    });

    bench('single dot (.)', () => {
        is_valid_node_name('.');
    });

    bench('double dot (..)', () => {
        is_valid_node_name('..');
    });

    bench('only dots (...)', () => {
        is_valid_node_name('...');
    });

    bench('name exceeding max length', () => {
        is_valid_node_name('a'.repeat(300));
    });

    bench('non-string input', () => {
        is_valid_node_name(null);
    });
});

describe('is_valid_path - Batch validation simulation', () => {
    const paths = [
        '/home/user/file1.txt',
        '/home/user/file2.txt',
        '/home/user/documents/report.pdf',
        '/var/log/system.log',
        '/etc/config.json',
    ];

    bench('validate 5 paths sequentially', () => {
        for ( const path of paths ) {
            is_valid_path(path);
        }
    });

    bench('validate 100 paths', () => {
        for ( let i = 0; i < 100; i++ ) {
            is_valid_path(paths[i % paths.length]);
        }
    });
});
