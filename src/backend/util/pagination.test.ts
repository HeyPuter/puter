import { describe, expect, it } from 'vitest';
import {
    clampLimit,
    decodeCursor,
    encodeCursor,
    keysetPage,
    normalizeLimit,
    normalizeOffset,
    openCursor,
    openIdCursor,
    pageEnvelope,
    parsePageQuery,
    sealCursor,
    unsealCursor,
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

        it('reads a stringified null cursor as none', () => {
            expect(decodeCursor('null')).toBeUndefined();
            expect(
                decodeCursor(Buffer.from('null').toString('base64')),
            ).toBeUndefined();
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

        it('pads to one length whatever the payload holds', () => {
            const short = sealCursor({ k: 'a' }, SECRET, { padTo: 256 })!;
            const long = sealCursor({ k: 'a'.repeat(200) }, SECRET, {
                padTo: 256,
            })!;
            expect(short.length).toBe(long.length);
            expect(unsealCursor(short, SECRET)).toEqual({ k: 'a' });
            expect(openCursor(long, SECRET)).toEqual({ k: 'a'.repeat(200) });
            // Past the size, the next multiple rather than a cut.
            const over = sealCursor({ k: 'a'.repeat(300) }, SECRET, {
                padTo: 256,
            })!;
            expect(Buffer.from(over, 'base64url').length).toBe(
                Buffer.from(short, 'base64url').length + 256,
            );
        });

        it('opens only what it sealed with unsealCursor', () => {
            expect(unsealCursor(encodeCursor({ id: 7 })!, SECRET)).toBeNull();
            expect(
                unsealCursor(sealCursor({ id: 7 }, 'other-secret')!, SECRET),
            ).toBeNull();
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

        it('throws 400 on a fraction that floors to zero', () => {
            expect(() => normalizeLimit(0.5)).toThrowError(
                'limit must be a positive number',
            );
            expect(() => normalizeLimit('0.99')).toThrowError(HttpError);
            expect(normalizeLimit(1.5)).toBe(1);
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
            expect(openIdCursor('null', secret)).toBeNull();
            expect(openIdCursor('null', secret, { strict: true })).toBeNull();
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

        it('reads only an integer or a digit string as the id', () => {
            expect(openIdCursor({ id: '12' }, secret)).toBe(12);
            for (const id of [null, [7], true, '7x', 1.5]) {
                expect(openIdCursor({ id }, secret)).toBeNull();
                expect(() =>
                    openIdCursor({ id }, secret, { strict: true }),
                ).toThrowError(HttpError);
            }
        });

        it('refuses a cursor that is neither a string nor an object', () => {
            for (const cursor of [5, true, ['x']]) {
                expect(() =>
                    openIdCursor(cursor as never, secret),
                ).toThrowError(HttpError);
            }
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

describe('clampLimit', () => {
    const opts = { fallback: 50, cap: 200 };

    it('defaults a missing, zero or unreadable limit', () => {
        expect(clampLimit(undefined, opts)).toBe(50);
        expect(clampLimit(null, opts)).toBe(50);
        expect(clampLimit(0, opts)).toBe(50);
        expect(clampLimit('abc', opts)).toBe(50);
    });

    it('floors and keeps the limit within [1, cap]', () => {
        expect(clampLimit('12.9', opts)).toBe(12);
        expect(clampLimit(-5, opts)).toBe(1);
        expect(clampLimit(10_000, opts)).toBe(200);
    });
});

describe('parsePageQuery', () => {
    it('reads limit, cursor and includeTotal', () => {
        expect(
            parsePageQuery(
                { limit: '500', cursor: 'abc', includeTotal: 'true' },
                { cap: 100 },
            ),
        ).toEqual({ limit: 100, cursor: 'abc', includeTotal: true });
    });

    it('leaves absent or non-string values out', () => {
        expect(parsePageQuery({ cursor: ['a'], includeTotal: '1' })).toEqual({
            limit: undefined,
            cursor: undefined,
            includeTotal: false,
        });
        expect(parsePageQuery(undefined)).toEqual({
            limit: undefined,
            cursor: undefined,
            includeTotal: false,
        });
    });

    it('refuses a bad limit', () => {
        expect(() => parsePageQuery({ limit: '-1' })).toThrow(HttpError);
    });
});

describe('pageEnvelope', () => {
    it('includes cursor and total only when set', () => {
        expect(pageEnvelope({ items: [1, 2] })).toEqual({ items: [1, 2] });
        expect(
            pageEnvelope({ items: [1], cursor: 'next', total: 0 }),
        ).toEqual({ items: [1], cursor: 'next', total: 0 });
        expect(pageEnvelope({ items: [], cursor: null })).toEqual({
            items: [],
        });
    });

    it('maps items when given a mapper', () => {
        expect(
            pageEnvelope({ items: [{ id: 1 }], cursor: 'c' }, (row) => row.id),
        ).toEqual({ items: [1], cursor: 'c' });
    });
});
