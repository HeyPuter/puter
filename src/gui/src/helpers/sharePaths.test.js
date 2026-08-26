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
import {
    is_share_root,
    parent_path_for,
    parse_shared_path,
    shared_crumbs_for,
    shared_uids_from_paths,
} from './sharePaths.js';

const UID = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
    globalThis.window = {
        user: { username: 'sharemate' },
        shared_path: 'puter://shared',
    };
});

describe('parse_shared_path', () => {
    it('reads owner, uid and the segments below it', () => {
        expect(parse_shared_path(`/jfcastro/${UID}/Contents/sub/f.txt`)).toEqual(
            { owner: 'jfcastro', uid: UID, segments: ['Contents', 'sub', 'f.txt'] },
        );
    });

    it('is not fooled by an ordinary path', () => {
        expect(parse_shared_path('/jfcastro/Documents/f.txt')).toBeNull();
        expect(parse_shared_path(`/jfcastro/${UID}`)).toBeNull();
        expect(parse_shared_path('relative')).toBeNull();
    });
});

describe('shared_uids_from_paths', () => {
    const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    it('reads each link value down to the uid it names, once', () => {
        expect(shared_uids_from_paths([
            `/jfcastro/${UID}/Contents`,
            `/jfcastro/${UID.toUpperCase()}/Contents`,
            `/other/${OTHER}/f.txt`,
        ])).toEqual([UID, OTHER]);
    });

    it('drops anything that is not a shared path', () => {
        expect(shared_uids_from_paths([
            '',
            '/jfcastro/Documents/f.txt',
            `/jfcastro/${UID}`,
            'not a path',
            `/jfcastro/${UID}/f.txt`,
        ])).toEqual([UID]);
        expect(shared_uids_from_paths(undefined)).toEqual([]);
    });
});

describe('is_share_root', () => {
    it('is true only for the shared item itself', () => {
        expect(is_share_root(`/jfcastro/${UID}/Contents`)).toBe(true);
        expect(is_share_root(`/jfcastro/${UID}/Contents/sub`)).toBe(false);
        expect(is_share_root('/sharemate/Documents')).toBe(false);
    });
});

describe('parent_path_for', () => {
    it('sends the shared item up to Shared, not into the owner’s folder', () => {
        expect(parent_path_for(`/jfcastro/${UID}/Contents`)).toBe(
            'puter://shared',
        );
    });

    it('walks normally inside the shared item', () => {
        expect(parent_path_for(`/jfcastro/${UID}/Contents/sub`)).toBe(
            `/jfcastro/${UID}/Contents`,
        );
    });

    it('stops at Shared', () => {
        expect(parent_path_for('puter://shared')).toBe('puter://shared');
    });

    it('leaves ordinary paths to ordinary rules', () => {
        expect(parent_path_for('/sharemate/Documents/a.txt')).toBe(
            '/sharemate/Documents',
        );
        expect(parent_path_for('/sharemate')).toBe('/');
    });
});

describe('shared_crumbs_for', () => {
    it('leaves the viewer’s own paths unmasked', () => {
        expect(shared_crumbs_for('/sharemate/Documents/a.txt')).toBeNull();
    });

    it('shows a shared item by its own name', () => {
        expect(shared_crumbs_for(`/jfcastro/${UID}/_CodeSignature`)).toEqual([
            { label: '_CodeSignature', path: `/jfcastro/${UID}/_CodeSignature` },
        ]);
    });

    it('keeps the addressable path on every crumb below it', () => {
        expect(
            shared_crumbs_for(`/jfcastro/${UID}/Contents/sub/CodeResources`),
        ).toEqual([
            { label: 'Contents', path: `/jfcastro/${UID}/Contents` },
            { label: 'sub', path: `/jfcastro/${UID}/Contents/sub` },
            {
                label: 'CodeResources',
                path: `/jfcastro/${UID}/Contents/sub/CodeResources`,
            },
        ]);
    });

    it('never names the owner’s folders above the share', () => {
        const labels = shared_crumbs_for(
            `/jfcastro/${UID}/Contents/deep/f.txt`,
        ).map((c) => c.label);
        expect(labels).toEqual(['Contents', 'deep', 'f.txt']);
        expect(labels).not.toContain('Documents');
    });
});
