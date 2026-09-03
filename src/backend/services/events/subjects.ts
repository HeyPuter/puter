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

import type { KvOp } from '../../clients/event/types.js';
import { HttpError } from '../../core/http/HttpError.js';
import { isTildePath } from '../fs/resolveNode.js';
import type { NotificationAudience } from '../notification/notificationTypes.js';
import { PermissionUtil } from '../permission/permissionUtil.js';

/**
 * Subscription subjects, `:`-delimited with the same component escaping as
 * permission strings (`:` escapes as `\C`):
 *
 *     fs:<nodeUid|path>[:<op>]     op in add | write | move | remove | meta
 *     kv:<appUid>:<key>            exact key
 *     kv:<appUid>:<prefix>*        trailing `*` only
 *     kv:<key>                     sugar for the caller's own app namespace
 *     notif:<appUid>:<audience>    a mailbox slice
 *     notif:<audience>             sugar for the caller's own app, or account
 *
 * Parsing is pure syntax. It yields the anchor a subscription keys on plus the
 * glob the anchor's members are filtered by; turning that anchor into a node
 * uid is the resolver's job.
 */

// -- Types ------------------------------------------------------------

export type SubjectFamily = 'fs' | 'kv' | 'notif';

export type FsOp = 'add' | 'write' | 'move' | 'remove' | 'meta';

/** A notification is only ever posted; the mailbox verbs are their own surface. */
export type NotifOp = 'post';

export type SubjectOp = FsOp | KvOp | NotifOp;

export type AnchorRef =
    | { kind: 'fsUid'; uid: string }
    | { kind: 'fsPath'; path: string }
    | {
          kind: 'kvPrefix';
          /**
           * `null` for the app-relative two-segment form, filled in
           * server-side.
           */
          appUid: string | null;
          prefix: string;
          /** The key pattern as written, which the canonical subject reuses. */
          key: string;
      }
    | {
          kind: 'notifScope';
          /**
           * App the rows are about, or the recipient when they name no app.
           * `null` for the two-segment form, filled in server-side.
           */
          ref: string | null;
          audience: NotificationAudience;
      };

export interface ParsedSubject {
    family: SubjectFamily;
    anchorRef: AnchorRef;
    /** Operation filter; `null` means every op on the anchor. */
    op: FsOp | null;
    /** Glob over the anchor's members; `null` means no filter. */
    rawMatch: string | null;
}

// -- Constants --------------------------------------------------------

export const FS_OPS: readonly FsOp[] = Object.freeze([
    'add',
    'write',
    'move',
    'remove',
    'meta',
]);

/**
 * A KV anchor token stops at 6 `:`-segments — past that the key is deep enough
 * that the remainder is cheaper to filter in-process than to index.
 */
export const KV_TOKEN_SEGMENT_CAP = 6;

/** Longest subject accepted: the widest path the filesystem itself stores. */
export const SUBJECT_MAX_LENGTH = 4096;

/**
 * Bytes of key a KV anchor token may carry. KV keys run to 1 KB, and the token
 * is an indexed column, so a deep prefix backs off to a shallower delimiter and
 * the whole pattern becomes the filter — the same trade the segment cap makes.
 */
export const KV_TOKEN_PREFIX_MAX_BYTES = 160;

const GLOB_CHARS = /[*?]/;

/** What splits a KV key into the segments a token can anchor between. */
export const KV_KEY_SEPARATOR = ':';

/**
 * A KV filter's glob has no boundary: a trailing `*` means "everything from
 * here on", including deeper `:`-segments.
 */
export const KV_MATCH_SEPARATOR: string | null = null;

const FS_TOKEN_PREFIX = 'f#';
const KV_TOKEN_PREFIX = 'k#';
const NOTIF_TOKEN_PREFIX = 'n#';

/** Audiences a `notif:` subject may name, in wire form. */
export const NOTIF_AUDIENCES: readonly NotificationAudience[] = Object.freeze([
    'account',
    'developer',
    'app-user',
]);

/**
 * What separates the two halves of a notif filter. A subject names a slice of
 * one mailbox, and the anchor is the mailbox — so the slice is what the filter
 * carries.
 */
export const NOTIF_MATCH_SEPARATOR = ':';

// -- Anchor tokens ----------------------------------------------------

/** Stored anchor token for an FS node. */
export const fsAnchorToken = (uid: string): string =>
    `${FS_TOKEN_PREFIX}${uid}`;

/**
 * Stored anchor token for a KV prefix. The user is part of it because KV
 * namespaces are `v1:<userUuid>:<appUid>` — an app-uid-only token would collide
 * across every user of the app.
 */
export const kvAnchorToken = (
    userUuid: string,
    appUid: string,
    prefix: string,
): string => `${KV_TOKEN_PREFIX}${userUuid}#${appUid}#${prefix}`;

/**
 * Stored anchor token for a mailbox. One per recipient: a notification is
 * addressed to a person, and which slice of their mailbox a subscription wants
 * is a filter over that.
 */
export const notifAnchorToken = (userUuid: string): string =>
    `${NOTIF_TOKEN_PREFIX}${userUuid}`;

/**
 * What a notif filter is tested against: the row's app (or recipient) and
 * audience.
 */
export const notifMatchOn = (
    ref: string,
    audience: NotificationAudience | string,
): string => `${ref}${NOTIF_MATCH_SEPARATOR}${audience}`;

/** Which family a stored row belongs to, without re-parsing its subject. */
export const isKvToken = (token: string): boolean =>
    token.startsWith(KV_TOKEN_PREFIX);

/**
 * The delimiter-aligned prefixes a key can be watched under, shallowest first
 * and capped at {@link KV_TOKEN_SEGMENT_CAP}. The empty prefix is the whole
 * namespace.
 */
export const kvKeyPrefixes = (key: string): string[] => {
    const prefixes = [''];
    let from = 0;
    while (prefixes.length <= KV_TOKEN_SEGMENT_CAP) {
        const at = key.indexOf(KV_KEY_SEPARATOR, from);
        if (at === -1) break;
        prefixes.push(key.slice(0, at + 1));
        from = at + 1;
    }
    return prefixes;
};

/**
 * Every token a write to `key` may be watched by: the exact key first, then its
 * prefixes — the KV counterpart of the FS ancestor walk, and bounded the same
 * way so one write never enumerates more than a handful.
 */
export const kvAnchorTokens = (
    userUuid: string,
    appUid: string,
    key: string,
): string[] =>
    [...new Set([key, ...kvKeyPrefixes(key)])].map((prefix) =>
        kvAnchorToken(userUuid, appUid, prefix),
    );

// -- Parsing ----------------------------------------------------------

const invalidSubject = (subject: string): HttpError =>
    new HttpError(400, `Invalid subject: ${subject}`, {
        legacyCode: 'invalid_subject',
    });

/**
 * Split a path into the literal prefix that can be an anchor and the glob
 * remainder that has to be a filter.
 */
const splitGlobPrefix = (
    path: string,
): { literal: string; match: string | null } => {
    const segments = path.split('/');
    const globIndex = segments.findIndex((segment) => GLOB_CHARS.test(segment));
    if (globIndex === -1) return { literal: path, match: null };
    return {
        literal: segments.slice(0, globIndex).join('/') || '/',
        match: segments.slice(globIndex).join('/'),
    };
};

/** Trim a KV prefix back to the segment and byte caps, landing on a delimiter. */
const capPrefix = (prefix: string): string => {
    const segments = prefix.split(KV_KEY_SEPARATOR);
    const body =
        segments[segments.length - 1] === '' ? segments.slice(0, -1) : segments;

    const capped = body.slice(0, KV_TOKEN_SEGMENT_CAP);
    while (
        capped.length > 0 &&
        Buffer.byteLength(capped.join(KV_KEY_SEPARATOR), 'utf8') >
            KV_TOKEN_PREFIX_MAX_BYTES
    )
        capped.pop();

    if (capped.length === body.length) return prefix;
    return capped.length === 0
        ? ''
        : `${capped.join(KV_KEY_SEPARATOR)}${KV_KEY_SEPARATOR}`;
};

const parseFsSubject = (subject: string, parts: string[]): ParsedSubject => {
    if (parts.length < 2 || parts.length > 3) throw invalidSubject(subject);

    const ref = parts[1];
    if (!ref) throw invalidSubject(subject);

    let op: FsOp | null = null;
    if (parts.length === 3) {
        if (!FS_OPS.includes(parts[2] as FsOp)) {
            throw new HttpError(400, `Unknown operation: ${parts[2]}`, {
                legacyCode: 'invalid_subject_op',
            });
        }
        op = parts[2] as FsOp;
    }

    // Path-shaped or a uid, decided by the leading character — the same
    // dispatch the legacy FS selectors use.
    if (!ref.startsWith('/') && !ref.startsWith('~')) {
        if (GLOB_CHARS.test(ref)) throw invalidSubject(subject);
        return {
            family: 'fs',
            anchorRef: { kind: 'fsUid', uid: ref },
            op,
            rawMatch: null,
        };
    }
    // `~backup` is a name, not a home path — refuse it rather than anchoring on
    // whatever `/~backup` happens to be.
    if (ref.startsWith('~') && !isTildePath(ref)) throw invalidSubject(subject);

    const { literal, match } = splitGlobPrefix(ref);
    return {
        family: 'fs',
        anchorRef: { kind: 'fsPath', path: literal },
        op,
        rawMatch: match,
    };
};

const parseKvSubject = (subject: string, parts: string[]): ParsedSubject => {
    if (parts.length < 2) throw invalidSubject(subject);

    // Two segments is the app-relative form: the key belongs to whichever app
    // the caller is acting as, and the resolver fills that in. Three or more is
    // always fully qualified, which is what keeps `kv:orders:pending` from
    // being read as a key when it names app `orders`.
    const relative = parts.length === 2;
    const appUid = relative ? null : parts[1];
    // Components were unescaped on split, so re-joining reconstructs a key
    // whether or not its `:`s were escaped on the wire.
    const key = relative ? parts[1] : parts.slice(2).join(KV_KEY_SEPARATOR);
    if ((!relative && !appUid) || !key) throw invalidSubject(subject);

    const starIndex = key.indexOf('*');
    if (key.includes('?') || (starIndex !== -1 && starIndex !== key.length - 1))
        throw new HttpError(400, 'KV subjects widen with a trailing `*` only', {
            legacyCode: 'invalid_kv_pattern',
        });

    const widened = starIndex !== -1;
    const literal = widened ? key.slice(0, -1) : key;

    // A `*` that doesn't land on a delimiter isn't enumerable from a key at
    // write time, so the anchor backs off to the last delimiter and the whole
    // pattern becomes the filter.
    const onDelimiter =
        !widened || literal.length === 0 || literal.endsWith(':');
    let prefix = onDelimiter
        ? literal
        : literal.slice(0, literal.lastIndexOf(':') + 1);
    let rawMatch = onDelimiter ? null : key;

    const capped = capPrefix(prefix);
    if (capped !== prefix) {
        prefix = capped;
        rawMatch = key;
    }

    return {
        family: 'kv',
        anchorRef: { kind: 'kvPrefix', appUid, prefix, key },
        op: null,
        rawMatch,
    };
};

/**
 * `notif:<ref>:<audience>`, where `ref` is the app the rows are about. The
 * two-segment form leaves it to the server, which fills in the caller's own app
 * — an app never names an app uid — or the caller themselves when they act as
 * the account.
 */
const parseNotifSubject = (subject: string, parts: string[]): ParsedSubject => {
    if (parts.length < 2 || parts.length > 3) throw invalidSubject(subject);

    const relative = parts.length === 2;
    const ref = relative ? null : parts[1];
    const audience = relative ? parts[1] : parts[2];
    if (!audience || (!relative && !ref)) throw invalidSubject(subject);
    if (!NOTIF_AUDIENCES.includes(audience as NotificationAudience))
        throw new HttpError(400, `Unknown audience: ${audience}`, {
            legacyCode: 'invalid_subject_audience',
        });

    return {
        family: 'notif',
        anchorRef: {
            kind: 'notifScope',
            ref,
            audience: audience as NotificationAudience,
        },
        op: null,
        rawMatch: null,
    };
};

export function parseSubject(subject: string): ParsedSubject {
    if (typeof subject !== 'string' || subject.trim().length === 0)
        throw invalidSubject(String(subject));
    if (subject.length > SUBJECT_MAX_LENGTH) throw invalidSubject(subject);

    const trimmed = subject.trim();
    const parts = PermissionUtil.split(trimmed);

    switch (parts[0]) {
        case 'fs':
            return parseFsSubject(trimmed, parts);
        case 'kv':
            return parseKvSubject(trimmed, parts);
        case 'notif':
            return parseNotifSubject(trimmed, parts);
        default:
            throw invalidSubject(trimmed);
    }
}
