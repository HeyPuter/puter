import { describe, expect, it } from 'vitest';
import {
    decodeCursor,
    encodeCursor,
    keysetPage,
    normalizeLimit,
    normalizeOffset,
    openCursor,
    openIdCursor,
    sealCursor,
} from './pagination';
import { HttpError } from '../core/http';

describe('pagination util', () => {
    describe('encodeCursor / decodeCursor', () => {
        it('round-trips a payload', () => {
            const payload = { id: 42, s: 'name' };
            expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
        });

        it('returns undefined for empty payloads', () => {
            expect(encodeCursor(undefined)).toBeUndefined();
            expect(encodeCursor({})).toBeUndefined();
        });

        it('returns undefined for null/undefined/blank cursors', () => {
            expect(decodeCursor(undefined)).toBeUndefined();
            expect(decodeCursor(null)).toBeUndefined();
            expect(decodeCursor('   ')).toBeUndefined();
        });

        it('passes through object cursors', () => {
            expect(decodeCursor({ id: 1 })).toEqual({ id: 1 });
        });

        it('accepts raw JSON cursors', () => {
            expect(decodeCursor('{"id":7}')).toEqual({ id: 7 });
        });

        it('throws 400 on garbage', () => {
            expect(() => decodeCursor('!!!not-a-cursor!!!')).toThrowError(
                HttpError,
            );
        });
    });

    describe('sealCursor / openCursor', () => {
        const SECRET = 'cursor-test-secret';

        it('round-trips a payload', () => {
            const sealed = sealCursor({ id: 1234567 }, SECRET);
            expect(openCursor(sealed, SECRET)).toEqual({ id: 1234567 });
        });

        it('carries nothing a holder can read back', () => {
            const sealed = sealCursor({ id: 1234567 }, SECRET)!;
            expect(
                Buffer.from(sealed, 'base64url').toString('latin1'),
            ).not.toContain('1234567');
            expect(() => decodeCursor(sealed)).toThrowError(HttpError);
        });

        it('does not repeat itself for the same position', () => {
            expect(sealCursor({ id: 1 }, SECRET)).not.toBe(
                sealCursor({ id: 1 }, SECRET),
            );
        });

        it('refuses a cursor altered in transit', () => {
            const raw = Buffer.from(
                sealCursor({ id: 9 }, SECRET)!,
                'base64url',
            );
            raw[raw.length - 1] ^= 1;
            expect(() =>
                openCursor(raw.toString('base64url'), SECRET),
            ).toThrowError(HttpError);
        });

        it('refuses a cursor sealed under another secret', () => {
            const sealed = sealCursor({ id: 9 }, 'some-other-secret');
            expect(() => openCursor(sealed, SECRET)).toThrowError(HttpError);
        });

        it('still reads a plain cursor issued before sealing', () => {
            expect(openCursor(encodeCursor({ id: 7 }), SECRET)).toEqual({
                id: 7,
            });
        });

        it('answers no cursor the way decodeCursor does', () => {
            expect(sealCursor({}, SECRET)).toBeUndefined();
            expect(openCursor(undefined, SECRET)).toBeUndefined();
            expect(openCursor(null, SECRET)).toBeUndefined();
            expect(openCursor('  ', SECRET)).toBeUndefined();
        });

        it('falls back to a plain cursor without a secret', () => {
            const plain = sealCursor({ id: 3 }, undefined);
            expect(plain).toBe(encodeCursor({ id: 3 }));
            expect(openCursor(plain, undefined)).toEqual({ id: 3 });
        });
    });

    describe('normalizeLimit', () => {
        it('returns undefined when absent', () => {
            expect(normalizeLimit(undefined)).toBeUndefined();
            expect(normalizeLimit(null)).toBeUndefined();
        });

        it('floors and caps', () => {
            expect(normalizeLimit(10.9)).toBe(10);
            expect(normalizeLimit(9000, { cap: 500 })).toBe(500);
        });

        it('throws 400 on zero, negative, or non-numeric', () => {
            expect(() => normalizeLimit(0)).toThrowError(HttpError);
            expect(() => normalizeLimit(-5)).toThrowError(HttpError);
            expect(() => normalizeLimit('abc')).toThrowError(HttpError);
        });
    });

    describe('normalizeOffset', () => {
        it('returns undefined when absent', () => {
            expect(normalizeOffset(undefined)).toBeUndefined();
        });

        it('accepts zero', () => {
            expect(normalizeOffset(0)).toBe(0);
        });

        it('throws 400 on negative or non-numeric', () => {
            expect(() => normalizeOffset(-1)).toThrowError(HttpError);
            expect(() => normalizeOffset('x')).toThrowError(HttpError);
        });

        it('throws 400 above the cap', () => {
            expect(() => normalizeOffset(5001, { cap: 5000 })).toThrowError(
                HttpError,
            );
            expect(normalizeOffset(5000, { cap: 5000 })).toBe(5000);
        });
    });

    describe('openIdCursor', () => {
        const secret = 'keyset-secret';

        it('returns null without a cursor', () => {
            expect(openIdCursor(undefined, secret)).toBeNull();
            expect(openIdCursor('', secret)).toBeNull();
        });

        it('reads the id from a sealed or plain cursor', () => {
            expect(openIdCursor(sealCursor({ id: 41 }, secret), secret)).toBe(
                41,
            );
            expect(openIdCursor(encodeCursor({ id: 7 }), secret)).toBe(7);
        });

        it('reads a cursor without a usable id as the first page', () => {
            expect(
                openIdCursor(encodeCursor({ appUid: 'app-1' }), secret),
            ).toBeNull();
            expect(openIdCursor(encodeCursor({ id: -3 }), secret)).toBeNull();
        });

        it('refuses a cursor without a usable id when strict', () => {
            expect(() =>
                openIdCursor(encodeCursor({ id: 'x' }), secret, {
                    label: 'share cursor',
                    strict: true,
                }),
            ).toThrowError('invalid share cursor');
        });

        it('refuses an unreadable cursor either way', () => {
            expect(() => openIdCursor('!!!', secret)).toThrowError(HttpError);
        });
    });

    describe('keysetPage', () => {
        const secret = 'keyset-secret';
        const rows = [{ id: 3 }, { id: 5 }, { id: 9 }];

        it('returns every row and no cursor when nothing follows', () => {
            expect(keysetPage(rows, 3, secret)).toEqual({ rows });
        });

        it('cuts to the limit and points the cursor at the last row kept', () => {
            const page = keysetPage(rows, 2, secret);
            expect(page.rows).toEqual([{ id: 3 }, { id: 5 }]);
            expect(openIdCursor(page.cursor, secret)).toBe(5);
        });

        it('takes a custom position, plain without a secret', () => {
            const page = keysetPage(
                [{ app: 'a' }, { app: 'b' }],
                1,
                undefined,
                (last) => ({ appUid: last.app }),
            );
            expect(decodeCursor(page.cursor)).toEqual({ appUid: 'a' });
        });
    });
});
