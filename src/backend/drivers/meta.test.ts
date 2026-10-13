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

import { describe, expect, it } from 'vitest';
import {
    resolveDriverMeta,
    resolveDriverMethodConcurrent,
    resolveDriverMethodRateLimit,
    resolvePerMethod,
    validatePerMethod,
    type DriverConcurrentConfig,
    type DriverRateLimitConfig,
    type DriverRequireReputationConfig,
    type DriverRequireSubscriptionConfig,
} from './meta.js';

// ── validatePerMethod: rateLimit ─────────────────────────────────────────

describe('validatePerMethod: rateLimit', () => {
    it('returns an empty config for null/undefined input', () => {
        expect(validatePerMethod(undefined, 't', 'rateLimit')).toEqual({});
        expect(validatePerMethod(null, 't', 'rateLimit')).toEqual({});
    });

    it('accepts a well-formed default + methods block', () => {
        const cfg: DriverRateLimitConfig = {
            default: { limit: 600, window: 60_000 },
            methods: {
                get: { limit: 1000, window: 60_000, backend: 'kv' },
                set: { limit: 100, window: 60_000, backend: 'redis' },
            },
        };
        expect(validatePerMethod(cfg, 't', 'rateLimit')).toBe(cfg);
    });

    it('rejects a non-object config', () => {
        expect(() => validatePerMethod(42, 't', 'rateLimit')).toThrow(
            /rateLimit must be an object/,
        );
        expect(() => validatePerMethod([], 't', 'rateLimit')).toThrow(
            /rateLimit must be an object/,
        );
    });

    it('rejects non-positive / non-numeric limit and window', () => {
        expect(() =>
            validatePerMethod(
                { default: { limit: 0, window: 1 } },
                't',
                'rateLimit',
            ),
        ).toThrow(/limit: expected a positive number/);
        expect(() =>
            validatePerMethod(
                { default: { limit: 1, window: -10 } },
                't',
                'rateLimit',
            ),
        ).toThrow(/window: expected a positive number/);
        expect(() =>
            validatePerMethod(
                { default: { limit: 'x', window: 60_000 } },
                't',
                'rateLimit',
            ),
        ).toThrow(/limit: expected a positive number/);
    });

    it('rejects unknown backend names', () => {
        expect(() =>
            validatePerMethod(
                {
                    default: {
                        limit: 1,
                        window: 1_000,
                        backend: 'sqlite',
                    },
                },
                't',
                'rateLimit',
            ),
        ).toThrow(/backend: expected one of/);
    });

    it('walks the methods map and labels the failing entry', () => {
        expect(() =>
            validatePerMethod(
                {
                    methods: {
                        goodOne: { limit: 5, window: 60_000 },
                        badOne: { limit: 1 },
                    },
                },
                'drv',
                'rateLimit',
            ),
        ).toThrow(/drv\.rateLimit\.methods\.badOne\.window/);
    });

    it('rejects a non-object methods bag', () => {
        expect(() =>
            validatePerMethod({ methods: [] as unknown }, 't', 'rateLimit'),
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
        expect(validatePerMethod(cfg, 't', 'rateLimit')).toBe(cfg);
    });

    it('rejects malformed bySubscription entries on a rate-limit spec', () => {
        // Symmetry with the concurrent validator — bad numbers fail loud.
        expect(() =>
            validatePerMethod(
                {
                    default: {
                        limit: 1,
                        window: 1_000,
                        bySubscription: { user_free: -3 },
                    },
                },
                'drv',
                'rateLimit',
            ),
        ).toThrow(/drv\.rateLimit\.default\.bySubscription\.user_free/);
    });
});

// ── resolvePerMethod: rateLimit ────────────────────────────────────

describe('resolvePerMethod: rateLimit', () => {
    const cfg: DriverRateLimitConfig = {
        default: { limit: 100, window: 60_000 },
        methods: {
            get: { limit: 1000, window: 60_000, backend: 'memory' },
        },
    };

    it('returns the per-method spec when one is declared', () => {
        expect(resolvePerMethod(cfg, 'get')).toEqual({
            limit: 1000,
            window: 60_000,
            backend: 'memory',
        });
    });

    it('falls back to the default spec when no method override exists', () => {
        expect(resolvePerMethod(cfg, 'set')).toEqual({
            limit: 100,
            window: 60_000,
        });
    });

    it('returns undefined when the driver declared no rate-limit at all', () => {
        expect(resolvePerMethod(undefined, 'get')).toBeUndefined();
    });

    it('returns undefined when neither default nor a matching method is declared', () => {
        expect(
            resolvePerMethod(
                { methods: { other: { limit: 1, window: 1 } } },
                'get',
            ),
        ).toBeUndefined();
    });
});

// ── resolveDriverMeta: rateLimit ────────────────────────────────────

describe('resolveDriverMeta — rateLimit', () => {
    it('reads the `rateLimit` field', () => {
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

    it('validates the `rateLimit` field on first read (loud failure)', () => {
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

// ── validatePerMethod: concurrent ────────────────────────────────────────

describe('validatePerMethod: concurrent', () => {
    it('returns an empty config for null/undefined input', () => {
        expect(validatePerMethod(undefined, 't', 'concurrent')).toEqual({});
        expect(validatePerMethod(null, 't', 'concurrent')).toEqual({});
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
        expect(validatePerMethod(cfg, 't', 'concurrent')).toBe(cfg);
    });

    it('rejects non-positive / non-numeric limit', () => {
        expect(() =>
            validatePerMethod({ default: { limit: 0 } }, 't', 'concurrent'),
        ).toThrow(/limit: expected a positive number/);
        expect(() =>
            validatePerMethod({ default: { limit: 'x' } }, 't', 'concurrent'),
        ).toThrow(/limit: expected a positive number/);
    });

    it('rejects unknown backend names', () => {
        expect(() =>
            validatePerMethod(
                { default: { limit: 1, backend: 'sqlite' } },
                't',
                'concurrent',
            ),
        ).toThrow(/backend: expected one of/);
    });

    it('rejects malformed bySubscription entries with a labelled path', () => {
        expect(() =>
            validatePerMethod(
                {
                    default: {
                        limit: 5,
                        bySubscription: { user_free: -1 },
                    },
                },
                'drv',
                'concurrent',
            ),
        ).toThrow(/drv\.concurrent\.default\.bySubscription\.user_free/);
    });

    it('walks the methods map and labels the failing entry', () => {
        expect(() =>
            validatePerMethod(
                {
                    methods: {
                        goodOne: { limit: 5 },
                        badOne: { limit: 1, backend: 'sqlite' },
                    },
                },
                'drv',
                'concurrent',
            ),
        ).toThrow(/drv\.concurrent\.methods\.badOne\.backend/);
    });
});

// ── resolvePerMethod: concurrent ───────────────────────────────────

describe('resolvePerMethod: concurrent', () => {
    const cfg: DriverConcurrentConfig = {
        default: { limit: 3 },
        methods: {
            heavy: { limit: 1, backend: 'redis' },
        },
    };

    it('returns the per-method spec when one is declared', () => {
        expect(resolvePerMethod(cfg, 'heavy')).toEqual({
            limit: 1,
            backend: 'redis',
        });
    });

    it('falls back to default for methods not in the map', () => {
        expect(resolvePerMethod(cfg, 'light')).toEqual({
            limit: 3,
        });
    });

    it('returns undefined when nothing is declared', () => {
        expect(resolvePerMethod(undefined, 'anything')).toBeUndefined();
        expect(resolvePerMethod({}, 'anything')).toBeUndefined();
    });
});

// ── resolveDriverMeta: concurrent ───────────────────────────────────

describe('resolveDriverMeta — concurrent', () => {
    it('reads the `concurrent` field', () => {
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

// ── requireSubscription ─────────────────────────────────────────────

describe('validatePerMethod: requireSubscription', () => {
    it('returns an empty config for null/undefined input', () => {
        expect(
            validatePerMethod(undefined, 't', 'requireSubscription'),
        ).toEqual({});
        expect(validatePerMethod(null, 't', 'requireSubscription')).toEqual({});
    });

    it('accepts booleans and id allowlists', () => {
        const cfg: DriverRequireSubscriptionConfig = {
            default: false,
            methods: { generate: true, generateLong: ['business', 'pro'] },
        };
        expect(validatePerMethod(cfg, 't', 'requireSubscription')).toBe(cfg);
    });

    it('rejects a non-object config', () => {
        expect(() => validatePerMethod(42, 't', 'requireSubscription')).toThrow(
            /requireSubscription must be an object/,
        );
        expect(() => validatePerMethod([], 't', 'requireSubscription')).toThrow(
            /requireSubscription must be an object/,
        );
    });

    it('rejects requirements that name nothing', () => {
        expect(() =>
            validatePerMethod({ default: [] }, 't', 'requireSubscription'),
        ).toThrow(/at least one subscription id/);
        expect(() =>
            validatePerMethod(
                { methods: { a: [1] } },
                't',
                'requireSubscription',
            ),
        ).toThrow(/must be strings/);
        expect(() =>
            validatePerMethod(
                { methods: { a: 'pro' } },
                't',
                'requireSubscription',
            ),
        ).toThrow(/expected true\/false or an array of ids/);
    });
});

describe('resolvePerMethod: requireSubscription', () => {
    const cfg: DriverRequireSubscriptionConfig = {
        default: true,
        methods: { list: false, generateLong: ['pro'] },
    };

    it('prefers a per-method entry over the default', () => {
        expect(resolvePerMethod(cfg, 'list')).toBe(false);
        expect(resolvePerMethod(cfg, 'generateLong')).toEqual(['pro']);
    });

    it('falls back to the default, and to undefined with no config', () => {
        expect(resolvePerMethod(cfg, 'generate')).toBe(true);
        expect(resolvePerMethod(undefined, 'generate')).toBeUndefined();
        expect(resolvePerMethod({}, 'generate')).toBe(undefined);
    });
});

describe('resolveDriverMeta — requireSubscription', () => {
    it('validates an imperatively declared block', () => {
        const driver = {
            driverInterface: 'test-iface',
            driverName: 'imperative',
            requireSubscription: { default: ['pro'] },
        };
        expect(resolveDriverMeta(driver as never)).toMatchObject({
            requireSubscription: { default: ['pro'] },
        });

        const bad = { ...driver, requireSubscription: { default: 'pro' } };
        expect(() => resolveDriverMeta(bad as never)).toThrow(
            /expected true\/false or an array of ids/,
        );
    });

    it('leaves the block absent when a driver declares nothing', () => {
        const driver = {
            driverInterface: 'test-iface',
            driverName: 'plain',
        };
        expect(
            resolveDriverMeta(driver as never)?.requireSubscription,
        ).toBeUndefined();
    });
});

// ── requireReputation ───────────────────────────────────────────────

describe('validatePerMethod: requireReputation', () => {
    it('returns an empty config for null/undefined input', () => {
        expect(validatePerMethod(undefined, 't', 'requireReputation')).toEqual(
            {},
        );
        expect(validatePerMethod(null, 't', 'requireReputation')).toEqual({});
    });

    it('accepts tier names and explicit opt-outs', () => {
        const cfg: DriverRequireReputationConfig = {
            default: false,
            methods: { generate: 'standard' },
        };
        expect(validatePerMethod(cfg, 't', 'requireReputation')).toBe(cfg);
    });

    it('rejects a non-object config', () => {
        expect(() => validatePerMethod(42, 't', 'requireReputation')).toThrow(
            /requireReputation must be an object/,
        );
        expect(() => validatePerMethod([], 't', 'requireReputation')).toThrow(
            /requireReputation must be an object/,
        );
    });

    it('rejects requirements that name no tier', () => {
        expect(() =>
            validatePerMethod({ default: '' }, 't', 'requireReputation'),
        ).toThrow(/non-empty tier name/);
        expect(() =>
            validatePerMethod(
                { methods: { a: true } },
                't',
                'requireReputation',
            ),
        ).toThrow(/expected a tier name, or false/);
        expect(() =>
            validatePerMethod({ methods: { a: 60 } }, 't', 'requireReputation'),
        ).toThrow(/expected a tier name, or false/);
    });
});

describe('resolvePerMethod: requireReputation', () => {
    const cfg: DriverRequireReputationConfig = {
        default: 'standard',
        methods: { list: false, generateLong: 'trusted' },
    };

    it('prefers a per-method entry over the default', () => {
        expect(resolvePerMethod(cfg, 'list')).toBe(false);
        expect(resolvePerMethod(cfg, 'generateLong')).toBe('trusted');
    });

    it('falls back to the default, and to undefined with no config', () => {
        expect(resolvePerMethod(cfg, 'generate')).toBe('standard');
        expect(resolvePerMethod(undefined, 'generate')).toBeUndefined();
        expect(resolvePerMethod({}, 'generate')).toBeUndefined();
    });
});

describe('resolveDriverMeta — requireReputation', () => {
    it('validates an imperatively declared block', () => {
        const driver = {
            driverInterface: 'test-iface',
            driverName: 'imperative',
            requireReputation: { default: 'standard' },
        };
        expect(resolveDriverMeta(driver as never)).toMatchObject({
            requireReputation: { default: 'standard' },
        });

        const bad = { ...driver, requireReputation: { default: 60 } };
        expect(() => resolveDriverMeta(bad as never)).toThrow(
            /expected a tier name, or false/,
        );
    });

    it('leaves the block absent when a driver declares nothing', () => {
        const driver = {
            driverInterface: 'test-iface',
            driverName: 'plain',
        };
        expect(
            resolveDriverMeta(driver as never)?.requireReputation,
        ).toBeUndefined();
    });
});

describe('deprecated per-method resolver names', () => {
    it('still resolve, for extensions that import them', () => {
        const cfg = {
            default: { limit: 1, window: 1_000 },
            methods: { send: { limit: 2, window: 1_000 } },
        };
        expect(resolveDriverMethodRateLimit(cfg, 'send')).toBe(
            cfg.methods.send,
        );
        expect(
            resolveDriverMethodConcurrent({ default: { limit: 3 } }, 'x'),
        ).toEqual({ limit: 3 });
    });
});
