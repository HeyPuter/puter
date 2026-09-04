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

import { randomUUID } from 'node:crypto';
import { HttpError } from '../../core/http/HttpError.js';
import { KV_GLOBAL_APP_KEY } from '../../stores/systemKv/SystemKVStore.js';
import {
    MANAGE_PERM_PREFIX,
    PERMISSION_MAX_LEN,
} from '../permission/consts.js';
import type { PermissionImplicator } from '../permission/permissionUtil.js';
import { PermissionUtil } from '../permission/permissionUtil.js';
import {
    isKvHandleId,
    KV_HANDLE_PREFIX,
    KV_KEY_SEPARATOR,
} from './subjects.js';

/**
 * Letting one user watch a region of another's key-value namespace.
 *
 * The grant is an ordinary user-to-user permission, which is the whole point:
 * `manage:` answers "may I delegate this", the exploder's prefix implication
 * makes a grant on `workspace:abc:` answer every key beneath it, and revocation
 * settling and the delivery re-check key off the stored string exactly as they
 * do for a shared folder. Putting the ACL on the key-value item instead would
 * take part in none of that, and would tax every write to the item besides.
 *
 * The permission names the owner, so its components are the three things a
 * shared region is:
 *
 *     kv-share:<ownerUserUuid>:<appUid>:<keySegment>...
 *
 * Key segments are components rather than one escaped blob because that is what
 * makes prefix implication work without a rule of its own: the check a deep key
 * runs is a descendant of the grant string, and the existing parent walk finds
 * it. The grantee never sees this string — the handle is the name on the wire.
 */

/** Root of the cross-user key-value share namespace. */
export const KV_SHARE_PERMISSION_PREFIX = 'kv-share';

/** Width of the `app_uid` column the handle row stores its namespace in. */
export const KV_SHARE_APP_UID_MAX_LENGTH = 40;

export const mintKvHandleId = (): string =>
    `${KV_HANDLE_PREFIX}${randomUUID()}`;

/** The key segments a prefix contributes to a permission string. */
export const keyPrefixSegments = (keyPrefix: string): string[] =>
    keyPrefix.split(KV_KEY_SEPARATOR).filter((segment) => segment.length > 0);

/**
 * A granted prefix as it is stored: always ending on the key delimiter, so
 * `keyPrefix + relative` is a whole key and the region never accidentally
 * includes the key that names it.
 */
export const normalizeKeyPrefix = (keyPrefix: string): string => {
    const segments = keyPrefixSegments(keyPrefix);
    return segments.length === 0
        ? ''
        : `${segments.join(KV_KEY_SEPARATOR)}${KV_KEY_SEPARATOR}`;
};

export const kvSharePermission = (
    ownerUserUuid: string,
    appUid: string,
    keyPrefix: string,
): string =>
    PermissionUtil.join(
        KV_SHARE_PERMISSION_PREFIX,
        ownerUserUuid,
        appUid,
        ...keyPrefixSegments(keyPrefix),
    );

export const isKvSharePermission = (permission: string): boolean =>
    permission === KV_SHARE_PERMISSION_PREFIX ||
    permission.startsWith(`${KV_SHARE_PERMISSION_PREFIX}:`);

/**
 * Whether withdrawing `revoked` takes `held` with it. Prefix implication read
 * backwards: a grant answers every check at or beneath it, so withdrawing it
 * puts every one of those in question.
 */
export const kvShareGrantCovers = (revoked: string, held: string): boolean =>
    held === revoked || held.startsWith(`${revoked}:`);

/** The granted root a share grant names, read back as a key prefix. */
export const kvShareGrantPrefix = (permission: string): string =>
    normalizeKeyPrefix(
        PermissionUtil.split(permission).slice(3).join(KV_KEY_SEPARATOR),
    );

/**
 * A key inside a granted region, named the way its holder addresses it, or
 * `null` for one outside. The handle is the granted root, so everything the
 * holder is shown is relative to it — an absolute key would name a namespace
 * they cannot address and were never told about.
 */
export const relativeToKvShareRoot = (
    permission: string,
    key: string,
): string | null => {
    const prefix = kvShareGrantPrefix(permission);
    if (!prefix || !key.startsWith(prefix)) return null;
    return key.slice(prefix.length);
};

// -- Minting input ----------------------------------------------------

export const invalidPrefix = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'invalid_kv_share_prefix' });

export const invalidAppUid = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

/**
 * The region a handle may be minted on. A pattern is refused because a handle
 * names a region rather than selecting within one, and the namespace root is
 * refused because a handle over everything the app holds is not a bounded
 * capability — it is the app's data, and sharing that is a different decision
 * with a different consent.
 */
export const assertShareablePrefix = (keyPrefix: unknown): string => {
    if (typeof keyPrefix !== 'string')
        throw invalidPrefix('`prefix` must be a string');
    if (keyPrefix.includes('*') || keyPrefix.includes('?'))
        throw invalidPrefix('A share prefix is a key prefix, not a pattern');
    // Normalizing drops empty segments, so `a::b:` would silently become a
    // grant on `a:b:` — a region other than the one asked for. Refused rather
    // than rewritten; only the trailing delimiter is optional.
    const written = keyPrefix.split(KV_KEY_SEPARATOR);
    if (written[written.length - 1] === '') written.pop();
    if (written.some((segment) => segment === ''))
        throw invalidPrefix('A share prefix may not have an empty key segment');

    const normalized = normalizeKeyPrefix(keyPrefix);
    if (normalized === '')
        throw invalidPrefix('A share prefix may not be the whole namespace');
    return normalized;
};

/**
 * The shape every app uid takes, minted or derived from an origin. Narrow on
 * purpose: `:` and `#` delimit the anchor token and permission grammars, so
 * excluding them matters as much as excluding the handle prefix does.
 */
const APP_UID_SHAPE = /^app-[A-Za-z0-9_-]{1,64}$/;

/** Fixed namespaces with no app of their own. */
const FIXED_KV_NAMESPACES: readonly string[] = [KV_GLOBAL_APP_KEY];

/**
 * The namespace a handle may be minted over: the caller's own app slot, or the
 * app-less one. Bounded by the column that stores it, shaped like a real app
 * uid or one of the platform's fixed namespaces, and never handle-shaped, since
 * the two share the app slot of a `kv:` subject.
 */
export const assertShareableAppUid = (appUid: string): string => {
    if (appUid.length > KV_SHARE_APP_UID_MAX_LENGTH)
        throw invalidAppUid(
            `\`appUid\` may not exceed ${KV_SHARE_APP_UID_MAX_LENGTH} characters`,
        );
    if (isKvHandleId(appUid))
        throw invalidAppUid('A share handle does not name a namespace');
    if (!APP_UID_SHAPE.test(appUid) && !FIXED_KV_NAMESPACES.includes(appUid))
        throw invalidAppUid('`appUid` does not name a namespace');
    return appUid;
};

/**
 * The grant a mint would issue, refused when it would not fit the column every
 * permission table declares. Key prefixes run to a kilobyte and permissions do
 * not, so the real bound on how deep a region may be is this one.
 */
export const assertShareablePermission = (permission: string): string => {
    if (permission.length > PERMISSION_MAX_LEN)
        throw invalidPrefix(
            `A share prefix must leave the grant under ${PERMISSION_MAX_LEN} characters`,
        );
    return permission;
};

// -- Delegation -------------------------------------------------------

/** The delegation arm of a share grant: authority to hand the region out. */
export const kvShareManagePermission = (permission: string): string =>
    PermissionUtil.join(
        MANAGE_PERM_PREFIX,
        ...PermissionUtil.split(permission),
    );

export const KV_SHARE_MANAGE_PREFIX = `${MANAGE_PERM_PREFIX}:${KV_SHARE_PERMISSION_PREFIX}`;

export const isKvShareManagePermission = (permission: string): boolean =>
    permission === KV_SHARE_MANAGE_PREFIX ||
    permission.startsWith(`${KV_SHARE_MANAGE_PREFIX}:`);

/**
 * A delegation must name a subtree. Consent on the namespace root reads as "let
 * this app hand out anything it has stored for you", which is not a bounded
 * capability and so is not something a prompt can put to a user.
 */
export const assertBoundedManageGrant = (permission: string): string => {
    if (!isKvShareManagePermission(permission)) return permission;
    const [, , owner, appUid, ...segments] = PermissionUtil.split(permission);
    if (!owner || !appUid || segments.length === 0)
        throw invalidPrefix(
            'A share delegation must name a region, not the whole namespace',
        );
    return permission;
};

/**
 * The unbounded `manage:` grant a bounded delegation's own permission descends
 * from. The consent surface refuses to ever write this row, but
 * `canManagePermission` walks ancestors to decide "may I delegate this", so if
 * it exists by any other path it would silently authorize a mint anywhere in
 * the namespace — this is what lets the mint path notice it regardless.
 */
export const kvShareManageNamespaceRoot = (permission: string): string => {
    const [, owner, appUid] = PermissionUtil.split(permission);
    return PermissionUtil.join(
        MANAGE_PERM_PREFIX,
        KV_SHARE_PERMISSION_PREFIX,
        owner,
        appUid,
    );
};

// -- Permission rules -------------------------------------------------

/**
 * The permission a `manage:` arm delegates over. Only the leading component is
 * stripped: a key segment may itself be `manage`, and taking those out would
 * change which string the owner is read from.
 */
const withoutManageArm = (permission: string): string =>
    permission.startsWith(`${MANAGE_PERM_PREFIX}:`)
        ? permission.slice(MANAGE_PERM_PREFIX.length + 1)
        : permission;

/**
 * Owning the namespace is holding every share grant over it, and being able to
 * issue them. Without this the owner cannot mint a handle on their own data:
 * `grantUserUserPermission` asks `canManagePermission` first, and there is no
 * row anywhere saying a user may manage what is already theirs.
 *
 * Restricted to plain user actors, as the filesystem's `is-owner` is. An app
 * disposing of a region of its user's namespace is delegation, which is the
 * `manage:` grant's job rather than this one's.
 */
export const kvShareOwnerImplicator = (): PermissionImplicator => ({
    id: 'kv-share-is-owner',
    shortcut: true,
    matches: (permission: string): boolean =>
        isKvSharePermission(withoutManageArm(permission)),
    check: ({ actor, permission }): unknown => {
        if (actor.app || actor.accessToken) return undefined;
        const uuid = actor.user?.uuid;
        if (!uuid) return undefined;

        const owner = PermissionUtil.split(withoutManageArm(permission))[1];
        return owner === uuid ? {} : undefined;
    },
});
