/**
 * Minimal assertions for the shared puter.js suites. Suites run inside
 * browsers and workerd where no test framework exists, so they can't use
 * vitest's `expect` — this is the lowest common denominator.
 */
export class AssertionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AssertionError';
    }
}

export const show = (value: unknown): string => {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
};

// Sort object keys recursively so deepEqual doesn't depend on key order.
const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([k, v]) => [k, canonical(v)]),
        );
    }
    return value;
};

export const assert = {
    ok(value: unknown, message?: string): void {
        if (!value) {
            throw new AssertionError(
                message ?? `expected truthy value, got ${show(value)}`,
            );
        }
    },

    equal(actual: unknown, expected: unknown, message?: string): void {
        if (actual !== expected) {
            throw new AssertionError(
                message ??
                    `expected ${show(expected)}, got ${show(actual)}`,
            );
        }
    },

    deepEqual(actual: unknown, expected: unknown, message?: string): void {
        if (show(canonical(actual)) !== show(canonical(expected))) {
            throw new AssertionError(
                message ??
                    `expected ${show(expected)}, got ${show(actual)}`,
            );
        }
    },

    async rejects(
        fn: () => Promise<unknown>,
        message?: string,
    ): Promise<unknown> {
        try {
            await fn();
        } catch (e) {
            return e;
        }
        throw new AssertionError(message ?? 'expected promise to reject');
    },
};

export type Assert = typeof assert;
