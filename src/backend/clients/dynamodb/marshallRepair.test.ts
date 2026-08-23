import { describe, expect, it } from 'vitest';
import {
    clampStoredNumber,
    isRepairableMarshallError,
    MAX_STORED_NUMBER,
    MIN_STORED_NUMBER,
    repairForMarshall,
} from './marshallRepair.ts';

describe('isRepairableMarshallError', () => {
    it('recognizes the out-of-range and special-value failures', () => {
        for (const message of [
            'Number 1.6515584833071455e+55 is greater than Number.MAX_SAFE_INTEGER. Use NumberValue from @aws-sdk/lib-dynamodb.',
            'Number -1e+55 is lesser than Number.MIN_SAFE_INTEGER. Use NumberValue from @aws-sdk/lib-dynamodb.',
            'Special numeric value NaN is not allowed',
            'Special numeric value Infinity is not allowed',
        ]) {
            expect(isRepairableMarshallError(new Error(message))).toBe(true);
        }
    });

    it('leaves every other failure alone', () => {
        for (const error of [
            new Error('Unsupported type passed: [object Symbol].'),
            new Error('ValidationException'),
            new Error(''),
            undefined,
            'not an error',
        ]) {
            expect(isRepairableMarshallError(error)).toBe(false);
        }
    });
});

describe('repairForMarshall', () => {
    it('clamps a number past the safe range in both directions', () => {
        expect(repairForMarshall(1.6515584833071455e55)).toEqual({
            value: MAX_STORED_NUMBER,
            changed: true,
        });
        expect(repairForMarshall(-1e55)).toEqual({
            value: MIN_STORED_NUMBER,
            changed: true,
        });
    });

    it('clamps infinities and nulls NaN', () => {
        expect(repairForMarshall(Infinity).value).toBe(MAX_STORED_NUMBER);
        expect(repairForMarshall(-Infinity).value).toBe(MIN_STORED_NUMBER);
        expect(repairForMarshall(NaN)).toEqual({ value: null, changed: true });
    });

    it('repairs numbers nested in objects and arrays', () => {
        const repaired = repairForMarshall({
            profile: { netWorth: 1e55, level: 29 },
            scores: [1, [2, -1e55]],
        });

        expect(repaired.changed).toBe(true);
        expect(repaired.value).toEqual({
            profile: { netWorth: MAX_STORED_NUMBER, level: 29 },
            scores: [1, [2, MIN_STORED_NUMBER]],
        });
    });

    it('returns the original payload untouched when nothing is out of range', () => {
        const payload = {
            a: MAX_STORED_NUMBER,
            b: [1, 2, { c: 'three' }],
            d: null,
        };

        const repaired = repairForMarshall(payload);
        expect(repaired.changed).toBe(false);
        expect(repaired.value).toBe(payload);
    });

    it('does not mutate the payload it repairs', () => {
        const nested = { netWorth: 1e55 };
        const payload = { nested };

        repairForMarshall(payload);

        expect(nested.netWorth).toBe(1e55);
    });

    it('keeps a `__proto__` key as data', () => {
        const payload = JSON.parse('{"__proto__":{"big":1e55}}');

        const repaired = repairForMarshall(payload) as {
            value: Record<string, unknown>;
            changed: boolean;
        };

        expect(repaired.changed).toBe(true);
        expect(Object.getPrototypeOf(repaired.value)).toBe(Object.prototype);
        expect(
            Object.getOwnPropertyDescriptor(repaired.value, '__proto__')?.value,
        ).toEqual({ big: MAX_STORED_NUMBER });
    });

    it('leaves values it does not own alone', () => {
        const date = new Date(0);
        expect(repairForMarshall(date).value).toBe(date);
        expect(repairForMarshall('str')).toEqual({
            value: 'str',
            changed: false,
        });
    });
});

describe('clampStoredNumber', () => {
    it('decodes a number inside the range unchanged', () => {
        expect(clampStoredNumber('42')).toBe(42);
        expect(clampStoredNumber('-0.5')).toBe(-0.5);
        expect(clampStoredNumber(String(MAX_STORED_NUMBER))).toBe(
            MAX_STORED_NUMBER,
        );
    });

    it('clamps a stored number past the range instead of decoding a BigInt', () => {
        expect(clampStoredNumber('18014398509481982')).toBe(MAX_STORED_NUMBER);
        expect(clampStoredNumber('-18014398509481982')).toBe(MIN_STORED_NUMBER);
        expect(clampStoredNumber('1e400')).toBe(MAX_STORED_NUMBER);
    });
});
