/**
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

import { describe, expect, it } from 'vitest';
import { MANAGE_PERM_PREFIX } from './consts.js';
import {
    PermissionUtil,
    readingHasTerminal,
    type ReadingNode,
} from './permissionUtil.js';

describe('PermissionUtil.split / join escaping', () => {
    it('round-trips a component containing a colon', () => {
        const joined = PermissionUtil.join(
            'service',
            'es:notification',
            'read',
        );
        // The colon inside the component is escaped so it can't be mistaken
        // for a separator.
        expect(joined).toBe('service:es\\Cnotification:read');
        expect(PermissionUtil.split(joined)).toEqual([
            'service',
            'es:notification',
            'read',
        ]);
    });

    it('splits an unescaped permission into its components', () => {
        expect(PermissionUtil.split('fs:uid-1:read')).toEqual([
            'fs',
            'uid-1',
            'read',
        ]);
    });

    it('drops a lone trailing backslash rather than emitting it', () => {
        expect(PermissionUtil.unescape_permission_component('ab\\')).toBe('ab');
    });

    it('passes an unknown escape through as the literal character', () => {
        expect(PermissionUtil.unescape_permission_component('a\\Zb')).toBe(
            'aZb',
        );
    });

    it('escapes only colons, leaving backslashes alone', () => {
        expect(PermissionUtil.escape_permission_component('a\\b:c')).toBe(
            'a\\b\\Cc',
        );
    });

    it('joins an empty component list to an empty string', () => {
        expect(PermissionUtil.join()).toBe('');
    });
});

describe('PermissionUtil.isManage', () => {
    it('recognises the manage prefix', () => {
        expect(
            PermissionUtil.isManage(`${MANAGE_PERM_PREFIX}:fs:uid:read`),
        ).toBe(true);
    });

    it('rejects a permission that merely starts with the word', () => {
        // No separator — `managed:...` is a different namespace entirely.
        expect(PermissionUtil.isManage('managed:fs:uid:read')).toBe(false);
        expect(PermissionUtil.isManage('fs:uid:read')).toBe(false);
    });
});

describe('PermissionUtil.permission_scan_cache_prefix_for_app_under_user', () => {
    it('builds a stable, escaped cache prefix for an app-under-user actor', () => {
        const prefix =
            PermissionUtil.permission_scan_cache_prefix_for_app_under_user(
                'user-uuid',
                'app-uid',
            );
        // The actor uid contains colons, so it arrives escaped in the key.
        expect(prefix).toBe(
            'permission-scan:app-under-user\\Cuser-uuid\\Capp-uid:options-list',
        );
    });
});

describe('readingHasTerminal', () => {
    it('is true for a reading containing an option node', () => {
        expect(readingHasTerminal([{ $: 'option', permission: 'p' }])).toBe(
            true,
        );
    });

    it('is true for a path node that transitively terminates', () => {
        expect(
            readingHasTerminal([
                { $: 'path', has_terminal: true, reading: [] },
            ]),
        ).toBe(true);
    });

    it('is false for a dead-end path and for structural nodes only', () => {
        expect(
            readingHasTerminal([
                { $: 'rewrite', from: 'a', to: 'b' },
                { $: 'explode', from: 'a', to: ['a'] },
                { $: 'path', has_terminal: false, reading: [] },
                { $: 'time', value: 3 },
            ]),
        ).toBe(false);
    });

    it('is false for an empty reading', () => {
        expect(readingHasTerminal([])).toBe(false);
    });
});

describe('PermissionUtil.readingToOptions', () => {
    it('returns no options for a reading with no terminal nodes', () => {
        const reading: ReadingNode[] = [
            { $: 'rewrite', from: 'a', to: 'b' },
            { $: 'time', value: 1 },
        ];
        expect(PermissionUtil.readingToOptions(reading)).toEqual([]);
    });

    it('flattens a direct option and wraps its data in an array', () => {
        const options = PermissionUtil.readingToOptions([
            {
                $: 'option',
                key: 'k',
                permission: 'fs:uid:read',
                data: { mode: 'read' },
                holder_username: 'holder',
            },
        ]);
        expect(options).toHaveLength(1);
        expect(options[0].permission).toBe('fs:uid:read');
        expect(options[0].data).toEqual([{ mode: 'read' }]);
        expect(options[0].path).toEqual([
            { key: 'k', holder: 'holder', data: { mode: 'read' } },
        ]);
    });

    it('omits the data entry entirely when the option carries none', () => {
        const [option] = PermissionUtil.readingToOptions([
            { $: 'option', permission: 'fs:uid:read' },
        ]);
        expect(option.data).toEqual([]);
    });

    it('prunes a path whose has_terminal is explicitly false', () => {
        // A false `has_terminal` means the nested reading proved nothing;
        // descending into it would manufacture an allow out of a denial.
        const options = PermissionUtil.readingToOptions([
            {
                $: 'path',
                has_terminal: false,
                permission: 'fs:uid:read',
                reading: [{ $: 'option', permission: 'fs:uid:read' }],
            },
        ]);
        expect(options).toEqual([]);
    });

    it('descends a terminal path, accumulating issuer data outermost-last', () => {
        const options = PermissionUtil.readingToOptions([
            {
                $: 'path',
                via: 'user',
                has_terminal: true,
                permission: 'fs:uid:read',
                data: { via: 'share' },
                holder_username: 'holder',
                reading: [
                    {
                        $: 'option',
                        key: 'owner',
                        permission: 'fs:uid:read',
                        data: { via: 'owner' },
                        holder_username: 'issuer',
                    },
                ],
            },
        ]);
        expect(options).toHaveLength(1);
        // Inner option's own data first, then the enclosing path's extras.
        expect(options[0].data).toEqual([{ via: 'owner' }, { via: 'share' }]);
        // Path is built inner-first, so the holder chain reads holder→issuer.
        expect(options[0].path.map((p) => p.holder)).toEqual([
            'issuer',
            'holder',
        ]);
    });

    it('drops accumulated extras when an intermediate path carries no data', () => {
        const options = PermissionUtil.readingToOptions([
            {
                $: 'path',
                has_terminal: true,
                data: { outer: true },
                reading: [
                    {
                        $: 'path',
                        has_terminal: true,
                        reading: [{ $: 'option', permission: 'p' }],
                    },
                ],
            },
        ]);
        expect(options).toHaveLength(1);
        expect(options[0].data).toEqual([]);
    });

    it('collects every option across sibling branches', () => {
        const options = PermissionUtil.readingToOptions([
            { $: 'option', permission: 'a' },
            {
                $: 'path',
                has_terminal: true,
                reading: [{ $: 'option', permission: 'b' }],
            },
            { $: 'time', value: 5 },
        ]);
        expect(options.map((o) => o.permission)).toEqual(['a', 'b']);
    });

    it('treats a path with a missing reading array as a dead end', () => {
        const options = PermissionUtil.readingToOptions([
            { $: 'path', has_terminal: true, permission: 'p' },
        ]);
        expect(options).toEqual([]);
    });
});
