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

import { describe, expect, it } from 'vitest';
import { HttpError } from '../../core/http/HttpError.js';
import { PermissionUtil } from '../permission/permissionUtil.js';
import {
    KV_TOKEN_SEGMENT_CAP,
    fsAnchorToken,
    isKvToken,
    kvAnchorToken,
    kvAnchorTokens,
    kvKeyPrefixes,
    parseSubject,
    SUBJECT_MAX_LENGTH,
    type AnchorRef,
    type FsOp,
} from './subjects.js';

const APP = 'app-1234';
const HANDLE = 'kvh-9f1c2d3e';

interface SubjectRow {
    subject: string;
    anchorRef: AnchorRef;
    op: FsOp | null;
    rawMatch: string | null;
}

// The anchor/match table the subject grammar is specified by.
const ACCEPTED: SubjectRow[] = [
    {
        subject: 'fs:~/Documents:write',
        anchorRef: { kind: 'fsPath', path: '~/Documents' },
        op: 'write',
        rawMatch: null,
    },
    {
        subject: 'fs:~/Documents/triggerFile:add',
        anchorRef: { kind: 'fsPath', path: '~/Documents/triggerFile' },
        op: 'add',
        rawMatch: null,
    },
    {
        subject: 'fs:~/Documents/**/*.png:add',
        anchorRef: { kind: 'fsPath', path: '~/Documents' },
        op: 'add',
        rawMatch: '**/*.png',
    },
    {
        subject: `kv:${APP}:cart:*`,
        anchorRef: { kind: 'kvPrefix', appUid: APP, prefix: 'cart:', key: 'cart:*' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${APP}:user:12*`,
        anchorRef: {
            kind: 'kvPrefix',
            appUid: APP,
            prefix: 'user:',
            key: 'user:12*',
        },
        op: null,
        rawMatch: 'user:12*',
    },
    // Beyond the table: the rest of the grammar.
    {
        subject: 'fs:uid-abc',
        anchorRef: { kind: 'fsUid', uid: 'uid-abc' },
        op: null,
        rawMatch: null,
    },
    {
        subject: 'fs:uid-abc:remove',
        anchorRef: { kind: 'fsUid', uid: 'uid-abc' },
        op: 'remove',
        rawMatch: null,
    },
    {
        subject: 'fs:/alice/Documents:meta',
        anchorRef: { kind: 'fsPath', path: '/alice/Documents' },
        op: 'meta',
        rawMatch: null,
    },
    {
        subject: 'fs:~',
        anchorRef: { kind: 'fsPath', path: '~' },
        op: null,
        rawMatch: null,
    },
    {
        subject: 'fs:~/*:move',
        anchorRef: { kind: 'fsPath', path: '~' },
        op: 'move',
        rawMatch: '*',
    },
    {
        subject: `kv:${APP}:cart`,
        anchorRef: { kind: 'kvPrefix', appUid: APP, prefix: 'cart', key: 'cart' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${APP}:cart:items`,
        anchorRef: {
            kind: 'kvPrefix',
            appUid: APP,
            prefix: 'cart:items',
            key: 'cart:items',
        },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${APP}:*`,
        anchorRef: { kind: 'kvPrefix', appUid: APP, prefix: '', key: '*' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${HANDLE}:messages:*`,
        anchorRef: { kind: 'kvHandle', handle: HANDLE, key: 'messages:*' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${HANDLE}:*`,
        anchorRef: { kind: 'kvHandle', handle: HANDLE, key: '*' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${HANDLE}:messages:1`,
        anchorRef: { kind: 'kvHandle', handle: HANDLE, key: 'messages:1' },
        op: null,
        rawMatch: null,
    },
    {
        subject: 'notif:account',
        anchorRef: { kind: 'notifScope', ref: null, audience: 'account' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `notif:${APP}:app-user`,
        anchorRef: { kind: 'notifScope', ref: APP, audience: 'app-user' },
        op: null,
        rawMatch: null,
    },
];

const REJECTED: Array<{ subject: string; code: string }> = [
    { subject: '', code: 'invalid_subject' },
    { subject: '   ', code: 'invalid_subject' },
    { subject: 'fs', code: 'invalid_subject' },
    { subject: 'fs:', code: 'invalid_subject' },
    { subject: 'ai:gpt:write', code: 'invalid_subject' },
    { subject: 'fs:/a/b:c:write', code: 'invalid_subject' },
    { subject: 'fs:uid-*', code: 'invalid_subject' },
    // A slash means this was meant as a path, whatever leads it — never fall
    // through and read it as an opaque uid.
    { subject: 'fs:  /u/a', code: 'invalid_subject' },
    { subject: 'fs:/alice/\x01evil', code: 'invalid_subject' },
    { subject: 'fs:~backup:add', code: 'invalid_subject' },
    { subject: 'fs:~/Documents:touch', code: 'invalid_subject_op' },
    { subject: 'fs:~/Documents:WRITE', code: 'invalid_subject_op' },
    { subject: 'kv:', code: 'invalid_subject' },
    { subject: 'kv::cart', code: 'invalid_subject' },
    { subject: `kv:${APP}:*cart`, code: 'invalid_kv_pattern' },
    { subject: `kv:${APP}:ca*rt`, code: 'invalid_kv_pattern' },
    { subject: `kv:${APP}:cart:*:items`, code: 'invalid_kv_pattern' },
    { subject: `kv:${APP}:car?`, code: 'invalid_kv_pattern' },
    { subject: `kv:${HANDLE}:..:secrets`, code: 'invalid_kv_handle_key' },
    { subject: `kv:${HANDLE}:..`, code: 'invalid_kv_handle_key' },
    { subject: `kv:${HANDLE}::absolute`, code: 'invalid_kv_handle_key' },
    { subject: `kv:${HANDLE}`, code: 'invalid_kv_handle_key' },
    { subject: `kv:${HANDLE}:`, code: 'invalid_subject' },
    { subject: `kv:${HANDLE}:mes*ages`, code: 'invalid_kv_pattern' },
    { subject: 'notif:', code: 'invalid_subject' },
    { subject: `notif:${APP}:`, code: 'invalid_subject' },
    { subject: 'notif:everyone', code: 'invalid_subject_audience' },
    { subject: `notif:${APP}:owner`, code: 'invalid_subject_audience' },
    { subject: `notif:${APP}:app-user:extra`, code: 'invalid_subject' },
];

describe('parseSubject', () => {
    it.each(ACCEPTED)('parses $subject', (row) => {
        const parsed = parseSubject(row.subject);
        expect(parsed.anchorRef).toEqual(row.anchorRef);
        expect(parsed.op).toBe(row.op);
        expect(parsed.rawMatch).toBe(row.rawMatch);
    });

    it.each(ACCEPTED)('reports the family of $subject', (row) => {
        expect(parseSubject(row.subject).family).toBe(
            row.subject.split(':')[0],
        );
    });

    it.each(REJECTED)('rejects $subject with $code', (row) => {
        let thrown: unknown;
        try {
            parseSubject(row.subject);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(HttpError);
        expect((thrown as HttpError).legacyCode).toBe(row.code);
    });

    it('unescapes a `:` in an fs path', () => {
        const subject = PermissionUtil.join('fs', '/alice/a:b', 'write');
        expect(subject).toBe('fs:/alice/a\\Cb:write');
        expect(parseSubject(subject)).toMatchObject({
            anchorRef: { kind: 'fsPath', path: '/alice/a:b' },
            op: 'write',
        });
    });

    it('reads an escaped and an unescaped kv key the same way', () => {
        const escaped = parseSubject(
            PermissionUtil.join('kv', APP, 'cart:items'),
        );
        expect(escaped.anchorRef).toEqual(
            parseSubject(`kv:${APP}:cart:items`).anchorRef,
        );
    });

    it('anchors a kv key at the segment cap and filters the rest', () => {
        const parsed = parseSubject(`kv:${APP}:a:b:c:d:e:f:g`);
        expect(parsed.anchorRef).toEqual({
            kind: 'kvPrefix',
            appUid: APP,
            prefix: 'a:b:c:d:e:f:',
            key: 'a:b:c:d:e:f:g',
        });
        expect(parsed.rawMatch).toBe('a:b:c:d:e:f:g');
    });

    it('leaves a two-segment kv subject`s app for the resolver to fill in', () => {
        expect(parseSubject('kv:cart').anchorRef).toEqual({
            kind: 'kvPrefix',
            appUid: null,
            prefix: 'cart',
            key: 'cart',
        });
        expect(parseSubject('kv:cart*').anchorRef).toEqual({
            kind: 'kvPrefix',
            appUid: null,
            prefix: '',
            key: 'cart*',
        });
    });

    it('reads a third segment as the key, never as sugar', () => {
        expect(parseSubject('kv:orders:pending').anchorRef).toMatchObject({
            appUid: 'orders',
            key: 'pending',
        });
    });

    it('tolerates surrounding whitespace', () => {
        expect(parseSubject('  fs:~/Documents:write  ')).toMatchObject({
            anchorRef: { kind: 'fsPath', path: '~/Documents' },
        });
    });
});

describe('subject length', () => {
    it('rejects a subject longer than the widest path the filesystem stores', () => {
        const subject = `fs:/alice/${'a'.repeat(SUBJECT_MAX_LENGTH)}`;
        let thrown: unknown;
        try {
            parseSubject(subject);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(HttpError);
        expect((thrown as HttpError).legacyCode).toBe('invalid_subject');
    });

    it('accepts one right at the cap', () => {
        const prefix = 'fs:/alice/';
        const subject = `${prefix}${'a'.repeat(SUBJECT_MAX_LENGTH - prefix.length)}`;
        expect(parseSubject(subject).family).toBe('fs');
    });
});

describe('fsAnchorToken', () => {
    it('namespaces node uids', () => {
        expect(fsAnchorToken('uid-abc')).toBe('f#uid-abc');
    });
});

describe('kv anchor tokens', () => {
    const USER = 'user-uuid';

    it('carries the user, so two users of one app do not collide', () => {
        expect(kvAnchorToken(USER, APP, 'cart:')).toBe(
            `k#${USER}#${APP}#cart:`,
        );
        expect(kvAnchorToken('other', APP, 'cart:')).not.toBe(
            kvAnchorToken(USER, APP, 'cart:'),
        );
    });

    it('tells a kv token from an fs one', () => {
        expect(isKvToken(kvAnchorToken(USER, APP, ''))).toBe(true);
        expect(isKvToken(fsAnchorToken('uid-abc'))).toBe(false);
    });

    it('enumerates the exact key and then its prefixes', () => {
        expect(kvAnchorTokens(USER, APP, 'cart:items:1')).toEqual([
            `k#${USER}#${APP}#cart:items:1`,
            `k#${USER}#${APP}#`,
            `k#${USER}#${APP}#cart:`,
            `k#${USER}#${APP}#cart:items:`,
        ]);
    });

    it('does not enumerate a bare parent, so an exact key stays exact', () => {
        expect(kvAnchorTokens(USER, APP, 'cart:items')).not.toContain(
            `k#${USER}#${APP}#cart`,
        );
    });

    it('says a key with no delimiter once', () => {
        expect(kvAnchorTokens(USER, APP, 'cart')).toEqual([
            `k#${USER}#${APP}#cart`,
            `k#${USER}#${APP}#`,
        ]);
    });

    it('stops enumerating prefixes at the segment cap', () => {
        const prefixes = kvKeyPrefixes('a:b:c:d:e:f:g:h:i');
        expect(prefixes).toHaveLength(KV_TOKEN_SEGMENT_CAP + 1);
        expect(prefixes.at(-1)).toBe('a:b:c:d:e:f:');
    });

    it('keeps a token inside the column that indexes it', () => {
        const long = Array.from({ length: 6 }, () => 'x'.repeat(60)).join(':');
        const parsed = parseSubject(`kv:${APP}:${long}:*`);
        const anchor = parsed.anchorRef as { prefix: string };

        expect(
            Buffer.byteLength(
                kvAnchorToken('u'.repeat(36), 'a'.repeat(40), anchor.prefix),
            ),
        ).toBeLessThanOrEqual(255);
        // Nothing is lost: what the prefix gave up becomes the filter.
        expect(parsed.rawMatch).toBe(`${long}:*`);
    });

    it('reaches the anchor a capped subject stored', () => {
        const parsed = parseSubject(`kv:${APP}:a:b:c:d:e:f:g`);
        const anchor = parsed.anchorRef as { prefix: string };
        expect(kvAnchorTokens(USER, APP, 'a:b:c:d:e:f:g')).toContain(
            kvAnchorToken(USER, APP, anchor.prefix),
        );
    });
});
