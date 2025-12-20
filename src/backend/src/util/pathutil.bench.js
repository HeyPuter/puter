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
import { PathBuilder } from './pathutil.js';

describe('PathBuilder - Creation', () => {
    bench('create PathBuilder (default)', () => {
        PathBuilder.create();
    });

    bench('create PathBuilder (puterfs mode)', () => {
        PathBuilder.create({ puterfs: true });
    });

    bench('create via new', () => {
        new PathBuilder();
    });
});

describe('PathBuilder - Static add', () => {
    bench('static add single fragment', () => {
        PathBuilder.add('directory');
    });

    bench('static add with traversal prevention', () => {
        PathBuilder.add('../../../etc/passwd');
    });

    bench('static add with allow_traversal', () => {
        PathBuilder.add('../parent', { allow_traversal: true });
    });
});

describe('PathBuilder - Static resolve', () => {
    bench('resolve simple path', () => {
        PathBuilder.resolve('/home/user/file.txt');
    });

    bench('resolve relative path', () => {
        PathBuilder.resolve('./relative/path');
    });

    bench('resolve with puterfs', () => {
        PathBuilder.resolve('/home/user/file.txt', { puterfs: true });
    });

    bench('resolve complex path', () => {
        PathBuilder.resolve('/a/b/c/../d/./e/f');
    });
});

describe('PathBuilder - Instance add', () => {
    bench('add single fragment', () => {
        const builder = PathBuilder.create();
        builder.add('directory');
    });

    bench('add multiple fragments (chain)', () => {
        PathBuilder.create()
            .add('home')
            .add('user')
            .add('documents')
            .add('file.txt');
    });

    bench('add 10 fragments', () => {
        const builder = PathBuilder.create();
        for ( let i = 0; i < 10; i++ ) {
            builder.add(`dir${i}`);
        }
    });
});

describe('PathBuilder - Traversal prevention', () => {
    bench('sanitize parent traversal (..)', () => {
        PathBuilder.create().add('..');
    });

    bench('sanitize multiple parent traversals', () => {
        PathBuilder.create().add('../../..');
    });

    bench('sanitize mixed traversal patterns', () => {
        PathBuilder.create().add('../foo/../../bar/../baz');
    });

    bench('sanitize with backslash traversal', () => {
        PathBuilder.create().add('..\\..\\..\\etc\\passwd');
    });

    bench('allow_traversal option', () => {
        PathBuilder.create().add('../parent/child', { allow_traversal: true });
    });
});

describe('PathBuilder - Build', () => {
    bench('build empty path', () => {
        PathBuilder.create().build();
    });

    bench('build simple path', () => {
        PathBuilder.create()
            .add('home')
            .add('user')
            .build();
    });

    bench('build long path', () => {
        const builder = PathBuilder.create();
        for ( let i = 0; i < 20; i++ ) {
            builder.add(`directory${i}`);
        }
        builder.build();
    });
});

describe('PathBuilder - Complete workflows', () => {
    bench('create, add, build (simple)', () => {
        PathBuilder.create()
            .add('home')
            .add('user')
            .add('file.txt')
            .build();
    });

    bench('create, add, build (with sanitization)', () => {
        PathBuilder.create()
            .add('../attempt')
            .add('actual')
            .add('path')
            .build();
    });

    bench('puterfs path building', () => {
        PathBuilder.create({ puterfs: true })
            .add('username')
            .add('documents')
            .add('report.pdf')
            .build();
    });
});

describe('PathBuilder - Batch operations', () => {
    const fragments = ['home', 'user', 'documents', 'projects', 'puter'];

    bench('build 10 paths', () => {
        for ( let i = 0; i < 10; i++ ) {
            const builder = PathBuilder.create();
            for ( const frag of fragments ) {
                builder.add(frag);
            }
            builder.build();
        }
    });

    bench('build 100 paths', () => {
        for ( let i = 0; i < 100; i++ ) {
            const builder = PathBuilder.create();
            for ( const frag of fragments ) {
                builder.add(frag);
            }
            builder.build();
        }
    });
});

describe('Comparison with native path operations', () => {
    const path = require('path');

    bench('PathBuilder.resolve', () => {
        PathBuilder.resolve('/home/user/file.txt');
    });

    bench('native path.resolve', () => {
        path.resolve('/home/user/file.txt');
    });

    bench('PathBuilder chain vs path.join', () => {
        PathBuilder.create()
            .add('home')
            .add('user')
            .add('file.txt')
            .build();
    });

    bench('native path.join', () => {
        path.join('home', 'user', 'file.txt');
    });
});
