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
import { Driver } from './decorators.js';
import {
    resolveDriverMeta,
    resolveDriverMethodConcurrent,
    resolveDriverMethodRateLimit,
    validateDriverConcurrent,
    validateDriverRateLimit,
    type DriverConcurrentConfig,
    type DriverRateLimitConfig,
} from './meta.js';

// ── validateDriverRateLimit ─────────────────────────────────────────

describe('validateDriverRateLimit', () => {
    it('returns an empty config for null/undefined input', () => {
        expect(validateDriverRateLimit(undefined, 't')).toEqual({});
        expect(validateDriverRateLimit(null, 't')).toEqual({});
    });

    it('accepts a well-formed default + methods block', () => {
        const cfg: DriverRateLimitConfig = {
            default: { limit: 600, window: 60_000 },
            methods: {
                get: { limit: 1000, window: 60_000, backend: 'kv' },
                set: { limit: 100, window: 60_000, backend: 'redis' },
            },
        };
        expect(validateDriverRateLimit(cfg, 't')).toBe(cfg);
    });

    it('rejects a non-object config', () => {
        expect(() => validateDriverRateLimit(42, 't')).toThrow(
            /rateLimit must be an object/,
        );
        expect(() => validateDriverRateLimit([], 't')).toThrow(
            /rateLimit must be an object/,
        );
    });

    it('rejects non-positive / non-numeric limit and window', () => {
        expect(() =>
            validateDriverRateLimit({ default: { limit: 0, window: 1 } }, 't'),
        ).toThrow(/limit: expected a positive number/);
        expect(() =>
            validateDriverRateLimit(
                { default: { limit: 1, window: -10 } },
                't',
            ),
        ).toThrow(/window: expected a positive number/);
        expect(() =>
            validateDriverRateLimit(
                { default: { limit: 'x', window: 60_000 } },
                't',
            ),
        ).toThrow(/limit: expected a positive number/);
    });

    it('rejects unknown backend names', () => {
        expect(() =>
            validateDriverRateLimit(
                {
                    default: {
                        limit: 1,
                        window: 1_000,
                        backend: 'sqlite',
                    },
                },
                't',
            ),
        ).toThrow(/backend: expected one of/);
    });

    it('walks the methods map and labels the failing entry', () => {
        expect(() =>
            validateDriverRateLimit(
                {
                    methods: {
                        goodOne: { limit: 5, window: 60_000 },
                        badOne: { limit: 1 },
                    },
                },
                'drv',
            ),
        ).toThrow(/drv\.rateLimit\.methods\.badOne\.window/);
    });

    it('rejects a non-object methods bag', () => {
        expect(() =>
            validateDriverRateLimit({ methods: [] as unknown }, 't'),
        ).toThrow(/methods must be an object/);
    });

    it('accepts bySubscription on a rate-limit spec', () => {
        const cfg: DriverRateLimitConfig = {
            methods: {
                chat: {
                    limit: 10,
                    window: 60_000,
                    bySubscription: { user_free: 2, unlimited: 1000 },
                },
            },
        };
        expect(validateDriverRateLimit(cfg, 't')).toBe(cfg);
    });

    it('rejects malformed bySubscription entries on a rate-limit spec', () => {
        // Symmetry with the concurrent validator — bad numbers fail loud.
        expect(() =>
            validateDriverRateLimit(
                {
                    default: {
                        limit: 1,
                        window: 1_000,
                        bySubscription: { user_free: -3 },
                    },
                },
                'drv',
            ),
        ).toThrow(/drv\.rateLimit\.default\.bySubscription\.user_free/);
    });
});

// ── resolveDriverMethodRateLimit ────────────────────────────────────

describe('resolveDriverMethodRateLimit', () => {
    const cfg: DriverRateLimitConfig = {
        default: { limit: 100, window: 60_000 },
        methods: {
            get: { limit: 1000, window: 60_000, backend: 'memory' },
        },
    };

    it('returns the per-method spec when one is declared', () => {
        expect(resolveDriverMethodRateLimit(cfg, 'get')).toEqual({
            limit: 1000,
            window: 60_000,
            backend: 'memory',
        });
    });

    it('falls back to the default spec when no method override exists', () => {
        expect(resolveDriverMethodRateLimit(cfg, 'set')).toEqual({
            limit: 100,
            window: 60_000,
        });
    });

    it('returns undefined when the driver declared no rate-limit at all', () => {
        expect(resolveDriverMethodRateLimit(undefined, 'get')).toBeUndefined();
    });

    it('returns undefined when neither default nor a matching method is declared', () => {
        expect(
            resolveDriverMethodRateLimit(
                { methods: { other: { limit: 1, window: 1 } } },
                'get',
            ),
        ).toBeUndefined();
    });
});

// ── @Driver decorator: rateLimit propagation ────────────────────────

describe('@Driver — rateLimit option', () => {
    it('stamps a validated rateLimit block onto the prototype, surfacing via resolveDriverMeta', () => {
        @Driver('test-iface', {
            name: 'test-impl',
            rateLimit: {
                default: { limit: 50, window: 60_000 },
                methods: {
                    chat: { limit: 10, window: 60_000, backend: 'redis' },
                },
            },
        })
        class FakeDriver {}

        const inst = new FakeDriver();
        const meta = resolveDriverMeta(
            inst as unknown as Record<string, unknown> & {
                onServerStart?: () => void;
                onServerPrepareShutdown?: () => void;
                onServerShutdown?: () => void;
            },
        );
        expect(meta).not.toBeNull();
        expect(meta?.rateLimit).toEqual({
            default: { limit: 50, window: 60_000 },
            methods: {
                chat: { limit: 10, window: 60_000, backend: 'redis' },
            },
        });
    });

    it('throws at decoration time on a malformed rateLimit block', () => {
        // The whole point of eager validation: bad config takes the
        // module down at boot, not at the first request.
        expect(() => {
            @Driver('test-iface', {
                name: 'broken',
                rateLimit: { default: { limit: -1, window: 1_000 } },
            })
            class BrokenDriver {}
            void BrokenDriver;
        }).toThrow(/limit: expected a positive number/);
    });

    it('falls back to imperative `rateLimit` field when no decorator metadata is set', () => {
        // Imperative drivers (no decorator) declare the field directly.
        class Imperative {
            readonly driverInterface = 'imp-iface';
            readonly driverName = 'imp';
            readonly rateLimit = {
                methods: { foo: { limit: 7, window: 1_000 } },
            };
        }
        const inst = new Imperative();
        const meta = resolveDriverMeta(
            inst as unknown as Record<string, unknown> & {
                onServerStart?: () => void;
                onServerPrepareShutdown?: () => void;
                onServerShutdown?: () => void;
            },
        );
        expect(meta?.rateLimit?.methods?.foo).toEqual({
            limit: 7,
            window: 1_000,
        });
    });

    it('validates the imperative `rateLimit` field on first read (loud failure)', () => {
        class BadImperative {
            readonly driverInterface = 'imp-iface';
            readonly driverName = 'imp-bad';
            // Invalid: backend not one of memory/redis/kv.
            readonly rateLimit = {
                default: { limit: 1, window: 1_000, backend: 'mysql' },
            };
        }
        expect(() =>
            resolveDriverMeta(
                new BadImperative() as unknown as Record<string, unknown> & {
                    onServerStart?: () => void;
                    onServerPrepareShutdown?: () => void;
                    onServerShutdown?: () => void;
                },
            ),
        ).toThrow(/backend: expected one of/);
    });
});

// ── validateDriverConcurrent ────────────────────────────────────────

describe('validateDriverConcurrent', () => {
    it('returns an empty config for null/undefined input', () => {
        expect(validateDriverConcurrent(undefined, 't')).toEqual({});
        expect(validateDriverConcurrent(null, 't')).toEqual({});
    });

    it('accepts a well-formed default + methods block with bySubscription', () => {
        const cfg: DriverConcurrentConfig = {
            default: { limit: 5 },
            methods: {
                heavy: {
                    limit: 5,
                    bySubscription: { user_free: 1, unlimited: 50 },
                    backend: 'redis',
                },
            },
        };
        expect(validateDriverConcurrent(cfg, 't')).toBe(cfg);
    });

    it('rejects non-positive / non-numeric limit', () => {
        expect(() =>
            validateDriverConcurrent({ default: { limit: 0 } }, 't'),
        ).toThrow(/limit: expected a positive number/);
        expect(() =>
            validateDriverConcurrent({ default: { limit: 'x' } }, 't'),
        ).toThrow(/limit: expected a positive number/);
    });

    it('rejects unknown backend names', () => {
        expect(() =>
            validateDriverConcurrent(
                { default: { limit: 1, backend: 'sqlite' } },
                't',
            ),
        ).toThrow(/backend: expected one of/);
    });

    it('rejects malformed bySubscription entries with a labelled path', () => {
        expect(() =>
            validateDriverConcurrent(
                {
                    default: {
                        limit: 5,
                        bySubscription: { user_free: -1 },
                    },
                },
                'drv',
            ),
        ).toThrow(/drv\.concurrent\.default\.bySubscription\.user_free/);
    });

    it('walks the methods map and labels the failing entry', () => {
        expect(() =>
            validateDriverConcurrent(
                {
                    methods: {
                        goodOne: { limit: 5 },
                        badOne: { limit: 1, backend: 'sqlite' },
                    },
                },
                'drv',
            ),
        ).toThrow(/drv\.concurrent\.methods\.badOne\.backend/);
    });
});

// ── resolveDriverMethodConcurrent ───────────────────────────────────

describe('resolveDriverMethodConcurrent', () => {
    const cfg: DriverConcurrentConfig = {
        default: { limit: 3 },
        methods: {
            heavy: { limit: 1, backend: 'redis' },
        },
    };

    it('returns the per-method spec when one is declared', () => {
        expect(resolveDriverMethodConcurrent(cfg, 'heavy')).toEqual({
            limit: 1,
            backend: 'redis',
        });
    });

    it('falls back to default for methods not in the map', () => {
        expect(resolveDriverMethodConcurrent(cfg, 'light')).toEqual({
            limit: 3,
        });
    });

    it('returns undefined when nothing is declared', () => {
        expect(
            resolveDriverMethodConcurrent(undefined, 'anything'),
        ).toBeUndefined();
        expect(resolveDriverMethodConcurrent({}, 'anything')).toBeUndefined();
    });
});

// ── @Driver — concurrent option ─────────────────────────────────────

describe('@Driver — concurrent option', () => {
    it('stamps a validated concurrent block onto the prototype', () => {
        @Driver('test-iface', {
            name: 'cdec',
            concurrent: {
                default: { limit: 4 },
                methods: {
                    chat: {
                        limit: 5,
                        bySubscription: { user_free: 1 },
                        backend: 'redis',
                    },
                },
            },
        })
        class FakeDriver {}

        const inst = new FakeDriver();
        const meta = resolveDriverMeta(
            inst as unknown as Record<string, unknown> & {
                onServerStart?: () => void;
                onServerPrepareShutdown?: () => void;
                onServerShutdown?: () => void;
            },
        );
        expect(meta?.concurrent).toEqual({
            default: { limit: 4 },
            methods: {
                chat: {
                    limit: 5,
                    bySubscription: { user_free: 1 },
                    backend: 'redis',
                },
            },
        });
    });

    it('throws at decoration time on a malformed concurrent block', () => {
        expect(() => {
            @Driver('test-iface', {
                name: 'bad-concurrent',
                concurrent: { default: { limit: -1 } },
            })
            class BrokenDriver {}
            void BrokenDriver;
        }).toThrow(/limit: expected a positive number/);
    });

    it('falls back to imperative `concurrent` field when decorator metadata is absent', () => {
        class Imperative {
            readonly driverInterface = 'imp-iface';
            readonly driverName = 'imp-c';
            readonly concurrent = {
                methods: { foo: { limit: 2 } },
            };
        }
        const meta = resolveDriverMeta(
            new Imperative() as unknown as Record<string, unknown> & {
                onServerStart?: () => void;
                onServerPrepareShutdown?: () => void;
                onServerShutdown?: () => void;
            },
        );
        expect(meta?.concurrent?.methods?.foo).toEqual({ limit: 2 });
    });
});
