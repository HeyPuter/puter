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

import { describe, expect, it } from 'vitest';
import {
    isShareRoot,
    maskUnder,
    parseSharePath,
    toSharePath,
} from './sharePaths.js';

const UID = 'a4332293-4dbe-4f50-a9bc-2835928ce076';

describe('parseSharePath', () => {
    it('reads the root on its own', () => {
        expect(parseSharePath(`~/share/${UID}`)).toEqual({
            rootUid: UID,
            rest: '',
        });
    });

    it('reads a path below the root', () => {
        expect(parseSharePath(`~/share/${UID}/a/b.txt`)).toEqual({
            rootUid: UID,
            rest: 'a/b.txt',
        });
    });

    it('tolerates a trailing slash', () => {
        expect(parseSharePath(`~/share/${UID}/`)).toEqual({
            rootUid: UID,
            rest: '',
        });
    });

    it('leaves a real folder the user made at ~/share alone', () => {
        expect(parseSharePath('~/share')).toBeNull();
        expect(parseSharePath('~/share/notes.txt')).toBeNull();
        expect(parseSharePath('~/share/2024/photo.png')).toBeNull();
    });

    it('leaves ordinary paths alone', () => {
        expect(parseSharePath('/jf/Documents/a.txt')).toBeNull();
        expect(parseSharePath('~/Documents/a.txt')).toBeNull();
        expect(parseSharePath('')).toBeNull();
        expect(parseSharePath(undefined as unknown as string)).toBeNull();
    });

    it('rejects a segment that only looks uid-ish', () => {
        expect(parseSharePath('~/share/not-a-uid/a.txt')).toBeNull();
        expect(parseSharePath(`~/share/${UID}xyz/a.txt`)).toBeNull();
    });
});

describe('toSharePath', () => {
    it('addresses the root', () => {
        expect(toSharePath(UID)).toBe(`~/share/${UID}`);
    });

    it('addresses something below it', () => {
        expect(toSharePath(UID, 'a/b.txt')).toBe(`~/share/${UID}/a/b.txt`);
    });

    it('does not double the separator', () => {
        expect(toSharePath(UID, '/a.txt')).toBe(`~/share/${UID}/a.txt`);
    });

    it('round-trips through parseSharePath', () => {
        expect(parseSharePath(toSharePath(UID, 'a/b.txt'))).toEqual({
            rootUid: UID,
            rest: 'a/b.txt',
        });
    });
});

describe('isShareRoot', () => {
    it('recognizes the virtual directory itself', () => {
        expect(isShareRoot('~/share')).toBe(true);
        expect(isShareRoot(`~/share/${UID}`)).toBe(false);
        expect(isShareRoot('/jf/share')).toBe(false);
    });
});

describe('maskUnder', () => {
    it('masks the shared root itself', () => {
        expect(maskUnder('/jf/Documents/Contents', '/jf/Documents/Contents', UID)).toBe(
            `~/share/${UID}`,
        );
    });

    it('masks something inside the shared root', () => {
        expect(
            maskUnder(
                '/jf/Documents/Contents/a/b.txt',
                '/jf/Documents/Contents',
                UID,
            ),
        ).toBe(`~/share/${UID}/a/b.txt`);
    });

    it('refuses a path outside the root', () => {
        expect(
            maskUnder('/jf/Documents/Other', '/jf/Documents/Contents', UID),
        ).toBeNull();
    });

    it('refuses a sibling whose name merely starts the same', () => {
        expect(
            maskUnder(
                '/jf/Documents/ContentsBackup/a.txt',
                '/jf/Documents/Contents',
                UID,
            ),
        ).toBeNull();
    });
});
