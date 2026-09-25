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

/**
 * A stored number keeps its exact value only within the IEEE-754 safe integer
 * range; a magnitude past this cannot round-trip, and the document client
 * refuses to marshall one rather than write a value that reads back wrong.
 */
export const MAX_STORED_NUMBER = Number.MAX_SAFE_INTEGER;
export const MIN_STORED_NUMBER = Number.MIN_SAFE_INTEGER;

/**
 * Marshalling failures a retry can fix by clamping: an out-of-range number, or
 * a special numeric value (`NaN`, `±Infinity`) that has no representation at
 * all. Matched on the message because they are plain `Error`s thrown while
 * encoding the payload — no error name or code separates them from anything
 * else, and they never reach the wire, so there is no response to inspect.
 */
const REPAIRABLE_MARSHALL_ERRORS = [
    /is greater than Number\.MAX_SAFE_INTEGER/,
    /is lesser than Number\.MIN_SAFE_INTEGER/,
    /^Special numeric value /,
];

export const isRepairableMarshallError = (error: unknown): boolean => {
    const message = (error as Error | undefined)?.message;
    if (typeof message !== 'string') return false;
    return REPAIRABLE_MARSHALL_ERRORS.some((pattern) => pattern.test(message));
};

/**
 * The same bound, applied to what comes back. A stored number past the safe
 * range — left by an older write, or reached by a counter incremented up to it
 * — is otherwise decoded as a `BigInt`, which no JSON response can carry. This
 * hands back the same kind of value a write accepts, and does less work per
 * number than the default decoding it replaces.
 */
export const clampStoredNumber = (stored: string): number => {
    const num = Number(stored);
    if (num > MAX_STORED_NUMBER) return MAX_STORED_NUMBER;
    if (num < MIN_STORED_NUMBER) return MIN_STORED_NUMBER;
    return num;
};

export interface MarshallRepair {
    value: unknown;
    /** False when nothing in the payload was out of range — nothing to retry. */
    changed: boolean;
}

const unchanged = (value: unknown): MarshallRepair => ({
    value,
    changed: false,
});

// Matches the shapes the marshaller walks into as a map: object literals and
// null-prototype objects, but not class instances (Date, Buffer, Set, …),
// which it encodes by their own rules.
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' &&
    value !== null &&
    (value.constructor === Object || value.constructor === undefined);

const repairNumber = (num: number): MarshallRepair => {
    // No representation for these; JSON already turns them into null, so a
    // caller that got one this far did not send it as JSON.
    if (Number.isNaN(num)) return { value: null, changed: true };
    if (num > MAX_STORED_NUMBER)
        return { value: MAX_STORED_NUMBER, changed: true };
    if (num < MIN_STORED_NUMBER)
        return { value: MIN_STORED_NUMBER, changed: true };
    return unchanged(num);
};

/**
 * Clamp every number a payload holds into the range the store accepts,
 * returning the original object untouched when nothing needed it — callers hold
 * on to the values they pass (caches, retries), so a repair copies rather than
 * mutating in place.
 *
 * Only run after a marshalling failure. Walking a payload this way costs as
 * much as marshalling it, which is exactly why writes are not checked up
 * front.
 */
export const repairForMarshall = (value: unknown): MarshallRepair => {
    if (typeof value === 'number') return repairNumber(value);

    if (Array.isArray(value)) {
        let changed = false;
        const repairedEntries = value.map((entry) => {
            const repaired = repairForMarshall(entry);
            changed = changed || repaired.changed;
            return repaired.value;
        });
        return changed ? { value: repairedEntries, changed } : unchanged(value);
    }

    if (isPlainObject(value)) {
        let changed = false;
        const repairedEntries = Object.entries(value).map(([key, entry]) => {
            const repaired = repairForMarshall(entry);
            changed = changed || repaired.changed;
            return [key, repaired.value] as const;
        });
        // `fromEntries` defines each property rather than assigning it, so a
        // `__proto__` key in the payload stays data here.
        return changed
            ? { value: Object.fromEntries(repairedEntries), changed }
            : unchanged(value);
    }

    return unchanged(value);
};
