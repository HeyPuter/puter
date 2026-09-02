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

import { HttpError } from '../../core/http/HttpError.js';
import { isTildePath } from '../fs/resolveNode.js';
import { PermissionUtil } from '../permission/permissionUtil.js';

/**
 * Subscription subjects, `:`-delimited with the same component escaping as
 * permission strings (`:` escapes as `\C`):
 *
 *     fs:<nodeUid|path>[:<op>]     op in add | write | move | remove | meta
 *     kv:<appUid>:<key>            exact key
 *     kv:<appUid>:<prefix>*        trailing `*` only
 *     notif:<channel>
 *
 * Parsing is pure syntax. It yields the anchor a subscription keys on plus the
 * glob the anchor's members are filtered by; turning that anchor into a node
 * uid is the resolver's job.
 */

// -- Types ------------------------------------------------------------

export type SubjectFamily = 'fs' | 'kv' | 'notif';

export type FsOp = 'add' | 'write' | 'move' | 'remove' | 'meta';

export type AnchorRef =
    | { kind: 'fsUid'; uid: string }
    | { kind: 'fsPath'; path: string }
    | { kind: 'kvPrefix'; appUid: string; prefix: string }
    | { kind: 'notifChannel'; channel: string };

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

const GLOB_CHARS = /[*?]/;

// -- Anchor tokens ----------------------------------------------------

/** Stored anchor token for an FS node. */
export const fsAnchorToken = (uid: string): string => `f#${uid}`;

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

/** Trim a KV prefix back to the segment cap, landing on a delimiter. */
const capPrefixSegments = (prefix: string): string => {
    const segments = prefix.split(':');
    const body =
        segments[segments.length - 1] === '' ? segments.slice(0, -1) : segments;
    if (body.length <= KV_TOKEN_SEGMENT_CAP) return prefix;
    return `${body.slice(0, KV_TOKEN_SEGMENT_CAP).join(':')}:`;
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
    if (parts.length < 3) throw invalidSubject(subject);

    const appUid = parts[1];
    // Components were unescaped on split, so re-joining reconstructs a key
    // whether or not its `:`s were escaped on the wire.
    const key = parts.slice(2).join(':');
    if (!appUid || !key) throw invalidSubject(subject);

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

    const capped = capPrefixSegments(prefix);
    if (capped !== prefix) {
        prefix = capped;
        rawMatch = key;
    }

    return {
        family: 'kv',
        anchorRef: { kind: 'kvPrefix', appUid, prefix },
        op: null,
        rawMatch,
    };
};

const parseNotifSubject = (subject: string, parts: string[]): ParsedSubject => {
    const channel = parts.slice(1).join(':');
    if (!channel) throw invalidSubject(subject);
    return {
        family: 'notif',
        anchorRef: { kind: 'notifChannel', channel },
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
