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

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
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

const OWNER_ID = 42;

const makeEntry = (): FSEntry =>
    ({
        uuid: '11111111-2222-3333-4444-555555555555',
        name: 'doc.txt',
        isDir: false,
        size: 10,
        accessed: 0,
        modified: 0,
        created: 0,
        userId: OWNER_ID,
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
            verifySignature(
                queryFromUrl(signed.read_url),
                'read',
                CONFIG,
                OWNER_ID,
            ),
        ).not.toThrow();
    });

    it('a write signature also satisfies read (superset)', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.write_url!);
        expect(isSignatureValid(q, 'write', CONFIG, OWNER_ID)).toBe(true);
        expect(isSignatureValid(q, 'read', CONFIG, OWNER_ID)).toBe(true);
    });

    it('a read signature does NOT satisfy write', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        expect(isSignatureValid(q, 'write', CONFIG, OWNER_ID)).toBe(false);
    });
});

describe('fileSigning rejection paths', () => {
    it('rejects a tampered signature', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        q.signature = (q.signature ?? '').replace(/^./, (c) =>
            c === 'a' ? 'b' : 'a',
        );
        expect(isSignatureValid(q, 'read', CONFIG, OWNER_ID)).toBe(false);
    });

    it('rejects a signature uid swapped to a different file', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        q.uid = '99999999-9999-9999-9999-999999999999';
        expect(isSignatureValid(q, 'read', CONFIG, OWNER_ID)).toBe(false);
    });

    it('rejects a signature minted under a different secret', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        expect(
            isSignatureValid(
                q,
                'read',
                { ...CONFIG, secret: 'a-different-secret' },
                OWNER_ID,
            ),
        ).toBe(false);
    });

    it('rejects an expired signature', () => {
        const signed = signFile(makeEntry(), CONFIG, { ttlSeconds: -10 });
        expect(() =>
            verifySignature(
                queryFromUrl(signed.read_url),
                'read',
                CONFIG,
                OWNER_ID,
            ),
        ).toThrow(/expired/i);
    });

    it('rejects malformed (non-hex / wrong-length) signatures without throwing in the comparator', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const q = queryFromUrl(signed.read_url);
        for (const bad of ['', 'zz', 'not-hex-at-all', 'abc']) {
            expect(
                isSignatureValid(
                    { ...q, signature: bad },
                    'read',
                    CONFIG,
                    OWNER_ID,
                ),
            ).toBe(false);
        }
    });
});

describe('fileSigning owner binding', () => {
    // The format signatures had before owner binding; URLs carrying it are
    // still in circulation.
    const legacySign = (action: 'read' | 'write', expires: number) => {
        const uid = makeEntry().uuid;
        return {
            uid,
            expires: String(expires),
            signature: createHash('sha256')
                .update(`${uid}/${action}/${CONFIG.secret}/${expires}`)
                .digest('hex'),
        };
    };
    const farFuture = Math.ceil(Date.now() / 1000) + 9_999_999_999_999;

    it('rejects a signature once the entry has a different owner', () => {
        const signed = signFile(makeEntry(), CONFIG);
        for (const url of [signed.read_url, signed.write_url!]) {
            const q = queryFromUrl(url);
            expect(isSignatureValid(q, 'read', CONFIG, OWNER_ID + 1)).toBe(
                false,
            );
        }
        expect(
            isSignatureValid(
                queryFromUrl(signed.write_url!),
                'write',
                CONFIG,
                OWNER_ID + 1,
            ),
        ).toBe(false);
    });

    it('rejects a signature when the entry no longer exists', () => {
        const signed = signFile(makeEntry(), CONFIG);
        expect(
            isSignatureValid(
                queryFromUrl(signed.read_url),
                'read',
                CONFIG,
                null,
            ),
        ).toBe(false);
    });

    it('still verifies a signature in the pre-binding format, whoever owns the entry', () => {
        const read = legacySign('read', farFuture);
        const write = legacySign('write', farFuture);
        for (const owner of [OWNER_ID, OWNER_ID + 1, null]) {
            expect(isSignatureValid(read, 'read', CONFIG, owner)).toBe(true);
            expect(isSignatureValid(write, 'read', CONFIG, owner)).toBe(true);
            expect(isSignatureValid(write, 'write', CONFIG, owner)).toBe(true);
            expect(isSignatureValid(read, 'write', CONFIG, owner)).toBe(false);
        }
    });

    it('rejects a pre-binding signature that has expired', () => {
        const expired = legacySign('read', Math.floor(Date.now() / 1000) - 10);
        expect(() =>
            verifySignature(expired, 'read', CONFIG, OWNER_ID),
        ).toThrow(/expired/i);
    });

    it('keeps the URL shape existing clients parse', () => {
        const signed = signFile(makeEntry(), CONFIG);
        const url = new URL(signed.read_url);
        expect([...url.searchParams.keys()]).toEqual([
            'uid',
            'expires',
            'signature',
        ]);
        expect(url.searchParams.get('signature')).toBe(signed.signature);
        expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('fileSigning legacy signature switch', () => {
    const legacySign = (action: 'read' | 'write', expires: number) => {
        const uid = makeEntry().uuid;
        return {
            uid,
            expires: String(expires),
            signature: createHash('sha256')
                .update(`${uid}/${action}/${CONFIG.secret}/${expires}`)
                .digest('hex'),
        };
    };
    const farFuture = Math.ceil(Date.now() / 1000) + 9_999_999_999_999;

    it('accepts a pre-binding signature when allowLegacySignatures is unset (default on)', () => {
        const read = legacySign('read', farFuture);
        expect(isSignatureValid(read, 'read', CONFIG, OWNER_ID)).toBe(true);
    });

    it('refuses a pre-binding signature once allowLegacySignatures is false', () => {
        const read = legacySign('read', farFuture);
        const config = { ...CONFIG, allowLegacySignatures: false };
        expect(() => verifySignature(read, 'read', config, OWNER_ID)).toThrow(
            /Authentication failed/,
        );
    });

    it('still accepts an owner-bound signature when allowLegacySignatures is false', () => {
        const config = { ...CONFIG, allowLegacySignatures: false };
        const signed = signFile(makeEntry(), config);
        expect(() =>
            verifySignature(
                queryFromUrl(signed.read_url),
                'read',
                config,
                OWNER_ID,
            ),
        ).not.toThrow();
    });
});

describe('fileSigning legacy signature visibility', () => {
    it('warns when a legacy signature is accepted, not for an owner-bound one', async () => {
        vi.resetModules();
        const fresh = await import('./fileSigning.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const uid = makeEntry().uuid;
            const expires = Math.ceil(Date.now() / 1000) + 9_999_999_999_999;
            const legacy = {
                uid,
                expires: String(expires),
                signature: createHash('sha256')
                    .update(`${uid}/read/${CONFIG.secret}/${expires}`)
                    .digest('hex'),
            };
            expect(
                fresh.isSignatureValid(legacy, 'read', CONFIG, OWNER_ID),
            ).toBe(true);
            expect(warn).toHaveBeenCalledTimes(1);
            // The log is operational, not forensic — no uid or signature in it.
            expect(warn.mock.calls[0]?.[0]).not.toContain(uid);

            const signed = fresh.signFile(makeEntry(), CONFIG);
            fresh.verifySignature(
                queryFromUrl(signed.read_url),
                'read',
                CONFIG,
                OWNER_ID,
            );
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
    });
});
