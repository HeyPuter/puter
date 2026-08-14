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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { is_share_path, parent_path_for } from './share_paths.js';
import { trash_path_for } from './path_owner.js';

const UID = 'a4332293-4dbe-4f50-a9bc-2835928ce076';

beforeEach(() => {
    globalThis.window = { shared_path: 'puter://shared', user: { username: 'me' } };
});

describe('is_share_path', () => {
    it('recognizes a shared root and what is under it', () => {
        expect(is_share_path(`~/share/${UID}`)).toBe(true);
        expect(is_share_path(`~/share/${UID}/a/b.txt`)).toBe(true);
    });

    it('leaves a real folder at ~/share alone', () => {
        expect(is_share_path('~/share')).toBe(false);
        expect(is_share_path('~/share/notes.txt')).toBe(false);
    });

    it('leaves ordinary paths alone', () => {
        expect(is_share_path('/me/Documents/a.txt')).toBe(false);
        expect(is_share_path(undefined)).toBe(false);
    });
});

describe('parent_path_for', () => {
    const resolve = vi.fn((p) => `resolved(${p})`);

    beforeEach(() => resolve.mockClear());

    it('sends a shared root back to the Shared view', () => {
        expect(parent_path_for(`~/share/${UID}`, resolve)).toBe(
            'puter://shared',
        );
        expect(resolve).not.toHaveBeenCalled();
    });

    it('resolves normally inside a shared root', () => {
        expect(parent_path_for(`~/share/${UID}/a/b.txt`, resolve)).toBe(
            `resolved(~/share/${UID}/a/b.txt)`,
        );
    });

    it('resolves ordinary paths normally', () => {
        expect(parent_path_for('/me/Documents/a.txt', resolve)).toBe(
            'resolved(/me/Documents/a.txt)',
        );
    });
});

describe('trash_path_for', () => {
    it('uses the owner carried on the entry for a masked path', () => {
        expect(trash_path_for(`~/share/${UID}/a.txt`, 'jf')).toBe('/jf/Trash');
    });

    it('reads the owner off an ordinary path', () => {
        expect(trash_path_for('/jf/Documents/a.txt')).toBe('/jf/Trash');
    });

    it('prefers an explicit owner over the path', () => {
        expect(trash_path_for('/jf/Documents/a.txt', 'other')).toBe(
            '/other/Trash',
        );
    });

    it('falls back to your own trash when nothing names an owner', () => {
        expect(trash_path_for(`~/share/${UID}/a.txt`)).toBe('/me/Trash');
    });
});
