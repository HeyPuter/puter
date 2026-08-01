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

import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../core/http/HttpError.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import {
    assertNormalized,
    expandTildePath,
    joinChildPath,
    normalizeAbsolutePath,
    resolveNode,
    splitParentAndName,
} from './resolveNode.js';

const makeEntry = (over: Partial<FSEntry> = {}): FSEntry =>
    ({
        id: 7,
        uuid: 'uuid-7',
        uid: 'uuid-7',
        userId: 1,
        path: '/alice/Documents/notes.txt',
        name: 'notes.txt',
        isDir: false,
        ...over,
    }) as FSEntry;

/**
 * A store double is the right seam here: `resolveNode` is a pure dispatcher
 * over three store lookups, and the interesting behaviour is _which_ lookup it
 * picks and what it does with a miss.
 */
const makeStore = (over: Partial<Record<string, unknown>> = {}) =>
    ({
        getEntryByUuid: vi.fn(async () => null),
        getEntryById: vi.fn(async () => null),
        getEntryByPath: vi.fn(async () => null),
        ...over,
    }) as unknown as FSEntryStore & {
        getEntryByUuid: ReturnType<typeof vi.fn>;
        getEntryById: ReturnType<typeof vi.fn>;
        getEntryByPath: ReturnType<typeof vi.fn>;
    };

const expectHttpError = async (
    run: () => Promise<unknown>,
    statusCode: number,
    legacyCode: string,
): Promise<HttpError> => {
    const error = await run().then(
        () => null,
        (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    const httpError = error as HttpError;
    expect(httpError.statusCode).toBe(statusCode);
    expect(httpError.legacyCode).toBe(legacyCode);
    return httpError;
};

describe('resolveNode', () => {
    it('passes a pre-fetched entry straight through without hitting the store', async () => {
        const store = makeStore();
        const entry = makeEntry();

        await expect(resolveNode(store, { entry })).resolves.toBe(entry);
        expect(store.getEntryByUuid).not.toHaveBeenCalled();
        expect(store.getEntryById).not.toHaveBeenCalled();
        expect(store.getEntryByPath).not.toHaveBeenCalled();
    });

    it('prefers uid over id and path when several references are supplied', async () => {
        const entry = makeEntry();
        const store = makeStore({ getEntryByUuid: vi.fn(async () => entry) });

        await expect(
            resolveNode(store, { uid: 'uuid-7', id: 7, path: '/x' }),
        ).resolves.toBe(entry);
        expect(store.getEntryByUuid).toHaveBeenCalledWith('uuid-7');
        expect(store.getEntryById).not.toHaveBeenCalled();
        expect(store.getEntryByPath).not.toHaveBeenCalled();
    });

    it('accepts the `uuid` alias for `uid`', async () => {
        const entry = makeEntry();
        const store = makeStore({ getEntryByUuid: vi.fn(async () => entry) });

        await expect(resolveNode(store, { uuid: 'uuid-7' })).resolves.toBe(
            entry,
        );
    });

    it('returns null for a missing uid when `required` is not set', async () => {
        const store = makeStore();
        await expect(resolveNode(store, { uid: 'ghost' })).resolves.toBeNull();
    });

    it('throws 404 subject_does_not_exist for a missing uid when required', async () => {
        const store = makeStore();
        const error = await expectHttpError(
            () => resolveNode(store, { uid: 'ghost' }, { required: true }),
            404,
            'subject_does_not_exist',
        );
        expect(error.message).toContain('uuid=ghost');
    });

    it('falls back to id lookup when uid is blank', async () => {
        const entry = makeEntry();
        const store = makeStore({ getEntryById: vi.fn(async () => entry) });

        await expect(resolveNode(store, { uid: '   ', id: '7' })).resolves.toBe(
            entry,
        );
        expect(store.getEntryById).toHaveBeenCalledWith(7);
    });

    it('rejects a non-numeric id with 400 bad_request', async () => {
        const store = makeStore();
        await expectHttpError(
            () => resolveNode(store, { id: 'not-a-number' }),
            400,
            'bad_request',
        );
        expect(store.getEntryById).not.toHaveBeenCalled();
    });

    it('throws 404 for a missing numeric id when required', async () => {
        const store = makeStore();
        const error = await expectHttpError(
            () => resolveNode(store, { id: 404 }, { required: true }),
            404,
            'subject_does_not_exist',
        );
        expect(error.message).toContain('id=404');
    });

    it('resolves by path when no uid or id is given', async () => {
        const entry = makeEntry();
        const store = makeStore({ getEntryByPath: vi.fn(async () => entry) });

        await expect(
            resolveNode(store, { path: '/alice/Documents/notes.txt' }),
        ).resolves.toBe(entry);
        expect(store.getEntryByPath).toHaveBeenCalledWith(
            '/alice/Documents/notes.txt',
        );
    });

    it('throws 404 naming the path when a required path misses', async () => {
        const store = makeStore();
        const error = await expectHttpError(
            () =>
                resolveNode(store, { path: '/alice/gone' }, { required: true }),
            404,
            'subject_does_not_exist',
        );
        expect(error.message).toContain('path=/alice/gone');
    });

    it('rejects a reference with no usable selector', async () => {
        const store = makeStore();
        await expectHttpError(
            () => resolveNode(store, { path: '  ' }),
            400,
            'bad_request',
        );
    });
});

describe('splitParentAndName', () => {
    it('splits a nested absolute path', () => {
        expect(splitParentAndName('/alice/Documents/notes.txt')).toEqual({
            parentPath: '/alice/Documents',
            name: 'notes.txt',
        });
    });

    it('reports root as the parent of a top-level entry', () => {
        expect(splitParentAndName('/alice')).toEqual({
            parentPath: '/',
            name: 'alice',
        });
    });

    it('drops a trailing slash before splitting', () => {
        expect(splitParentAndName('/alice/Documents/')).toEqual({
            parentPath: '/alice',
            name: 'Documents',
        });
    });

    it('prefixes a relative path with a slash', () => {
        expect(splitParentAndName('alice/Documents')).toEqual({
            parentPath: '/alice',
            name: 'Documents',
        });
    });

    it('refuses to derive the parent of root', () => {
        expect(() => splitParentAndName('/')).toThrowError(
            /Cannot derive parent of root/,
        );
    });
});

describe('assertNormalized', () => {
    it('returns the input unchanged when already normalized', () => {
        expect(assertNormalized('/alice/Documents')).toBe('/alice/Documents');
    });

    it.each([
        ['/alice/../bob', 'parent traversal'],
        ['/alice/./bob', 'current-dir segment'],
        ['/alice//bob', 'double slash'],
    ])('rejects %s (%s)', (input) => {
        expect(() => assertNormalized(input)).toThrowError(/Invalid path/);
    });

    it('accepts unicode and spaces verbatim', () => {
        expect(assertNormalized('/alice/Dökümanlar/my file.txt')).toBe(
            '/alice/Dökümanlar/my file.txt',
        );
    });
});

describe('normalizeAbsolutePath', () => {
    it('trims surrounding whitespace and keeps the path absolute', () => {
        expect(normalizeAbsolutePath('  /alice/Documents  ')).toBe(
            '/alice/Documents',
        );
    });

    it('makes a relative path absolute', () => {
        expect(normalizeAbsolutePath('alice/Documents')).toBe(
            '/alice/Documents',
        );
    });

    it('strips a trailing slash but preserves bare root', () => {
        expect(normalizeAbsolutePath('/alice/')).toBe('/alice');
        expect(normalizeAbsolutePath('/')).toBe('/');
    });

    it('rejects an empty or whitespace-only path', () => {
        for (const input of ['', '   ']) {
            expect(() => normalizeAbsolutePath(input)).toThrowError(
                /Path cannot be empty/,
            );
        }
    });

    it('rejects a non-string path the same way as an empty one', () => {
        expect(() =>
            normalizeAbsolutePath(undefined as unknown as string),
        ).toThrowError(/Path cannot be empty/);
    });

    it('rejects traversal segments', () => {
        expect(() => normalizeAbsolutePath('/alice/../bob')).toThrowError(
            /Invalid path/,
        );
    });
});

describe('expandTildePath', () => {
    it('expands a bare tilde to the user home', () => {
        expect(expandTildePath('~', 'alice')).toBe('/alice');
    });

    it('expands a tilde prefix and keeps the remainder', () => {
        expect(expandTildePath('~/Documents/a.txt', 'alice')).toBe(
            '/alice/Documents/a.txt',
        );
    });

    it('leaves non-tilde paths untouched', () => {
        expect(expandTildePath('/bob/Documents', 'alice')).toBe(
            '/bob/Documents',
        );
    });

    it('does not expand a tilde that is not the leading segment', () => {
        expect(expandTildePath('/alice/~backup', 'alice')).toBe(
            '/alice/~backup',
        );
        expect(expandTildePath('~backup', 'alice')).toBe('~backup');
    });

    it('returns non-string input as-is', () => {
        expect(expandTildePath(null as unknown as string)).toBeNull();
    });

    it('rejects an expansion with no username to expand to', () => {
        expect(() => expandTildePath('~/Documents')).toThrowError(
            /Unable to resolve home path/,
        );
    });
});

describe('joinChildPath', () => {
    it('joins a child onto a nested parent', () => {
        expect(joinChildPath('/alice/Documents', 'a.txt')).toBe(
            '/alice/Documents/a.txt',
        );
    });

    it('joins a child onto root without doubling the slash', () => {
        expect(joinChildPath('/', 'alice')).toBe('/alice');
    });

    it('normalizes the parent before joining', () => {
        expect(joinChildPath('  alice/Documents/  ', 'a.txt')).toBe(
            '/alice/Documents/a.txt',
        );
    });

    it('rejects an empty name', () => {
        expect(() => joinChildPath('/alice', '')).toThrowError(
            /Name cannot be empty/,
        );
        expect(() =>
            joinChildPath('/alice', undefined as unknown as string),
        ).toThrowError(/Name cannot be empty/);
    });

    it('rejects a name containing a slash so callers cannot smuggle a path', () => {
        expect(() => joinChildPath('/alice', '../bob')).toThrowError(
            /Name cannot contain a slash/,
        );
    });
});
