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
import type { FSEntry } from '../stores/fs/FSEntry.js';
import {
    isSignatureValid,
    signFile,
    verifySignature,
} from './fileSigning.js';

const CONFIG = {
    secret: 'a-real-secret-not-the-placeholder',
    apiBaseUrl: 'https://api.example.test',
};

const makeEntry = (): FSEntry =>
    ({
        uuid: '11111111-2222-3333-4444-555555555555',
        name: 'doc.txt',
        isDir: false,
        size: 10,
        accessed: 0,
        modified: 0,
        created: 0,
    }) as unknown as FSEntry;

const queryFromUrl = (url: string) => {
    const u = new URL(url);
    return {
        uid: u.searchParams.get('uid') ?? undefined,
        expires: u.searchParams.get('expires') ?? undefined,
        signature: u.searchParams.get('signature') ?? undefined,
    };
};

describe('fileSigning round-trip', () => {
    it('a freshly signed read URL verifies for read', () => {
        const signed = signFile(makeEntry(), CONFIG);
        expect(() =>
            verifySignature(queryFromUrl(signed.read_url), 'read', CONFIG),
        ).not.toThrow();
    });

    it('a write signature also satisfies read (superset)', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.write_url!);
        expect(isSignatureValid(q, 'write', CONFIG)).toBe(true);
        expect(isSignatureValid(q, 'read', CONFIG)).toBe(true);
    });

    it('a read signature does NOT satisfy write', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        expect(isSignatureValid(q, 'write', CONFIG)).toBe(false);
    });
});

describe('fileSigning rejection paths', () => {
    it('rejects a tampered signature', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        q.signature = (q.signature ?? '').replace(/^./, (c) =>
            c === 'a' ? 'b' : 'a',
        );
        expect(isSignatureValid(q, 'read', CONFIG)).toBe(false);
    });

    it('rejects a signature uid swapped to a different file', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        q.uid = '99999999-9999-9999-9999-999999999999';
        expect(isSignatureValid(q, 'read', CONFIG)).toBe(false);
    });

    it('rejects a signature minted under a different secret', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        expect(
            isSignatureValid(q, 'read', {
                ...CONFIG,
                secret: 'a-different-secret',
            }),
        ).toBe(false);
    });

    it('rejects an expired signature', () => {
        const signed = signFile(makeEntry(), CONFIG, { ttlSeconds: -10 });
        expect(() =>
            verifySignature(queryFromUrl(signed.read_url), 'read', CONFIG),
        ).toThrow(/expired/i);
    });

    it('rejects malformed (non-hex / wrong-length) signatures without throwing in the comparator', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        for (const bad of ['', 'zz', 'not-hex-at-all', 'abc']) {
            expect(isSignatureValid({ ...q, signature: bad }, 'read', CONFIG)).toBe(
                false,
            );
        }
    });
});
