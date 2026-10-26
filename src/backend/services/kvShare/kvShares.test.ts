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
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PermissionUtil } from '../permission/permissionUtil.js';
import {
    assertBoundedManageGrant,
    assertNewShareSegments,
    assertPrefixFitsAccess,
    assertShareableAppUid,
    assertShareablePrefix,
    isKvShareManagePermission,
    isKvSharePermission,
    keyPrefixSegments,
    KV_SHARE_PREFIX_MAX_BYTES,
    kvShareAccessOf,
    kvShareAppDelegateImplicator,
    kvShareGrantAtEveryLevel,
    kvShareGrantCovers,
    kvShareGrantPrefix,
    kvShareLevelForMethod,
    kvShareLevelsExploder,
    kvShareManageNamespaceRoots,
    kvShareManagePermission,
    kvShareOwnerImplicator,
    kvSharePermission,
    mintKvHandleId,
    normalizeKeyPrefix,
    parseKvShareAccess,
    parseKvShareLabel,
    parseKvShareRecipient,
    relativeToKvShareRoot,
    withKvShareAccess,
} from './kvShares.js';
import { APP_DATA_KV_METHOD_OPS } from '../permission/appDataScopes.js';
import { isKvHandleId, kvHandleFromSubject } from '../events/subjects.js';

const OWNER = '2a1b0c9d-0000-4000-8000-000000000001';
const OTHER = '2a1b0c9d-0000-4000-8000-000000000002';
const APP = 'app-1234';
const OTHER_APP = 'app-5678';

const userActor = (uuid: string): Actor =>
    ({ user: { uuid }, effectiveApp: null }) as unknown as Actor;

const appActor = (uuid: string, appUid: string): Actor =>
    ({
        user: { uuid },
        app: { uid: appUid },
        effectiveApp: { uid: appUid },
    }) as unknown as Actor;

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
        // Coverage never crosses namespaces: the app uid is what keeps a
        // revoke inside the one the handle was minted in.
        expect(
            kvShareGrantCovers(
                granted,
                kvSharePermission(OWNER, OTHER_APP, 'workspace:abc:messages:'),
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
        // `escape_permission_component` leaves `\\` alone while escaping `:`,
        // so the stored prefix and the permission string would disagree and
        // the share would silently never fire.
        ['work\\space:abc:', 'a backslash'],
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
        expect(() =>
            assertPrefixFitsAccess(OWNER, APP, 'a'.repeat(300), 'watch'),
        ).toThrow(HttpError);
        expect(
            assertPrefixFitsAccess(OWNER, APP, 'workspace:abc:', 'watch'),
        ).toBe(kvSharePermission(OWNER, APP, 'workspace:abc:'));
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

describe('the app delegate implicator', () => {
    const permission = kvSharePermission(OWNER, APP, 'workspace:abc:');

    it('answers the share family, never its manage arm, nor other families', () => {
        const implicator = kvShareAppDelegateImplicator({
            userHolds: vi.fn(),
        });
        expect(implicator.matches(permission)).toBe(true);
        expect(implicator.matches(`manage:${permission}`)).toBe(false);
        expect(implicator.matches(`fs:${OWNER}:read`)).toBe(false);
    });

    it("grants when the actor's own app matches the namespace app and the user holds the grant", async () => {
        const userHolds = vi.fn().mockResolvedValue(true);
        const implicator = kvShareAppDelegateImplicator({ userHolds });
        const actor = appActor(OWNER, APP);

        await expect(implicator.check({ actor, permission })).resolves.toEqual(
            {},
        );

        expect(userHolds).toHaveBeenCalledTimes(1);
        const [calledActor, calledPermission] = userHolds.mock.calls[0];
        expect(calledActor.app).toBeUndefined();
        expect(calledActor.effectiveApp).toBeNull();
        expect(calledActor.user).toEqual({ uuid: OWNER });
        expect(calledPermission).toBe(permission);
    });

    it('refuses when the user does not hold the grant', async () => {
        const implicator = kvShareAppDelegateImplicator({
            userHolds: vi.fn().mockResolvedValue(false),
        });
        await expect(
            implicator.check({ actor: appActor(OWNER, APP), permission }),
        ).resolves.toBeUndefined();
    });

    it("refuses when the actor's app differs from the namespace app", async () => {
        const userHolds = vi.fn().mockResolvedValue(true);
        const implicator = kvShareAppDelegateImplicator({ userHolds });

        await expect(
            implicator.check({
                actor: appActor(OWNER, OTHER_APP),
                permission,
            }),
        ).resolves.toBeUndefined();
        expect(userHolds).not.toHaveBeenCalled();
    });

    it('refuses a plain user actor with no app', async () => {
        const userHolds = vi.fn().mockResolvedValue(true);
        const implicator = kvShareAppDelegateImplicator({ userHolds });

        await expect(
            implicator.check({ actor: userActor(OWNER), permission }),
        ).resolves.toBeUndefined();
        expect(userHolds).not.toHaveBeenCalled();
    });

    it('refuses an access-token actor', async () => {
        const userHolds = vi.fn().mockResolvedValue(true);
        const implicator = kvShareAppDelegateImplicator({ userHolds });
        const actor = {
            user: { uuid: OWNER },
            app: { uid: APP },
            accessToken: { uid: 't' },
        } as unknown as Actor;

        await expect(
            implicator.check({ actor, permission }),
        ).resolves.toBeUndefined();
        expect(userHolds).not.toHaveBeenCalled();
    });

    it('asks the user once for a deep option and the ancestors its check already asked', async () => {
        const userHolds = vi.fn().mockResolvedValue(false);
        const implicator = kvShareAppDelegateImplicator({ userHolds });
        const actor = appActor(OWNER, APP);
        const memo = new Map<string, unknown>();
        const deep = kvSharePermission(OWNER, APP, 'a:b:c:', 'read');
        for (const permission of [
            deep,
            kvSharePermission(OWNER, APP, 'a:b:c:', 'write'),
            kvSharePermission(OWNER, APP, 'a:b:', 'read'),
            kvSharePermission(OWNER, APP, 'a:', 'write'),
        ])
            await expect(
                implicator.check({ actor, permission, memo }),
            ).resolves.toBeUndefined();
        expect(userHolds).toHaveBeenCalledTimes(1);

        // A lower level, or a region beside it, is a question of its own.
        await implicator.check({
            actor,
            permission: kvSharePermission(OWNER, APP, 'a:b:', 'watch'),
            memo,
        });
        await implicator.check({
            actor,
            permission: kvSharePermission(OWNER, APP, 'a:x:', 'read'),
            memo,
        });
        expect(userHolds).toHaveBeenCalledTimes(3);

        // Nothing carries over to another scan.
        await implicator.check({ actor, permission: deep });
        expect(userHolds).toHaveBeenCalledTimes(4);
    });

    it('refuses a permission with no key segments or no app', async () => {
        const userHolds = vi.fn().mockResolvedValue(true);
        const implicator = kvShareAppDelegateImplicator({ userHolds });
        const actor = appActor(OWNER, APP);

        await expect(
            implicator.check({
                actor,
                permission: PermissionUtil.join('kv-share', OWNER, APP),
            }),
        ).resolves.toBeUndefined();
        await expect(
            implicator.check({
                actor,
                permission: PermissionUtil.join('kv-share', OWNER),
            }),
        ).resolves.toBeUndefined();
        expect(userHolds).not.toHaveBeenCalled();
    });
});

/** The refusal a call threw, for asserting on its code. */
const refusal = (fn: () => unknown): HttpError => {
    try {
        fn();
    } catch (err) {
        if (err instanceof HttpError) return err;
        throw err;
    }
    throw new Error('expected a refusal');
};

describe('share levels', () => {
    const REGION = 'workspace:abc:';

    it('put the level in the root, leaving watch grants as they were', () => {
        expect(kvSharePermission(OWNER, APP, REGION)).toBe(
            `kv-share:${OWNER}:${APP}:workspace:abc`,
        );
        expect(kvSharePermission(OWNER, APP, REGION, 'read')).toBe(
            `kv-share-read:${OWNER}:${APP}:workspace:abc`,
        );
        expect(kvSharePermission(OWNER, APP, REGION, 'write')).toBe(
            `kv-share-write:${OWNER}:${APP}:workspace:abc`,
        );
    });

    it('read the level back off any root, and nothing else as the family', () => {
        for (const access of ['watch', 'read', 'write'] as const) {
            const permission = kvSharePermission(OWNER, APP, REGION, access);
            expect(isKvSharePermission(permission)).toBe(true);
            expect(kvShareAccessOf(permission)).toBe(access);
            expect(kvShareGrantPrefix(permission)).toBe(REGION);
            expect(
                relativeToKvShareRoot(permission, `${REGION}messages:1`),
            ).toBe('messages:1');
        }
        expect(isKvSharePermission(`kv-shared:${OWNER}`)).toBe(false);
        expect(isKvSharePermission(`kv-share-admin:${OWNER}`)).toBe(false);
        expect(kvShareAccessOf(`fs:${OWNER}:read`)).toBeNull();
    });

    it('swap only the root when moving a grant between levels', () => {
        const read = kvSharePermission(OWNER, APP, REGION, 'read');
        expect(withKvShareAccess(read, 'write')).toBe(
            kvSharePermission(OWNER, APP, REGION, 'write'),
        );
        expect(kvShareGrantAtEveryLevel(read)).toEqual([
            kvSharePermission(OWNER, APP, REGION, 'watch'),
            read,
            kvSharePermission(OWNER, APP, REGION, 'write'),
        ]);
    });

    it('cover a region withdrawn at one level at every level', () => {
        const writeRegion = kvSharePermission(OWNER, APP, REGION, 'write');
        const watchInside = kvSharePermission(OWNER, APP, `${REGION}messages:`);
        expect(kvShareGrantCovers(writeRegion, watchInside)).toBe(true);
        expect(
            kvShareGrantCovers(
                kvSharePermission(OWNER, APP, REGION, 'read'),
                kvSharePermission(OWNER, APP, REGION, 'write'),
            ),
        ).toBe(true);
        // Still never upward, and never across namespaces.
        expect(kvShareGrantCovers(watchInside, writeRegion)).toBe(false);
        expect(
            kvShareGrantCovers(
                writeRegion,
                kvSharePermission(OWNER, OTHER_APP, REGION, 'write'),
            ),
        ).toBe(false);
        // Nothing outside the family is ever covered.
        expect(kvShareGrantCovers(writeRegion, `fs:${OWNER}:read`)).toBe(false);
    });
});

describe('the level ladder exploder', () => {
    const exploder = kvShareLevelsExploder();
    const at = (access: 'watch' | 'read' | 'write') =>
        kvSharePermission(OWNER, APP, 'workspace:abc:', access);

    it('lets a check at a level be answered by every level above it', async () => {
        expect(await exploder.explode({ permission: at('watch') })).toEqual([
            at('watch'),
            at('read'),
            at('write'),
        ]);
        expect(await exploder.explode({ permission: at('read') })).toEqual([
            at('read'),
            at('write'),
        ]);
        expect(exploder.matches(at('write'))).toBe(false);
    });

    it('ladders a manage arm the same way', async () => {
        expect(
            await exploder.explode({ permission: `manage:${at('read')}` }),
        ).toEqual([`manage:${at('read')}`, `manage:${at('write')}`]);
    });

    it('never ladders a string with no key segment', async () => {
        for (const permission of [
            PermissionUtil.join('kv-share', OWNER, APP),
            PermissionUtil.join('manage', 'kv-share-read', OWNER, APP),
            PermissionUtil.join('kv-share', OWNER),
            'kv-share',
        ])
            expect(await exploder.explode({ permission })).toEqual([
                permission,
            ]);
    });

    it('leaves other families alone', () => {
        expect(exploder.matches(`fs:${OWNER}:read`)).toBe(false);
        expect(exploder.matches(`app-data:${APP}:kv:read`)).toBe(false);
    });
});

describe('the level a driver method needs', () => {
    it('is read for get and list, and write for every other mapped op', () => {
        expect(kvShareLevelForMethod('get')).toBe('read');
        expect(kvShareLevelForMethod('list')).toBe('read');
        for (const method of [
            'set',
            'batchPut',
            'add',
            'incr',
            'decr',
            'update',
            'del',
            'remove',
            'expire',
            'expireAt',
        ])
            expect(kvShareLevelForMethod(method)).toBe('write');
    });

    it('refuses flush and anything the op table does not name', () => {
        expect(kvShareLevelForMethod('flush')).toBeNull();
        expect(kvShareLevelForMethod('toString')).toBeNull();
        expect(kvShareLevelForMethod('somethingNew')).toBeNull();
    });

    it('covers every method the op table knows', () => {
        for (const [method, op] of Object.entries(APP_DATA_KV_METHOD_OPS))
            expect(kvShareLevelForMethod(method) === null).toBe(op === null);
    });
});

describe('share request parsing', () => {
    it('takes the three levels and a fallback, and refuses anything else', () => {
        expect(parseKvShareAccess(undefined, 'read')).toBe('read');
        expect(parseKvShareAccess(null, 'watch')).toBe('watch');
        expect(parseKvShareAccess('write', 'read')).toBe('write');
        for (const value of ['delete', 'WRITE', '', 2, {}])
            expect(
                refusal(() => parseKvShareAccess(value, 'read')).legacyCode,
            ).toBe('kv_share_access_invalid');
    });

    it('caps a prefix at what the grant column leaves for its owner, app and level', () => {
        const owner = uuidv4();
        const app = `app-${uuidv4()}`;
        // 255 less the root, the owner uuid, the app uid and two separators.
        const longest = { watch: 169, read: 164, write: 163 } as const;
        for (const access of ['watch', 'read', 'write'] as const) {
            const fits = `${'a'.repeat(longest[access] - 1)}:`;
            const over = `${'a'.repeat(longest[access])}:`;
            expect(
                assertPrefixFitsAccess(owner, app, fits, access),
            ).toHaveLength(255);
            const refused = refusal(() =>
                assertPrefixFitsAccess(owner, app, over, access),
            );
            expect(refused.legacyCode).toBe('invalid_kv_share_prefix');
            expect(refused.message).toContain(`${longest[access]} characters`);
        }
        // The app-less namespace has a shorter name, so more room.
        expect(() =>
            assertPrefixFitsAccess(
                owner,
                'os-global',
                `${'a'.repeat(193)}:`,
                'write',
            ),
        ).not.toThrow();
    });

    it('holds a multibyte read or write prefix to the byte cap', () => {
        const multibyte = `${'é'.repeat(KV_SHARE_PREFIX_MAX_BYTES / 2)}:`;
        expect(
            refusal(() => assertPrefixFitsAccess(OWNER, APP, multibyte, 'read'))
                .legacyCode,
        ).toBe('invalid_kv_share_prefix');
        expect(() =>
            assertPrefixFitsAccess(OWNER, APP, multibyte, 'watch'),
        ).not.toThrow();
    });

    it('takes a recipient as a username or an object, never an address', () => {
        expect(parseKvShareRecipient(' alice ')).toEqual({
            username: 'alice',
        });
        expect(parseKvShareRecipient({ username: 'alice' })).toEqual({
            username: 'alice',
        });
        expect(parseKvShareRecipient({ uid: OWNER })).toEqual({ uid: OWNER });
        for (const value of [
            'alice@example.com',
            { username: 'a@b' },
            '',
            {},
            [],
            42,
            null,
            undefined,
        ])
            expect(refusal(() => parseKvShareRecipient(value)).legacyCode).toBe(
                'invalid_recipient',
            );
    });

    it('trims a label, reads empty as none, and keeps absent apart from null', () => {
        expect(parseKvShareLabel(undefined)).toBeUndefined();
        expect(parseKvShareLabel(null)).toBeNull();
        expect(parseKvShareLabel('   ')).toBeNull();
        expect(parseKvShareLabel('  Japan 2027 · from dan ')).toBe(
            'Japan 2027 · from dan',
        );
    });

    it.each([
        ['a control character', 'trip\u0007'],
        ['a newline', 'trip\nplans'],
        ['a line separator', 'trip\u2028plans'],
        ['a paragraph separator', 'trip\u2029plans'],
        ['a bidi override', 'trip\u202Eplans'],
        ['a bidi isolate', 'trip\u2067plans'],
        ['a left-to-right mark', 'trip\u200Eplans'],
        ['a right-to-left mark', 'trip\u200Fplans'],
        ['an Arabic letter mark', 'trip\u061Cplans'],
        ['a zero-width space', 'trip\u200Bplans'],
        ['a zero-width joiner', 'trip\u200Dplans'],
        ['a zero-width non-joiner', 'trip\u200Cplans'],
        ['a word joiner', 'trip\u2060plans'],
        ['a soft hyphen', 'trip\u00ADplans'],
        ['a byte order mark', 'trip\uFEFFplans'],
        ['a tag character', 'trip\u{E0041}plans'],
        ['an interlinear annotation anchor', 'trip\uFFF9plans'],
        ['four combining marks on one character', 'e\u0301\u0302\u0303\u0304'],
        ['a non-string', 42],
        ['too many characters', 'x'.repeat(129)],
        ['too many bytes', '😀'.repeat(129)],
    ])('refuses a label with %s', (_case, value) => {
        expect(refusal(() => parseKvShareLabel(value)).legacyCode).toBe(
            'kv_share_label_invalid',
        );
    });

    it('holds a new share`s key segments to lowercase letters, digits, `_`, `.` and `-`', () => {
        expect(() =>
            assertNewShareSegments(['room_1.a-b', 'x9']),
        ).not.toThrow();
        for (const segment of ['Room', 'café', 'a b', 'a*', 'ß', 'İ'])
            expect(
                refusal(() => assertNewShareSegments(['ok', segment]))
                    .legacyCode,
            ).toBe('invalid_kv_share_prefix');
    });

    it('takes a label at the character cap', () => {
        expect(parseKvShareLabel('x'.repeat(128))).toBe('x'.repeat(128));
    });

    it('takes up to three combining marks on a character, and emoji with a variation selector', () => {
        expect(parseKvShareLabel('e\u0301\u0302\u0303 caf\u00E9')).toBe(
            'e\u0301\u0302\u0303 caf\u00E9',
        );
        expect(parseKvShareLabel('Trip \u2764\uFE0F')).toBe(
            'Trip \u2764\uFE0F',
        );
    });
});

describe('delegations at every level', () => {
    it('are bounded the same way at every level', () => {
        for (const access of ['watch', 'read', 'write'] as const) {
            const region = kvShareManagePermission(
                kvSharePermission(OWNER, APP, 'workspace:abc:', access),
            );
            expect(isKvShareManagePermission(region)).toBe(true);
            expect(assertBoundedManageGrant(region)).toBe(region);
            const root = PermissionUtil.join(
                'manage',
                access === 'watch' ? 'kv-share' : `kv-share-${access}`,
                OWNER,
                APP,
            );
            expect(
                refusal(() => assertBoundedManageGrant(root)).legacyCode,
            ).toBe('invalid_kv_share_prefix');
        }
    });

    it('name the namespace root at every level for the unbounded check', () => {
        expect(
            kvShareManageNamespaceRoots(
                kvSharePermission(OWNER, APP, 'workspace:abc:', 'read'),
            ),
        ).toEqual([
            `manage:kv-share:${OWNER}:${APP}`,
            `manage:kv-share-read:${OWNER}:${APP}`,
            `manage:kv-share-write:${OWNER}:${APP}`,
        ]);
    });

    it('are answered for the owner at every level, and never by the app delegate', () => {
        const owner = kvShareOwnerImplicator();
        const delegate = kvShareAppDelegateImplicator({ userHolds: vi.fn() });
        for (const access of ['read', 'write'] as const) {
            const permission = kvSharePermission(
                OWNER,
                APP,
                'workspace:abc:',
                access,
            );
            expect(owner.matches(permission)).toBe(true);
            expect(owner.matches(`manage:${permission}`)).toBe(true);
            expect(
                owner.check({ actor: userActor(OWNER), permission }),
            ).toEqual({});
            expect(
                owner.check({ actor: userActor(OTHER), permission }),
            ).toBeUndefined();
            expect(delegate.matches(permission)).toBe(true);
            expect(delegate.matches(`manage:${permission}`)).toBe(false);
        }
    });

    it('let a holder`s app use a read or write grant only in its own namespace', async () => {
        const userHolds = vi.fn().mockResolvedValue(true);
        const delegate = kvShareAppDelegateImplicator({ userHolds });
        const permission = kvSharePermission(
            OWNER,
            APP,
            'workspace:abc:',
            'write',
        );
        await expect(
            delegate.check({ actor: appActor(OTHER, APP), permission }),
        ).resolves.toEqual({});
        await expect(
            delegate.check({ actor: appActor(OTHER, OTHER_APP), permission }),
        ).resolves.toBeUndefined();
        await expect(
            delegate.check({
                actor: appActor(OTHER, OTHER_APP),
                permission: kvSharePermission(
                    OWNER,
                    'os-global',
                    'workspace:abc:',
                    'read',
                ),
            }),
        ).resolves.toBeUndefined();
    });
});
