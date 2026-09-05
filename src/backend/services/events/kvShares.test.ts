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

import { v4 as uuidv4 } from 'uuid';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PermissionUtil } from '../permission/permissionUtil.js';
import {
    assertBoundedManageGrant,
    assertShareableAppUid,
    assertShareablePermission,
    assertShareablePrefix,
    keyPrefixSegments,
    kvShareGrantCovers,
    kvShareManagePermission,
    kvShareOwnerImplicator,
    kvSharePermission,
    mintKvHandleId,
    normalizeKeyPrefix,
    relativeToKvShareRoot,
} from './kvShares.js';
import { isKvHandleId, kvHandleFromSubject } from './subjects.js';

const OWNER = '2a1b0c9d-0000-4000-8000-000000000001';
const OTHER = '2a1b0c9d-0000-4000-8000-000000000002';
const APP = 'app-1234';

const userActor = (uuid: string): Actor =>
    ({ user: { uuid }, effectiveApp: null }) as unknown as Actor;

describe('the share permission family', () => {
    it('names the owner, the app and the granted prefix', () => {
        expect(kvSharePermission(OWNER, APP, 'workspace:abc:')).toBe(
            `kv-share:${OWNER}:${APP}:workspace:abc`,
        );
    });

    it('makes key segments components, so a deeper key is a descendant', () => {
        const granted = kvSharePermission(OWNER, APP, 'workspace:abc:');
        const deeper = kvSharePermission(
            OWNER,
            APP,
            'workspace:abc:messages:1',
        );

        // The exploder walks parents of the string being checked, so implication
        // over key segments needs nothing of its own.
        expect(deeper.startsWith(`${granted}:`)).toBe(true);
    });

    it('escapes a `:` inside a component rather than splitting on it', () => {
        const permission = kvSharePermission(OWNER, 'app:odd', 'cart:');
        expect(PermissionUtil.split(permission)).toEqual([
            'kv-share',
            OWNER,
            'app:odd',
            'cart',
        ]);
    });

    it('reads a withdrawn grant as covering itself and everything under it', () => {
        const granted = kvSharePermission(OWNER, APP, 'workspace:abc:');
        expect(kvShareGrantCovers(granted, granted)).toBe(true);
        expect(
            kvShareGrantCovers(
                granted,
                kvSharePermission(OWNER, APP, 'workspace:abc:messages:'),
            ),
        ).toBe(true);
        // A sibling that merely shares a text prefix is a different region.
        expect(
            kvShareGrantCovers(
                granted,
                kvSharePermission(OWNER, APP, 'workspace:abcdef:'),
            ),
        ).toBe(false);
        expect(
            kvShareGrantCovers(
                granted,
                kvSharePermission(OTHER, APP, 'workspace:abc:'),
            ),
        ).toBe(false);
    });

    it('never reads a withdrawn child as covering its own parent', () => {
        // Revoking the deeper of two grants must not read as covering the
        // shallower one — coverage only ever runs downward.
        const child = kvSharePermission(OWNER, APP, 'workspace:abc:messages:');
        const parent = kvSharePermission(OWNER, APP, 'workspace:abc:');
        expect(kvShareGrantCovers(child, parent)).toBe(false);
    });
});

describe('granted prefixes', () => {
    it('always ends on the key delimiter', () => {
        expect(normalizeKeyPrefix('workspace:abc')).toBe('workspace:abc:');
        expect(normalizeKeyPrefix('workspace:abc:')).toBe('workspace:abc:');
        expect(keyPrefixSegments('workspace:abc:')).toEqual([
            'workspace',
            'abc',
        ]);
    });

    it.each([
        ['', 'the whole namespace'],
        [':', 'delimiters only'],
        ['workspace:*', 'a pattern'],
        ['workspace:a?c', 'a single-character pattern'],
        // Normalizing would drop the empty segment and grant `a:b:` instead —
        // a region other than the one asked for.
        ['workspace::abc:', 'an empty key segment'],
        [':workspace:abc:', 'a leading empty segment'],
    ])('refuses %s (%s)', (prefix) => {
        let thrown: unknown;
        try {
            assertShareablePrefix(prefix);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(HttpError);
        expect((thrown as HttpError).legacyCode).toBe(
            'invalid_kv_share_prefix',
        );
    });

    it('refuses a region too deep to fit the grant column', () => {
        const deep = kvSharePermission(OWNER, APP, 'a'.repeat(300));
        expect(() => assertShareablePermission(deep)).toThrow(HttpError);
        expect(
            assertShareablePermission(
                kvSharePermission(OWNER, APP, 'workspace:abc:'),
            ),
        ).toBeTypeOf('string');
    });

    it('keeps the trailing delimiter optional', () => {
        expect(assertShareablePrefix('workspace:abc')).toBe('workspace:abc:');
        expect(assertShareablePrefix('workspace:abc:')).toBe('workspace:abc:');
    });
});

describe('granted namespaces', () => {
    it('takes an app uid, and the app-less namespace', () => {
        expect(assertShareableAppUid(APP)).toBe(APP);
        expect(assertShareableAppUid('os-global')).toBe('os-global');
    });

    it('refuses one past the column it is stored in', () => {
        // A longer one reaches the insert as a write the column cannot hold.
        let thrown: unknown;
        try {
            assertShareableAppUid('a'.repeat(41));
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(HttpError);
        expect((thrown as HttpError).statusCode).toBe(400);
    });

    it('takes both shapes a real app uid comes in', () => {
        // Minted (`app-<uuidv4>`) and derived from an origin (`app-<uuidv5>`)
        // — 40 characters either way, which is the column exactly.
        const minted = `app-${uuidv4()}`;
        expect(assertShareableAppUid(minted)).toBe(minted);
        expect(minted).toHaveLength(40);
    });

    it('refuses a handle, which shares the slot but is not a namespace', () => {
        expect(() => assertShareableAppUid(mintKvHandleId())).toThrow(
            HttpError,
        );
    });

    it('refuses anything else short enough to fit the column', () => {
        // The slot ends up in a subject and in a permission string, so a
        // namespace carrying a delimiter of either grammar is refused before
        // it can be composed into one.
        for (const uid of [
            'os-globals',
            'workspace:abc',
            'app',
            'app-',
            'app-a:b',
            'app-a#b',
            'v1:someone:app-x',
            '',
        ])
            expect(() => assertShareableAppUid(uid)).toThrow(HttpError);
    });
});

describe('keys inside a granted region', () => {
    const permission = kvSharePermission(OWNER, APP, 'workspace:abc:');

    it('are named relative to the granted root', () => {
        expect(
            relativeToKvShareRoot(permission, 'workspace:abc:messages:1'),
        ).toBe('messages:1');
    });

    it('read as outside when they are', () => {
        expect(
            relativeToKvShareRoot(permission, 'workspace:abcdef:x'),
        ).toBeNull();
        expect(relativeToKvShareRoot(permission, 'workspace:abc')).toBeNull();
    });
});

describe('a delegation request', () => {
    const region = kvShareManagePermission(
        kvSharePermission(OWNER, APP, 'workspace:abc:'),
    );

    it('is the manage arm of the grant it would let an app issue', () => {
        expect(region).toBe(`manage:kv-share:${OWNER}:${APP}:workspace:abc`);
        expect(assertBoundedManageGrant(region)).toBe(region);
    });

    it.each([
        ['manage:kv-share', 'the family itself'],
        [`manage:kv-share:${OWNER}`, 'an owner and no namespace'],
        [`manage:kv-share:${OWNER}:${APP}`, 'a whole namespace'],
    ])('refuses %s (%s)', (permission) => {
        let thrown: unknown;
        try {
            assertBoundedManageGrant(permission);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(HttpError);
        expect((thrown as HttpError).legacyCode).toBe(
            'invalid_kv_share_prefix',
        );
    });

    it('leaves permissions from other families alone', () => {
        const unrelated = `manage:fs:${OWNER}:write`;
        expect(assertBoundedManageGrant(unrelated)).toBe(unrelated);
        // The read arm of this family is not a delegation, so it is not this
        // check's to bound.
        expect(assertBoundedManageGrant(`kv-share:${OWNER}:${APP}`)).toBeTypeOf(
            'string',
        );
    });
});

describe('handle ids', () => {
    it('are told apart from an app uid in the same slot', () => {
        const handle = mintKvHandleId();
        expect(isKvHandleId(handle)).toBe(true);
        expect(isKvHandleId(APP)).toBe(false);
        expect(isKvHandleId('kvh-')).toBe(false);
    });

    it('carry nothing about the owner', () => {
        const handle = mintKvHandleId();
        expect(handle).not.toContain(OWNER);
        expect(mintKvHandleId()).not.toBe(handle);
    });

    it('are recoverable from the subject a row stored', () => {
        const handle = mintKvHandleId();
        expect(kvHandleFromSubject(`kv:${handle}:messages:*`)).toBe(handle);
        expect(kvHandleFromSubject(`kv:${APP}:messages:*`)).toBeNull();
        expect(kvHandleFromSubject(`fs:${handle}:write`)).toBeNull();
    });
});

describe('the owner implicator', () => {
    const implicator = kvShareOwnerImplicator();
    const permission = kvSharePermission(OWNER, APP, 'workspace:abc:');

    it('answers the share family and its manage arm', () => {
        expect(implicator.matches(permission)).toBe(true);
        expect(implicator.matches(`manage:${permission}`)).toBe(true);
        expect(implicator.matches(`fs:${OWNER}:read`)).toBe(false);
    });

    it('holds for the owner named in the permission, and nobody else', () => {
        expect(
            implicator.check({ actor: userActor(OWNER), permission }),
        ).toEqual({});
        expect(
            implicator.check({
                actor: userActor(OWNER),
                permission: `manage:${permission}`,
            }),
        ).toEqual({});
        expect(
            implicator.check({ actor: userActor(OTHER), permission }),
        ).toBeUndefined();
    });

    it('reads the owner past a `manage` key segment', () => {
        // Stripping every `manage:` rather than the leading one would rewrite
        // the string the owner is read out of.
        const nested = kvSharePermission(OWNER, APP, 'manage:secrets:');
        expect(implicator.matches(nested)).toBe(true);
        expect(
            implicator.check({ actor: userActor(OWNER), permission: nested }),
        ).toEqual({});
        expect(
            implicator.check({ actor: userActor(OTHER), permission: nested }),
        ).toBeUndefined();
    });

    it('never answers for an app or a token acting through the owner', () => {
        const appActor = {
            user: { uuid: OWNER },
            app: { uid: APP },
        } as unknown as Actor;
        expect(
            implicator.check({ actor: appActor, permission }),
        ).toBeUndefined();
    });
});
