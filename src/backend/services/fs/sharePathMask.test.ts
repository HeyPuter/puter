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
    SharePathMasker,
    maskPathForRequest,
    maskerFor,
    parseMaskedSharePath,
    resolveSharePath,
} from './sharePathMask';
import { runWithContext } from '../../core/context';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore';
import type { Actor } from '../../core/actor';

const UID = '11111111-2222-3333-4444-555555555555';

const actorFor = (username: string, id: number) =>
    ({ user: { id, username } }) as Actor;

const storeWith = (entries: Record<string, unknown>) =>
    ({
        getEntryByUuid: async (uuid: string) => entries[uuid] ?? null,
    }) as unknown as FSEntryStore;

describe('parseMaskedSharePath', () => {
    it('reads owner, root and tail', () => {
        expect(parseMaskedSharePath(`/alice/${UID}/Report.pdf`)).toEqual({
            ownerUsername: 'alice',
            rootUuid: UID,
            tail: 'Report.pdf',
        });
    });

    it('rejects anything whose second segment is not a uuid', () => {
        expect(parseMaskedSharePath('/alice/Documents/x.txt')).toBeNull();
        expect(parseMaskedSharePath('/alice')).toBeNull();
        expect(parseMaskedSharePath('relative/path')).toBeNull();
    });
});

describe('resolveSharePath', () => {
    const store = storeWith({
        [UID]: { uuid: UID, name: 'Work', path: '/alice/Documents/Work' },
    });
    const bob = actorFor('bob', 2);

    it('rewrites a masked path to the owner’s real one', async () => {
        expect(await resolveSharePath(store, bob, `/alice/${UID}/Work`)).toBe(
            '/alice/Documents/Work',
        );
        expect(
            await resolveSharePath(store, bob, `/alice/${UID}/Work/sub/f.txt`),
        ).toBe('/alice/Documents/Work/sub/f.txt');
    });

    it('leaves your own paths alone without a lookup', async () => {
        const alice = actorFor('alice', 1);
        expect(await resolveSharePath(store, alice, `/alice/${UID}/Work`)).toBe(
            `/alice/${UID}/Work`,
        );
    });

    it('refuses to address a sibling the mask does not name', async () => {
        // The segment after the uuid has to be the shared entry's own name,
        // or the mask becomes a way to walk the owner's folder by guessing.
        expect(
            await resolveSharePath(store, bob, `/alice/${UID}/Secrets/x.txt`),
        ).toBe(`/alice/${UID}/Secrets/x.txt`);
    });

    it('will not resolve the masked root on its own', async () => {
        // It stands in for the owner's parent directory, which is not the
        // recipient's to reach.
        expect(await resolveSharePath(store, bob, `/alice/${UID}`)).toBe(
            `/alice/${UID}`,
        );
    });

    it('refuses a mask naming someone other than the entry’s owner', async () => {
        // A folder of alice's literally named with the uuid of carol's file
        // must not redirect a caller onto carol's file — or onto anything the
        // uuid resolves to that alice does not own.
        const carolStore = storeWith({
            [UID]: { uuid: UID, name: 'notes.txt', path: '/carol/notes.txt' },
        });
        expect(
            await resolveSharePath(carolStore, bob, `/alice/${UID}/notes.txt`),
        ).toBe(`/alice/${UID}/notes.txt`);
    });

    it('refuses dot segments below the root', async () => {
        expect(
            await resolveSharePath(store, bob, `/alice/${UID}/Work/../../x`),
        ).toBe(`/alice/${UID}/Work/../../x`);
    });

    it('passes an unknown uuid through as a literal path', async () => {
        const other = '99999999-2222-3333-4444-555555555555';
        expect(await resolveSharePath(store, bob, `/alice/${other}/x`)).toBe(
            `/alice/${other}/x`,
        );
    });
});

describe('SharePathMasker', () => {
    it('leaves entries you own untouched', () => {
        const masker = new SharePathMasker(1);
        expect(
            masker.mask({
                path: '/alice/Documents/f.txt',
                uuid: UID,
                name: 'f.txt',
                userId: 1,
            }),
        ).toBe('/alice/Documents/f.txt');
    });

    it('masks a foreign entry against itself when no root is known', () => {
        const masker = new SharePathMasker(2);
        expect(
            masker.mask({
                path: '/alice/Documents/Work/f.txt',
                uuid: UID,
                name: 'f.txt',
                userId: 1,
            }),
        ).toBe(`/alice/${UID}/f.txt`);
    });

    it('keeps a learned root, so a shared tree stays navigable', () => {
        const masker = new SharePathMasker(2);
        masker.learn('/alice/Documents/Work', `/alice/${UID}/Work`);
        expect(
            masker.mask({
                path: '/alice/Documents/Work/sub/f.txt',
                uuid: 'child-uuid',
                name: 'f.txt',
                userId: 1,
            }),
        ).toBe(`/alice/${UID}/Work/sub/f.txt`);
    });

    it('prefers the deepest learned root', () => {
        const masker = new SharePathMasker(2);
        masker.learn('/alice/Documents', `/alice/${UID}/Documents`);
        masker.learn('/alice/Documents/Work', '/alice/deeper/Work');
        expect(
            masker.mask({
                path: '/alice/Documents/Work/f.txt',
                uuid: 'child-uuid',
                name: 'f.txt',
                userId: 1,
            }),
        ).toBe('/alice/deeper/Work/f.txt');
    });
});

describe('maskerFor', () => {
    const run = <T>(fn: () => T): T => runWithContext({}, fn);

    it('adopts the actor when the first caller had none', () => {
        run(() => {
            // Whoever touches the masker first fixes its actor. A caller that
            // runs before the request context knows who is acting would
            // otherwise pin `undefined` for the whole request — and `mask()`
            // then publishes every path unmasked, which is the failure that
            // matters.
            const blind = maskerFor(undefined) as SharePathMasker;
            blind.learn('/alice/Documents/Work', `/alice/${UID}/Work`);
            expect(blind.actorUserId).toBeUndefined();

            const seeing = maskerFor(actorFor('bob', 2)) as SharePathMasker;
            expect(seeing.actorUserId).toBe(2);
            // The roots it already proved carry over.
            expect(
                seeing.mask({
                    path: '/alice/Documents/Work/f.txt',
                    uuid: 'child',
                    name: 'f.txt',
                    userId: 1,
                }),
            ).toBe(`/alice/${UID}/Work/f.txt`);
        });
    });

    it('starts over rather than lend one actor’s roots to another', () => {
        run(() => {
            const first = maskerFor(actorFor('bob', 2)) as SharePathMasker;
            first.learn('/alice/Documents/Work', `/alice/${UID}/Work`);

            const second = maskerFor(actorFor('carol', 3)) as SharePathMasker;
            expect(second.actorUserId).toBe(3);
            expect(second.learnedRoots()).toEqual([]);
        });
    });

    it('masks a bare path against the roots this request proved', () => {
        run(() => {
            const masker = maskerFor(actorFor('bob', 2)) as SharePathMasker;
            masker.learn('/alice/Documents/Work', `/alice/${UID}/Work`);
            // A pending upload has no row yet, so there is no entry to mask.
            expect(maskPathForRequest('/alice/Documents/Work/new.txt')).toBe(
                `/alice/${UID}/Work/new.txt`,
            );
            // Nothing proved about it — the caller named it themselves.
            expect(maskPathForRequest('/bob/Desktop/mine.txt')).toBe(
                '/bob/Desktop/mine.txt',
            );
        });
    });
});
