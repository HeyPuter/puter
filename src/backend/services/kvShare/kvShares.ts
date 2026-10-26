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
import {
    type Actor,
    isAppActor,
    isPlainUserActor,
    userRelatedActor,
} from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import { KV_SHARE_HANDLE_WIDTHS } from '../../stores/events/columnWidths.js';
import {
    KV_GLOBAL_APP_KEY,
    KV_MAX_KEY_BYTES,
} from '../../stores/systemKv/SystemKVStore.js';
import {
    MANAGE_PERM_PREFIX,
    PERMISSION_MAX_LEN,
} from '../permission/consts.js';
import { APP_DATA_KV_METHOD_OPS } from '../permission/appDataScopes.js';
import type {
    PermissionExploder,
    PermissionImplicator,
} from '../permission/permissionUtil.js';
import { PermissionUtil } from '../permission/permissionUtil.js';
import {
    isKvHandleId,
    KV_HANDLE_PREFIX,
    KV_KEY_SEPARATOR,
} from '../events/subjects.js';

/**
 * Letting one user watch, read or write a region of another's key-value
 * namespace.
 *
 * The grant is an ordinary user-to-user permission, which is the whole point:
 * `manage:` answers "may I delegate this", the exploder's prefix implication
 * makes a grant on `workspace:abc:` answer every key beneath it, and revocation
 * settling and the delivery re-check key off the stored string exactly as they
 * do for a shared folder. Putting the ACL on the key-value item instead would
 * take part in none of that, and would tax every write to the item besides.
 *
 * The permission names the owner, so its components are the three things a
 * shared region is, under a root that names the access level:
 *
 *     kv-share:<ownerUserUuid>:<appUid>:<keySegment>...         watch
 *     kv-share-read:<ownerUserUuid>:<appUid>:<keySegment>...    read
 *     kv-share-write:<ownerUserUuid>:<appUid>:<keySegment>...   write
 *
 * The level is in the root rather than a component so the permission system
 * enforces it, and so the strings `kv-share:` grants already use keep their
 * meaning.
 *
 * Key segments are components rather than one escaped blob because that is what
 * makes prefix implication work without a rule of its own: the check a deep key
 * runs is a descendant of the grant string, and the existing parent walk finds
 * it. The grantee never sees this string — the handle is the name on the wire.
 */

/** Root of the cross-user key-value share namespace, at the watch level. */
export const KV_SHARE_PERMISSION_PREFIX = 'kv-share';

/** Access levels, lowest first. Each implies the ones before it. */
export const KV_SHARE_ACCESS_LEVELS = ['watch', 'read', 'write'] as const;
export type KvShareAccess = (typeof KV_SHARE_ACCESS_LEVELS)[number];

const KV_SHARE_ROOTS: Record<KvShareAccess, string> = {
    watch: KV_SHARE_PERMISSION_PREFIX,
    read: `${KV_SHARE_PERMISSION_PREFIX}-read`,
    write: `${KV_SHARE_PERMISSION_PREFIX}-write`,
};

/** The permission root a level is granted under. */
export const kvShareRoot = (access: KvShareAccess): string =>
    KV_SHARE_ROOTS[access];

const ACCESS_BY_ROOT = new Map<string, KvShareAccess>(
    KV_SHARE_ACCESS_LEVELS.map((access) => [KV_SHARE_ROOTS[access], access]),
);

/**
 * Byte ceiling on a `read` or `write` prefix, which the fixed relative-key
 * limit assumes. The grant column binds first for every prefix a new share may
 * name; this one only bites on a multibyte prefix shared before that rule.
 */
export const KV_SHARE_PREFIX_MAX_BYTES = 256;

/**
 * Longest key a call through a handle may name, relative to the handle, in
 * UTF-8 bytes: what the store's key limit leaves after the longest prefix, so
 * the limit a holder hits says nothing about how long the prefix is.
 */
export const KV_HANDLE_KEY_MAX_BYTES =
    KV_MAX_KEY_BYTES - KV_SHARE_PREFIX_MAX_BYTES;

/** Width of the `app_uid` column the handle row stores its namespace in. */
export const KV_SHARE_APP_UID_MAX_LENGTH = KV_SHARE_HANDLE_WIDTHS.appUid.max;

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
    access: KvShareAccess = 'watch',
): string =>
    PermissionUtil.join(
        KV_SHARE_ROOTS[access],
        ownerUserUuid,
        appUid,
        ...keyPrefixSegments(keyPrefix),
    );

/** The family root a permission starts with, or `null` outside the family. */
const kvShareRootOf = (permission: string): string | null => {
    const end = permission.indexOf(':');
    const head = end === -1 ? permission : permission.slice(0, end);
    return ACCESS_BY_ROOT.has(head) ? head : null;
};

export const isKvSharePermission = (permission: string): boolean =>
    kvShareRootOf(permission) !== null;

/** The access level a share grant carries, or `null` outside the family. */
export const kvShareAccessOf = (permission: string): KvShareAccess | null => {
    const root = kvShareRootOf(permission);
    return root === null ? null : (ACCESS_BY_ROOT.get(root) ?? null);
};

/** The same grant at another level: only the root changes. */
export const withKvShareAccess = (
    permission: string,
    access: KvShareAccess,
): string => {
    const root = kvShareRootOf(permission);
    if (root === null) return permission;
    return `${KV_SHARE_ROOTS[access]}${permission.slice(root.length)}`;
};

/** The grant at every level, for withdrawing a region whatever it was. */
export const kvShareGrantAtEveryLevel = (permission: string): string[] =>
    KV_SHARE_ACCESS_LEVELS.map((access) =>
        withKvShareAccess(permission, access),
    );

/**
 * Whether withdrawing `revoked` takes `held` with it. Prefix implication read
 * backwards: a grant answers every check at or beneath it, so withdrawing it
 * puts every one of those in question. Compared below the root, because a
 * region withdrawn at one level is in question at every level.
 */
export const kvShareGrantCovers = (revoked: string, held: string): boolean => {
    const revokedRoot = kvShareRootOf(revoked);
    const heldRoot = kvShareRootOf(held);
    if (revokedRoot === null || heldRoot === null) return false;
    const region = revoked.slice(revokedRoot.length);
    const inside = held.slice(heldRoot.length);
    return inside === region || inside.startsWith(`${region}:`);
};

/**
 * The level a key-value driver method needs through a share, or `null` for a
 * method no share reaches. Derived from the cross-app op table, so a method
 * missing from it fails closed.
 */
export const kvShareLevelForMethod = (method: string): KvShareAccess | null => {
    if (!Object.prototype.hasOwnProperty.call(APP_DATA_KV_METHOD_OPS, method))
        return null;
    const op = APP_DATA_KV_METHOD_OPS[method];
    if (op === null) return null;
    return op === 'get' || op === 'list' ? 'read' : 'write';
};

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

/**
 * `kv.shareHandles` is off: no `read` or `write` shares, and no calls through
 * one.
 */
export const kvHandlesDisabled = (): HttpError =>
    new HttpError(
        403,
        'Sharing key-value data for reading or writing is not available',
        { legacyCode: 'kv_handles_disabled' },
    );

// -- Minting input ----------------------------------------------------

export const invalidPrefix = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'invalid_kv_share_prefix' });

const invalidAccess = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'kv_share_access_invalid' });

/** The level a mint asks for, `fallback` when it names none. */
export const parseKvShareAccess = (
    value: unknown,
    fallback: KvShareAccess,
): KvShareAccess => {
    if (value === undefined || value === null) return fallback;
    if (
        typeof value !== 'string' ||
        !(KV_SHARE_ACCESS_LEVELS as readonly string[]).includes(value)
    )
        throw invalidAccess('`access` must be `watch`, `read` or `write`');
    return value as KvShareAccess;
};

/**
 * The grant a share of `keyPrefix` at `access` would issue, refused with
 * `invalid_kv_share_prefix` when it would not fit the permission column. The
 * room left depends on the owner uuid, the app uid and the level's root, so the
 * longest prefix differs per namespace and level.
 */
export const assertPrefixFitsAccess = (
    ownerUuid: string,
    appUid: string,
    keyPrefix: string,
    access: KvShareAccess,
): string => {
    const permission = kvSharePermission(ownerUuid, appUid, keyPrefix, access);
    const prefix = normalizeKeyPrefix(keyPrefix);
    const room = PERMISSION_MAX_LEN - (permission.length - prefix.length);
    const overBytes =
        access !== 'watch' &&
        Buffer.byteLength(prefix, 'utf8') > KV_SHARE_PREFIX_MAX_BYTES;
    if (permission.length > PERMISSION_MAX_LEN || overBytes)
        throw invalidPrefix(
            `With \`${access}\` access, a share prefix in this namespace may be at most ${room} characters` +
                (access === 'watch'
                    ? ''
                    : ` and ${KV_SHARE_PREFIX_MAX_BYTES} bytes`),
        );
    return permission;
};

const invalidRecipient = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'invalid_recipient' });

/** Who a share is for, as a username or a user uuid. */
export interface KvShareRecipient {
    username?: string;
    uid?: string;
}

/**
 * A recipient as `POST /kv/shares` takes it: a username, `{ username }` or `{
 * uid }`. An address is refused rather than looked up, so email recipients can
 * later mean what they mean for file shares.
 */
export const parseKvShareRecipient = (value: unknown): KvShareRecipient => {
    const named = (username: unknown): KvShareRecipient => {
        if (typeof username !== 'string' || username.trim() === '')
            throw invalidRecipient('`recipient` must name a user');
        if (username.includes('@'))
            throw invalidRecipient(
                '`recipient` must be a username, not an email address',
            );
        return { username: username.trim() };
    };
    if (typeof value === 'string') return named(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const { username, uid } = value as Record<string, unknown>;
        if (username !== undefined) return named(username);
        if (typeof uid === 'string' && uid.trim() !== '')
            return { uid: uid.trim() };
    }
    throw invalidRecipient(
        '`recipient` must be a username, `{ username }` or `{ uid }`',
    );
};

const invalidLabel = (message: string): HttpError =>
    new HttpError(400, message, { legacyCode: 'kv_share_label_invalid' });

export const KV_SHARE_LABEL_MAX_CHARS = 128;
export const KV_SHARE_LABEL_MAX_BYTES = 512;

/**
 * Control and format characters (bidi marks, overrides and isolates, zero-width
 * characters, BOM, tags) and line or paragraph separators.
 */
const LABEL_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Combining marks a label may stack on one character. */
export const KV_SHARE_LABEL_MAX_COMBINING_MARKS = 3;
const LABEL_MARK_RUN = new RegExp(
    `\\p{M}{${KV_SHARE_LABEL_MAX_COMBINING_MARKS + 1},}`,
    'u',
);

/**
 * An owner-set label. `undefined` leaves the stored one alone, `null` clears
 * it, and a string that trims to nothing reads as `null`.
 */
export const parseKvShareLabel = (
    value: unknown,
): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string')
        throw invalidLabel('`label` must be a string');
    const label = value.trim();
    if (label === '') return null;
    if (LABEL_FORBIDDEN.test(label))
        throw invalidLabel(
            '`label` may not contain control, formatting, line-break or text-direction characters',
        );
    if (LABEL_MARK_RUN.test(label))
        throw invalidLabel(
            `\`label\` may not stack more than ${KV_SHARE_LABEL_MAX_COMBINING_MARKS} combining marks on one character`,
        );
    if (
        [...label].length > KV_SHARE_LABEL_MAX_CHARS ||
        Buffer.byteLength(label, 'utf8') > KV_SHARE_LABEL_MAX_BYTES
    )
        throw invalidLabel(
            `\`label\` may not exceed ${KV_SHARE_LABEL_MAX_CHARS} characters or ${KV_SHARE_LABEL_MAX_BYTES} bytes`,
        );
    return label;
};

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
    // `escape_permission_component` escapes `:` as `\C` but leaves `\` alone,
    // so a prefix carrying one desynchronizes the stored `key_prefix` from the
    // permission string and the share silently never fires.
    if (keyPrefix.includes('\\'))
        throw invalidPrefix('A share prefix may not contain a backslash');
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

const NEW_SHARE_SEGMENT = /^[a-z0-9_.-]+$/;

/**
 * The key segments a new share or share consent may name. One spelling per
 * region, so no two grants differ only in case or accents, which some databases
 * compare as equal. Existing shares are not held to it.
 */
export const assertNewShareSegments = (segments: readonly string[]): void => {
    if (segments.some((segment) => !NEW_SHARE_SEGMENT.test(segment)))
        throw invalidPrefix(
            'A share prefix may only contain lowercase letters (a-z), digits, `_`, `.` and `-` between its `:` separators',
        );
};

/** A new share over a prefix that an existing share spells differently. */
export const kvSharePrefixCaseConflict = (): HttpError =>
    invalidPrefix(
        'This user already has a share of a prefix that differs from this one only in letter case',
    );

/**
 * The shape every app uid takes, minted or derived from an origin. Narrow on
 * purpose: `:` and `#` delimit the anchor token and permission grammars, so
 * excluding them matters as much as excluding the handle prefix does.
 */
export const APP_UID_SHAPE = /^app-[A-Za-z0-9_-]{1,64}$/;

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

// -- Delegation -------------------------------------------------------

/** The delegation arm of a share grant: authority to hand the region out. */
export const kvShareManagePermission = (permission: string): string =>
    PermissionUtil.join(
        MANAGE_PERM_PREFIX,
        ...PermissionUtil.split(permission),
    );

export const isKvShareManagePermission = (permission: string): boolean =>
    PermissionUtil.isManage(permission) &&
    isKvSharePermission(permission.slice(MANAGE_PERM_PREFIX.length + 1));

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
 * The unbounded `manage:` grants, one per level, that a bounded delegation's
 * own permission sits in. The consent surface refuses to ever write these rows,
 * but `canManagePermission` walks ancestors to decide "may I delegate this", so
 * one that exists by any other path would silently authorize a mint anywhere in
 * the namespace. This is what lets the mint path notice it regardless.
 */
export const kvShareManageNamespaceRoots = (permission: string): string[] => {
    const [, owner, appUid] = PermissionUtil.split(permission);
    return KV_SHARE_ACCESS_LEVELS.map((access) =>
        PermissionUtil.join(
            MANAGE_PERM_PREFIX,
            KV_SHARE_ROOTS[access],
            owner,
            appUid,
        ),
    );
};

// -- Permission rules -------------------------------------------------

/**
 * The level ladder: a check at one level is also answered by a grant at any
 * level above it, `manage:` arms included. Only a string with at least one key
 * segment is laddered, so no level of a namespace-root grant answers another.
 */
export const kvShareLevelsExploder = (): PermissionExploder => ({
    id: 'kv-share-levels',
    matches: (permission: string): boolean => {
        const access = kvShareAccessOf(
            PermissionUtil.stripManageArms(permission),
        );
        return access !== null && access !== 'write';
    },
    explode: ({ permission }): string[] => {
        const grant = PermissionUtil.stripManageArms(permission);
        const arms = permission.slice(0, permission.length - grant.length);
        const access = kvShareAccessOf(grant);
        // Owner, app, and at least one key segment after the root.
        if (access === null || grant.split(':').length < 4) return [permission];
        const above = KV_SHARE_ACCESS_LEVELS.slice(
            KV_SHARE_ACCESS_LEVELS.indexOf(access) + 1,
        );
        return [
            permission,
            ...above.map(
                (level) => `${arms}${withKvShareAccess(grant, level)}`,
            ),
        ];
    },
});

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
        if (!isPlainUserActor(actor)) return undefined;
        const uuid = actor.user?.uuid;
        if (!uuid) return undefined;

        const owner = PermissionUtil.split(withoutManageArm(permission))[1];
        return owner === uuid ? {} : undefined;
    },
});

/** Scan memo key for the grants a user check already refused. */
const DELEGATE_REFUSED = 'kv-share-app-delegate:refused';

/**
 * Whether a check of `asked` also asks `option`: `option` is `asked` or an
 * ancestor of it, at the same level or above.
 */
const kvShareCheckReaches = (asked: string, option: string): boolean => {
    const askedAccess = kvShareAccessOf(asked);
    const optionAccess = kvShareAccessOf(option);
    if (askedAccess === null || optionAccess === null) return false;
    return (
        KV_SHARE_ACCESS_LEVELS.indexOf(optionAccess) >=
            KV_SHARE_ACCESS_LEVELS.indexOf(askedAccess) &&
        kvShareGrantCovers(option, asked)
    );
};

/**
 * Letting an app-under-user actor exercise a share grant its user holds, at any
 * level, bounded to the app the grant's namespace names.
 *
 * Only the grant itself is matched — never `manage:kv-share…` — because
 * answering the manage arm here would read as the unbounded namespace-root
 * delegation and break minting for everyone (see
 * `kvShareManageNamespaceRoots`). The namespace-app check keeps one app from
 * reading a region shared with another app of the same user.
 */
export const kvShareAppDelegateImplicator = (deps: {
    userHolds: (actor: Actor, permission: string) => Promise<boolean>;
}): PermissionImplicator => ({
    id: 'kv-share-app-delegate',
    shortcut: true,
    matches: (permission: string): boolean => isKvSharePermission(permission),
    check: async ({ actor, permission, memo }): Promise<unknown> => {
        if (!isAppActor(actor)) return undefined;
        const app = actor.effectiveApp;
        if (!app?.uid) return undefined;

        const [, owner, namespaceApp, ...segments] =
            PermissionUtil.split(permission);
        if (!owner || !namespaceApp || segments.length === 0) return undefined;
        if (namespaceApp !== app.uid) return undefined;

        // A scan offers the deepest option first, and the user check of one
        // also asks its ancestors at its level or above, so its refusal
        // answers those without asking again.
        const refused = memo?.get(DELEGATE_REFUSED) as string[] | undefined;
        if (refused?.some((asked) => kvShareCheckReaches(asked, permission)))
            return undefined;
        if (await deps.userHolds(userRelatedActor(actor), permission))
            return {};
        memo?.set(DELEGATE_REFUSED, [...(refused ?? []), permission]);
        return undefined;
    },
});
