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

import type { Readable } from 'node:stream';
import type { WithLifecycle } from '../types';

// ── Stream result convention ────────────────────────────────────────
//
// Driver methods that return a stream instead of JSON wrap the readable
// in this shape. The `/drivers/call` handler detects it and pipes to the
// HTTP response instead of calling `res.json()`.

export interface DriverStreamResult {
    /** Discriminant — must be `'stream'`. */
    dataType: 'stream';
    /** MIME type sent as Content-Type (e.g. `'application/x-ndjson'`). */
    content_type: string;
    /** When true, sets `Transfer-Encoding: chunked`. */
    chunked?: boolean;
    /** The readable stream to pipe to the response. */
    stream: Readable;
}

export function isDriverStreamResult(v: unknown): v is DriverStreamResult {
    return (
        !!v &&
        typeof v === 'object' &&
        (v as Record<string, unknown>).dataType === 'stream' &&
        'stream' in v
    );
}

// ── Driver metadata keys ────────────────────────────────────────────
//
// Metadata keys stored on driver prototypes by the `@Driver` decorator.
// Imperative drivers set these as instance properties instead.

export const DRIVER_INTERFACE_KEY = '__driverInterface' as const;
export const DRIVER_NAME_KEY = '__driverName' as const;
export const DRIVER_DEFAULT_KEY = '__driverDefault' as const;
export const DRIVER_ALIASES_KEY = '__driverAliases' as const;
export const DRIVER_RATE_LIMIT_KEY = '__driverRateLimit' as const;
export const DRIVER_CONCURRENT_KEY = '__driverConcurrent' as const;

// ── Driver rate-limit config ────────────────────────────────────────
//
// A driver declares its rate-limit policy alongside its other metadata
// (`@Driver({ rateLimit: ... })` or an imperative `readonly rateLimit`
// field). `DriverController.#handleCall` resolves the spec for the
// requested method via `resolveDriverMethodRateLimit` and passes it to
// `checkDriverRateLimit`. Different driver methods can therefore use
// different storage backends and different limits — there's no longer a
// single boot-time backend that constrains everyone.

export const RATE_LIMIT_BACKEND_NAMES = ['memory', 'redis', 'kv'] as const;
export type RateLimitBackend = (typeof RATE_LIMIT_BACKEND_NAMES)[number];

export interface DriverRateLimitSpec {
    /** Maximum hits per window. */
    limit: number;
    /** Window length, in milliseconds. */
    window: number;
    /**
     * Per-subscription overrides for `limit`. Keyed by
     * `SubscriptionPolicy.id` (`user_free`, `temp_free`, `unlimited`,
     * etc.). Falls back to `limit` when the actor's subscription isn't
     * in the map. Same mechanic as `DriverConcurrentSpec.bySubscription`.
     */
    bySubscription?: Record<string, number>;
    /**
     * Storage backend to count against. Omit to use the server-wide
     * default configured by `config.rate_limit.backend`.
     */
    backend?: RateLimitBackend;
}

export interface DriverRateLimitConfig {
    /**
     * Applied to any method not listed in `methods`. Lets a driver opt
     * the whole interface into tighter limits than the global driver
     * default without enumerating every method.
     */
    default?: DriverRateLimitSpec;
    /** Per-method overrides. Keys are driver method names. */
    methods?: Record<string, DriverRateLimitSpec>;
}

/**
 * Validate a `rateLimit` block declared by a driver. Throws on bad
 * shape so registration fails loudly at boot rather than silently
 * misconfiguring production traffic. Returns the value unchanged on
 * success for chaining.
 */
export function validateDriverRateLimit(
    value: unknown,
    label: string,
): DriverRateLimitConfig {
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label}: rateLimit must be an object`);
    }
    const cfg = value as Record<string, unknown>;
    if (cfg.default !== undefined) {
        validateSpec(cfg.default, `${label}.rateLimit.default`);
    }
    if (cfg.methods !== undefined) {
        if (
            typeof cfg.methods !== 'object' ||
            cfg.methods === null ||
            Array.isArray(cfg.methods)
        ) {
            throw new Error(`${label}.rateLimit.methods must be an object`);
        }
        for (const [name, spec] of Object.entries(cfg.methods)) {
            validateSpec(spec, `${label}.rateLimit.methods.${name}`);
        }
    }
    return cfg as DriverRateLimitConfig;
}

function validateSpec(value: unknown, label: string): void {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label}: expected an object`);
    }
    const spec = value as Record<string, unknown>;
    if (
        typeof spec.limit !== 'number' ||
        !Number.isFinite(spec.limit) ||
        spec.limit <= 0
    ) {
        throw new Error(`${label}.limit: expected a positive number`);
    }
    if (
        typeof spec.window !== 'number' ||
        !Number.isFinite(spec.window) ||
        spec.window <= 0
    ) {
        throw new Error(`${label}.window: expected a positive number (ms)`);
    }
    if (spec.backend !== undefined) {
        if (
            typeof spec.backend !== 'string' ||
            !RATE_LIMIT_BACKEND_NAMES.includes(spec.backend as RateLimitBackend)
        ) {
            throw new Error(
                `${label}.backend: expected one of ${RATE_LIMIT_BACKEND_NAMES.join(', ')}`,
            );
        }
    }
    if (spec.bySubscription !== undefined) {
        validateBySubscription(spec.bySubscription, label);
    }
}

function validateBySubscription(value: unknown, label: string): void {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label}.bySubscription: expected an object`);
    }
    for (const [id, n] of Object.entries(value as Record<string, unknown>)) {
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
            throw new Error(
                `${label}.bySubscription.${id}: expected a positive number`,
            );
        }
    }
}

/**
 * Resolve the spec that applies to a given method on a driver. Per-method
 * entry wins over `default`; returns `undefined` if neither is set so the
 * caller can apply its own fallback.
 */
export function resolveDriverMethodRateLimit(
    cfg: DriverRateLimitConfig | undefined,
    method: string,
): DriverRateLimitSpec | undefined {
    if (!cfg) return undefined;
    return cfg.methods?.[method] ?? cfg.default;
}

// ── Driver concurrent-limit config ──────────────────────────────────
//
// Twin to `DriverRateLimitConfig` but for in-flight concurrency. Same
// shape minus `window`, plus `bySubscription` to vary the cap by the
// caller's subscription tier (resolved via `MeteringService`).

export interface DriverConcurrentSpec {
    /** Maximum simultaneous in-flight requests. */
    limit: number;
    /**
     * Per-subscription overrides keyed by `SubscriptionPolicy.id`
     * (`user_free`, `temp_free`, `unlimited`, etc.). Falls back to
     * `limit` when the actor's subscription isn't in the map.
     */
    bySubscription?: Record<string, number>;
    /**
     * Storage backend. Memory is per-process (use only on single-node
     * deployments); redis coordinates across nodes; kv is rarely the
     * right choice for concurrency but supported for parity.
     */
    backend?: RateLimitBackend;
}

export interface DriverConcurrentConfig {
    /** Applied to any method not listed in `methods`. */
    default?: DriverConcurrentSpec;
    /** Per-method overrides. Keys are driver method names. */
    methods?: Record<string, DriverConcurrentSpec>;
}

/**
 * Validate a `concurrent` block. Mirrors `validateDriverRateLimit` —
 * throws with a labelled path so a malformed entry surfaces at boot.
 */
export function validateDriverConcurrent(
    value: unknown,
    label: string,
): DriverConcurrentConfig {
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label}: concurrent must be an object`);
    }
    const cfg = value as Record<string, unknown>;
    if (cfg.default !== undefined) {
        validateConcurrentSpec(cfg.default, `${label}.concurrent.default`);
    }
    if (cfg.methods !== undefined) {
        if (
            typeof cfg.methods !== 'object' ||
            cfg.methods === null ||
            Array.isArray(cfg.methods)
        ) {
            throw new Error(`${label}.concurrent.methods must be an object`);
        }
        for (const [name, spec] of Object.entries(cfg.methods)) {
            validateConcurrentSpec(spec, `${label}.concurrent.methods.${name}`);
        }
    }
    return cfg as DriverConcurrentConfig;
}

function validateConcurrentSpec(value: unknown, label: string): void {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label}: expected an object`);
    }
    const spec = value as Record<string, unknown>;
    if (
        typeof spec.limit !== 'number' ||
        !Number.isFinite(spec.limit) ||
        spec.limit <= 0
    ) {
        throw new Error(`${label}.limit: expected a positive number`);
    }
    if (spec.backend !== undefined) {
        if (
            typeof spec.backend !== 'string' ||
            !RATE_LIMIT_BACKEND_NAMES.includes(spec.backend as RateLimitBackend)
        ) {
            throw new Error(
                `${label}.backend: expected one of ${RATE_LIMIT_BACKEND_NAMES.join(', ')}`,
            );
        }
    }
    if (spec.bySubscription !== undefined) {
        validateBySubscription(spec.bySubscription, label);
    }
}

/**
 * Resolve the concurrent spec for a given method on a driver. Same
 * precedence as `resolveDriverMethodRateLimit`: per-method wins over
 * `default`; `undefined` means no concurrency cap is declared, and the
 * caller should leave the method unbounded.
 */
export function resolveDriverMethodConcurrent(
    cfg: DriverConcurrentConfig | undefined,
    method: string,
): DriverConcurrentSpec | undefined {
    if (!cfg) return undefined;
    return cfg.methods?.[method] ?? cfg.default;
}

/**
 * Resolved metadata for a registered driver. Read from either decorator
 * metadata or imperative instance properties.
 */
export interface DriverMeta {
    /** The interface this driver implements (e.g. 'puter-chat-completion'). */
    interfaceName: string;
    /** Unique name within its interface (e.g. 'openai-completion', 'claude'). */
    driverName: string;
    /** When true, this driver is the default for its interface. */
    isDefault: boolean;
    /**
     * Additional driver names that resolve to the same instance. Used by
     * multi-provider drivers (TTS/OCR/image/video) so legacy puter-js calls
     * that pass a provider id in the `driver` slot (e.g. `aws-polly`,
     * `openai-tts`) still find the unified driver. The requested alias is
     * exposed to the driver method via `Context.get('driverName')` so the
     * method can route to the right internal provider.
     */
    aliases: string[];
    /**
     * Rate-limit policy for this driver. Per-method specs override the
     * `default` spec; both are optional. `DriverController` consults this
     * before invoking the method and falls back to the global driver
     * default (600/min) if nothing is declared.
     */
    rateLimit?: DriverRateLimitConfig;
    /**
     * Concurrent in-flight policy for this driver. When set, the
     * controller acquires a slot before invoking the method and releases
     * in `finally`. Absent → no concurrency cap (current behaviour).
     */
    concurrent?: DriverConcurrentConfig;
}

/**
 * Extract driver metadata from a driver instance. Checks decorator-set
 * prototype metadata first, then falls back to instance properties.
 * Returns `null` if the driver doesn't declare an interface.
 */
export function resolveDriverMeta(
    driver: WithLifecycle & Record<string, unknown>,
): DriverMeta | null {
    const proto = Object.getPrototypeOf(driver) as Record<string, unknown>;

    const interfaceName =
        (proto[DRIVER_INTERFACE_KEY] as string | undefined) ??
        (driver.driverInterface as string | undefined);
    const driverName =
        (proto[DRIVER_NAME_KEY] as string | undefined) ??
        (driver.driverName as string | undefined);
    const isDefault =
        (proto[DRIVER_DEFAULT_KEY] as boolean | undefined) ??
        (driver.isDefault as boolean | undefined) ??
        false;
    const aliases =
        (proto[DRIVER_ALIASES_KEY] as string[] | undefined) ??
        (driver.driverAliases as string[] | undefined) ??
        [];
    // Decorator stashes a validated config on the prototype; imperative
    // drivers declare a raw object on the instance, which we validate here
    // so a malformed `rateLimit` field still fails loud at registration.
    const protoRateLimit = proto[DRIVER_RATE_LIMIT_KEY] as
        | DriverRateLimitConfig
        | undefined;
    let rateLimit: DriverRateLimitConfig | undefined;
    if (protoRateLimit) {
        rateLimit = protoRateLimit;
    } else if (driver.rateLimit !== undefined) {
        rateLimit = validateDriverRateLimit(
            driver.rateLimit,
            `driver '${driverName ?? '(unnamed)'}'`,
        );
    }

    const protoConcurrent = proto[DRIVER_CONCURRENT_KEY] as
        | DriverConcurrentConfig
        | undefined;
    let concurrent: DriverConcurrentConfig | undefined;
    if (protoConcurrent) {
        concurrent = protoConcurrent;
    } else if (driver.concurrent !== undefined) {
        concurrent = validateDriverConcurrent(
            driver.concurrent,
            `driver '${driverName ?? '(unnamed)'}'`,
        );
    }

    if (!interfaceName || !driverName) return null;

    return {
        interfaceName,
        driverName,
        isDefault,
        aliases,
        rateLimit,
        concurrent,
    };
}
