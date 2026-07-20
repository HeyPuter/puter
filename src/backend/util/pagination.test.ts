import { describe, expect, it } from 'vitest';
import {
    decodeCursor,
    encodeCursor,
    normalizeLimit,
    normalizeOffset,
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
});
