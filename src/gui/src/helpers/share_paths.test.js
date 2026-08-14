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

import { beforeEach, describe, expect, it } from 'vitest';
import { shared_crumbs_for } from './share_paths.js';
import {
    invalidate_shared_roots,
    remember_shared_roots,
} from './shared_access.js';

beforeEach(() => {
    globalThis.window = {
        user: { username: 'sharemate' },
        shared_path: 'puter://shared',
    };
    invalidate_shared_roots();
});

describe('shared_crumbs_for', () => {
    it('leaves the viewer’s own paths unmasked', () => {
        remember_shared_roots([]);
        expect(shared_crumbs_for('/sharemate/Documents/a.txt')).toBeNull();
    });

    it('shows a shared root by its own name', () => {
        remember_shared_roots([
            {
                path: '/jfcastro/Pictures/_CodeSignature',
                mode: 'manage',
                name: '_CodeSignature',
            },
        ]);

        expect(
            shared_crumbs_for('/jfcastro/Pictures/_CodeSignature'),
        ).toEqual([
            { label: '_CodeSignature', path: '/jfcastro/Pictures/_CodeSignature' },
        ]);
    });

    it('keeps the real path on every crumb below the root', () => {
        remember_shared_roots([
            {
                path: '/jfcastro/Pictures/_CodeSignature',
                mode: 'manage',
                name: '_CodeSignature',
            },
        ]);

        expect(
            shared_crumbs_for(
                '/jfcastro/Pictures/_CodeSignature/sub/CodeResources',
            ),
        ).toEqual([
            {
                label: '_CodeSignature',
                path: '/jfcastro/Pictures/_CodeSignature',
            },
            {
                label: 'sub',
                path: '/jfcastro/Pictures/_CodeSignature/sub',
            },
            {
                label: 'CodeResources',
                path: '/jfcastro/Pictures/_CodeSignature/sub/CodeResources',
            },
        ]);
    });

    it('never shows the owner or their folders above the share', () => {
        remember_shared_roots([
            {
                path: '/jfcastro/Documents/Contents',
                mode: 'write',
                name: 'Contents',
            },
        ]);

        const labels = shared_crumbs_for(
            '/jfcastro/Documents/Contents/deep/f.txt',
        ).map((c) => c.label);
        expect(labels).toEqual(['Contents', 'deep', 'f.txt']);
        expect(labels).not.toContain('jfcastro');
        expect(labels).not.toContain('Documents');
    });

    it('falls back to the leaf alone when the share list is not loaded', () => {
        expect(shared_crumbs_for('/jfcastro/Documents/Contents/f.txt')).toEqual(
            [
                {
                    label: 'f.txt',
                    path: '/jfcastro/Documents/Contents/f.txt',
                },
            ],
        );
    });

    it('prefers the nearest shared root', () => {
        remember_shared_roots([
            { path: '/jfcastro/Documents', mode: 'read', name: 'Documents' },
            {
                path: '/jfcastro/Documents/Contents',
                mode: 'write',
                name: 'Contents',
            },
        ]);

        expect(
            shared_crumbs_for('/jfcastro/Documents/Contents/f.txt')[0].label,
        ).toBe('Contents');
    });
});
