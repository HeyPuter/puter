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
    fsAnchorToken,
    parseSubject,
    type AnchorRef,
    type FsOp,
} from './subjects.js';

const APP = 'app-1234';

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
        anchorRef: { kind: 'kvPrefix', appUid: APP, prefix: 'cart:' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${APP}:user:12*`,
        anchorRef: { kind: 'kvPrefix', appUid: APP, prefix: 'user:' },
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
        anchorRef: { kind: 'kvPrefix', appUid: APP, prefix: 'cart' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${APP}:cart:items`,
        anchorRef: { kind: 'kvPrefix', appUid: APP, prefix: 'cart:items' },
        op: null,
        rawMatch: null,
    },
    {
        subject: `kv:${APP}:*`,
        anchorRef: { kind: 'kvPrefix', appUid: APP, prefix: '' },
        op: null,
        rawMatch: null,
    },
    {
        subject: 'notif:share.received',
        anchorRef: { kind: 'notifChannel', channel: 'share.received' },
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
    { subject: 'fs:~backup:add', code: 'invalid_subject' },
    { subject: 'fs:~/Documents:touch', code: 'invalid_subject_op' },
    { subject: 'fs:~/Documents:WRITE', code: 'invalid_subject_op' },
    { subject: `kv:${APP}`, code: 'invalid_subject' },
    { subject: 'kv::cart', code: 'invalid_subject' },
    { subject: `kv:${APP}:*cart`, code: 'invalid_kv_pattern' },
    { subject: `kv:${APP}:ca*rt`, code: 'invalid_kv_pattern' },
    { subject: `kv:${APP}:cart:*:items`, code: 'invalid_kv_pattern' },
    { subject: `kv:${APP}:car?`, code: 'invalid_kv_pattern' },
    { subject: 'notif:', code: 'invalid_subject' },
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
        });
        expect(parsed.rawMatch).toBe('a:b:c:d:e:f:g');
    });

    it('tolerates surrounding whitespace', () => {
        expect(parseSubject('  fs:~/Documents:write  ')).toMatchObject({
            anchorRef: { kind: 'fsPath', path: '~/Documents' },
        });
    });
});

describe('fsAnchorToken', () => {
    it('namespaces node uids', () => {
        expect(fsAnchorToken('uid-abc')).toBe('f#uid-abc');
    });
});
