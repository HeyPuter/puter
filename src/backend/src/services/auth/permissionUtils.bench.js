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
import { PermissionUtil } from './permissionUtils.mjs';

// Sample permission strings for benchmarking
const simplePermissions = [
    'fs:read',
    'fs:write',
    'app:execute',
    'user:profile:view',
];

const complexPermissions = [
    'fs:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:read',
    'app:my-app-name:config:update',
    'user:john_doe:profile:avatar:upload',
    'service:database:table:users:column:email:read',
];

const escapedPermissions = [
    'fs:path\\Cwith\\Ccolons:read',
    'app:name\\Cwith\\Cmany\\Ccolons:execute',
    'user:email\\Cexample@test.com:verify',
];

// Generate large batch of permissions for bulk testing
const generatePermissions = (count) => {
    const perms = [];
    for ( let i = 0; i < count; i++ ) {
        perms.push(`service:svc${i}:action${i % 10}:resource${i % 100}`);
    }
    return perms;
};

const bulkPermissions = generatePermissions(100);

describe('PermissionUtil.split()', () => {
    bench('split simple permissions', () => {
        for ( const perm of simplePermissions ) {
            PermissionUtil.split(perm);
        }
    });

    bench('split complex permissions', () => {
        for ( const perm of complexPermissions ) {
            PermissionUtil.split(perm);
        }
    });

    bench('split escaped permissions', () => {
        for ( const perm of escapedPermissions ) {
            PermissionUtil.split(perm);
        }
    });

    bench('split bulk permissions (100)', () => {
        for ( const perm of bulkPermissions ) {
            PermissionUtil.split(perm);
        }
    });
});

describe('PermissionUtil.join()', () => {
    const simpleComponents = [['fs', 'read'], ['app', 'execute'], ['user', 'view']];
    const complexComponents = [
        ['fs', 'uuid-here', 'read'],
        ['service', 'database', 'table', 'users', 'read'],
        ['app', 'my-app', 'config', 'setting', 'update'],
    ];
    const needsEscaping = [
        ['fs', 'path:with:colons', 'read'],
        ['user', 'email:test@example.com', 'verify'],
    ];

    bench('join simple components', () => {
        for ( const comps of simpleComponents ) {
            PermissionUtil.join(...comps);
        }
    });

    bench('join complex components', () => {
        for ( const comps of complexComponents ) {
            PermissionUtil.join(...comps);
        }
    });

    bench('join components needing escaping', () => {
        for ( const comps of needsEscaping ) {
            PermissionUtil.join(...comps);
        }
    });
});

describe('PermissionUtil.escape_permission_component()', () => {
    const noEscape = ['simple', 'another_one', 'with-dashes', 'CamelCase'];
    const needsEscape = ['has:colon', 'multiple:colons:here', ':starts:with', 'ends:'];

    bench('escape components without special chars', () => {
        for ( const comp of noEscape ) {
            PermissionUtil.escape_permission_component(comp);
        }
    });

    bench('escape components with colons', () => {
        for ( const comp of needsEscape ) {
            PermissionUtil.escape_permission_component(comp);
        }
    });
});

describe('PermissionUtil.unescape_permission_component()', () => {
    const noUnescape = ['simple', 'another_one', 'with-dashes'];
    const needsUnescape = ['has\\Ccolon', 'multiple\\Ccolons\\Chere', '\\Cstarts\\Cwith'];

    bench('unescape components without escape sequences', () => {
        for ( const comp of noUnescape ) {
            PermissionUtil.unescape_permission_component(comp);
        }
    });

    bench('unescape components with escape sequences', () => {
        for ( const comp of needsUnescape ) {
            PermissionUtil.unescape_permission_component(comp);
        }
    });
});

describe('PermissionUtil roundtrip (split then join)', () => {
    bench('roundtrip simple permissions', () => {
        for ( const perm of simplePermissions ) {
            const parts = PermissionUtil.split(perm);
            PermissionUtil.join(...parts);
        }
    });

    bench('roundtrip complex permissions', () => {
        for ( const perm of complexPermissions ) {
            const parts = PermissionUtil.split(perm);
            PermissionUtil.join(...parts);
        }
    });
});

describe('PermissionUtil vs native string operations (baseline)', () => {
    const perm = 'service:database:table:users:column:email:read';

    bench('PermissionUtil.split()', () => {
        PermissionUtil.split(perm);
    });

    bench('native String.split() (baseline, no unescaping)', () => {
        perm.split(':');
    });

    bench('PermissionUtil.join()', () => {
        PermissionUtil.join('service', 'database', 'table', 'users');
    });

    bench('native Array.join() (baseline, no escaping)', () => {
        ['service', 'database', 'table', 'users'].join(':');
    });
});
