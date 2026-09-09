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
    assertCreatablePath,
    fsCreateKindFor,
    MAX_CREATE_DEPTH,
    parseCreateFlag,
    parseFsPathPermission,
} from './fsPathPermission.js';

describe('parseFsPathPermission', () => {
    it('splits a plain path-addressed permission', () => {
        expect(parseFsPathPermission('fs:/dan/.mail:write')).toEqual({
            hasManage: false,
            path: '/dan/.mail',
            rest: ['write'],
        });
    });

    it('splits a manage-prefixed permission and keeps the flag', () => {
        expect(parseFsPathPermission('manage:fs:/dan/.mail:write')).toEqual({
            hasManage: true,
            path: '/dan/.mail',
            rest: ['write'],
        });
    });

    it('keeps everything after the path as `rest`, however long', () => {
        expect(parseFsPathPermission('fs:/dan/x:read:extra')).toEqual({
            hasManage: false,
            path: '/dan/x',
            rest: ['read', 'extra'],
        });
    });

    it('does not mistake a path containing `fs:` for the mode delimiter', () => {
        // A raw `split('fs:')` would drop the mode and strip the trailing `fs`.
        expect(parseFsPathPermission('fs:/danfs:junk:read')).toEqual({
            hasManage: false,
            path: '/danfs',
            rest: ['junk', 'read'],
        });
    });

    it('is null for a uid-addressed fs permission', () => {
        expect(parseFsPathPermission('fs:11111111-1111-1111-1111-111111111111:read')).toBeNull();
    });

    it('is null for a non-fs permission', () => {
        expect(parseFsPathPermission('apps-of-user:u-1:read')).toBeNull();
    });

    it('is null for a bare `fs` with nothing after it', () => {
        expect(parseFsPathPermission('fs:read')).toBeNull();
    });
});

describe('fsCreateKindFor', () => {
    it.each([
        ['.mail', 'dir'],
        ['.config', 'dir'],
        ['Documents', 'dir'],
        ['notes.txt', 'file'],
        ['.env.local', 'file'],
        ['archive.tar.gz', 'file'],
    ] as const)('%s -> %s', (basename, expected) => {
        expect(fsCreateKindFor(basename)).toBe(expected);
    });

    it('reads a dot in a directory name as a file — the documented wart', () => {
        expect(fsCreateKindFor('my.folder')).toBe('file');
    });
});

describe('parseCreateFlag', () => {
    it('treats absent/null as false', () => {
        expect(parseCreateFlag(undefined)).toBe(false);
        expect(parseCreateFlag(null)).toBe(false);
    });

    it('passes true/false through unchanged', () => {
        expect(parseCreateFlag(true)).toBe(true);
        expect(parseCreateFlag(false)).toBe(false);
    });

    it("passes 'dir'/'file' through unchanged", () => {
        expect(parseCreateFlag('dir')).toBe('dir');
        expect(parseCreateFlag('file')).toBe('file');
    });

    it('rejects anything else with 400 bad_request', () => {
        for (const value of ['true', 'false', 'sock', 1, {}, []]) {
            expect(() => parseCreateFlag(value)).toThrowError(
                expect.objectContaining({
                    statusCode: 400,
                    legacyCode: 'bad_request',
                }),
            );
        }
    });
});

describe('assertCreatablePath', () => {
    it('allows a path inside the caller own home', () => {
        expect(() => assertCreatablePath('/dan/.mail', 'dan')).not.toThrow();
    });

    it("rejects another user's home with 403 forbidden", () => {
        expect(() => assertCreatablePath('/bob/x', 'dan')).toThrowError(
            expect.objectContaining({ statusCode: 403, legacyCode: 'forbidden' }),
        );
    });

    it('rejects the bare home directory itself', () => {
        expect(() => assertCreatablePath('/dan', 'dan')).toThrowError(
            expect.objectContaining({ statusCode: 403, legacyCode: 'forbidden' }),
        );
    });

    it('rejects AppData', () => {
        expect(() => assertCreatablePath('/dan/AppData/x', 'dan')).toThrowError(
            expect.objectContaining({ statusCode: 403, legacyCode: 'forbidden' }),
        );
    });

    it('rejects Trash', () => {
        expect(() => assertCreatablePath('/dan/Trash/x', 'dan')).toThrowError(
            expect.objectContaining({ statusCode: 403, legacyCode: 'forbidden' }),
        );
    });

    it('allows exactly MAX_CREATE_DEPTH components below home', () => {
        const deep = `/dan/${Array.from({ length: MAX_CREATE_DEPTH }, (_, i) => `d${i}`).join('/')}`;
        expect(() => assertCreatablePath(deep, 'dan')).not.toThrow();
    });

    it('rejects more than MAX_CREATE_DEPTH components below home', () => {
        const tooDeep = `/dan/${Array.from({ length: MAX_CREATE_DEPTH + 1 }, (_, i) => `d${i}`).join('/')}`;
        expect(() => assertCreatablePath(tooDeep, 'dan')).toThrowError(
            expect.objectContaining({
                statusCode: 400,
                legacyCode: 'directory_depth_limit_exceeded',
            }),
        );
    });
});
