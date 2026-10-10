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

import type { Readable } from 'node:stream';
import {
    validateReputationRequirement,
    type ReputationRequirement,
} from '../core/reputation.js';
import {
    validateSubscriptionRequirement,
    type SubscriptionRequirement,
} from '../services/metering/enforcement.js';
import type { WithLifecycle } from '../types';

// -- Stream result convention ----------------------------------------
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

// -- Per-method driver policies ----------------------------------------
//
// Every policy a driver declares has the same shape: a `default` entry and
// per-method overrides. `DriverController` resolves the entry for the called
// method, so methods can differ in limits, plan and reputation floor.

/** A driver policy: `default` for any method not listed in `methods`. */
export interface PerMethodConfig<T> {
    default?: T;
    /** Keys are driver method names. */
    methods?: Record<string, T>;
}

export const RATE_LIMIT_BACKEND_NAMES = ['memory', 'redis', 'kv'] as const;
export type RateLimitBackend = (typeof RATE_LIMIT_BACKEND_NAMES)[number];

export interface DriverRateLimitSpec {
    /** Maximum hits per window. */
    limit: number;
    /** Window length, in milliseconds. */
    window: number;
    /** Per-`SubscriptionPolicy.id` overrides for `limit`. */
    bySubscription?: Record<string, number>;
    /** Defaults to `config.rate_limit.backend`. */
    backend?: RateLimitBackend;
}

export interface DriverConcurrentSpec {
    /** Maximum simultaneous in-flight requests. */
    limit: number;
    /** Per-`SubscriptionPolicy.id` overrides for `limit`. */
    bySubscription?: Record<string, number>;
    /** `memory` is per-process; use `redis` on multi-node deployments. */
    backend?: RateLimitBackend;
}

export type DriverRateLimitConfig = PerMethodConfig<DriverRateLimitSpec>;
export type DriverConcurrentConfig = PerMethodConfig<DriverConcurrentSpec>;
/**
 * Per-method counterpart of `RouteOptions.requireSubscription`: `/drivers/call`
 * is one shared route, so a route option would apply to every driver at once.
 * `undefined` for a method means it is open to every plan.
 */
export type DriverRequireSubscriptionConfig =
    PerMethodConfig<SubscriptionRequirement>;
/**
 * Per-method counterpart of `RouteOptions.requireReputation`. A tier is only a
 * name; the score it takes is deployment config.
 */
export type DriverRequireReputationConfig =
    PerMethodConfig<ReputationRequirement>;

function validateLimitSpec(
    value: unknown,
    label: string,
    { windowed }: { windowed: boolean },
): void {
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
        windowed &&
        (typeof spec.window !== 'number' ||
            !Number.isFinite(spec.window) ||
            spec.window <= 0)
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

/** The entry validator for each policy a driver may declare. */
const POLICY_ENTRY_VALIDATORS = {
    rateLimit: (value: unknown, label: string) =>
        validateLimitSpec(value, label, { windowed: true }),
    concurrent: (value: unknown, label: string) =>
        validateLimitSpec(value, label, { windowed: false }),
    requireSubscription: validateSubscriptionRequirement,
    requireReputation: validateReputationRequirement,
};

export type DriverPolicyName = keyof typeof POLICY_ENTRY_VALIDATORS;

interface DriverPolicyConfigs {
    rateLimit: DriverRateLimitConfig;
    concurrent: DriverConcurrentConfig;
    requireSubscription: DriverRequireSubscriptionConfig;
    requireReputation: DriverRequireReputationConfig;
}

/**
 * Validate a driver's `policy` block. Throws with a labelled path at
 * registration, so a malformed entry surfaces at boot rather than on the first
 * call.
 */
export function validatePerMethod<K extends DriverPolicyName>(
    value: unknown,
    label: string,
    policy: K,
): DriverPolicyConfigs[K] {
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label}: ${policy} must be an object`);
    }
    const validateEntry = POLICY_ENTRY_VALIDATORS[policy];
    const cfg = value as Record<string, unknown>;
    if (cfg.default !== undefined) {
        validateEntry(cfg.default, `${label}.${policy}.default`);
    }
    if (cfg.methods !== undefined) {
        if (
            typeof cfg.methods !== 'object' ||
            cfg.methods === null ||
            Array.isArray(cfg.methods)
        ) {
            throw new Error(`${label}.${policy}.methods must be an object`);
        }
        for (const [name, entry] of Object.entries(cfg.methods)) {
            validateEntry(entry, `${label}.${policy}.methods.${name}`);
        }
    }
    return cfg as DriverPolicyConfigs[K];
}

/**
 * The entry that applies to `method`: its own, else `default`, else `undefined`
 * (the caller decides what an undeclared policy means).
 */
export function resolvePerMethod<T>(
    cfg: PerMethodConfig<T> | undefined,
    method: string,
): T | undefined {
    if (!cfg) return undefined;
    return cfg.methods?.[method] ?? cfg.default;
}

/** @deprecated Use `resolvePerMethod`; kept for extensions still on it. */
export const resolveDriverMethodRateLimit =
    resolvePerMethod<DriverRateLimitSpec>;
/** @deprecated Use `resolvePerMethod`; kept for extensions still on it. */
export const resolveDriverMethodConcurrent =
    resolvePerMethod<DriverConcurrentSpec>;

/**
 * Resolved metadata for a registered driver, read from its instance properties.
 * The gates live here rather than on a route because every driver shares the
 * `/drivers/call` dispatch route.
 */
export interface DriverMeta {
    /** E.g. 'puter-chat-completion'. */
    interfaceName: string;
    /** Unique within the interface. */
    driverName: string;
    isDefault: boolean;
    /**
     * Other names resolving to this driver, so legacy calls naming a provider
     * (`aws-polly`) still find the unified driver. The requested alias reaches
     * the method via `Context.get('driverName')`.
     */
    aliases: string[];
    /** Falls back to the global driver default when absent. */
    rateLimit?: DriverRateLimitConfig;
    /** No concurrency cap when absent. */
    concurrent?: DriverConcurrentConfig;
    /** Reject bare account-session tokens. */
    noUserSession?: boolean;
    /**
     * Per-method plan requirement; a method covered by neither `default` nor
     * `methods` is open.
     */
    requireSubscription?: DriverRequireSubscriptionConfig;
    /** Per-method reputation tier; same coverage rule as `requireSubscription`. */
    requireReputation?: DriverRequireReputationConfig;
}

/**
 * Extract a driver's metadata, validating its policy blocks so a malformed one
 * fails loud at registration. Returns `null` if the driver doesn't declare an
 * interface and name.
 */
export function resolveDriverMeta(
    driver: WithLifecycle & Record<string, unknown>,
): DriverMeta | null {
    const interfaceName = driver.driverInterface as string | undefined;
    const driverName = driver.driverName as string | undefined;
    if (!interfaceName || !driverName) return null;

    const label = `driver '${driverName}'`;
    const policy = <K extends DriverPolicyName>(name: K) =>
        driver[name] === undefined
            ? undefined
            : validatePerMethod(driver[name], label, name);

    return {
        interfaceName,
        driverName,
        isDefault: (driver.isDefault as boolean | undefined) ?? false,
        aliases: (driver.driverAliases as string[] | undefined) ?? [],
        rateLimit: policy('rateLimit'),
        concurrent: policy('concurrent'),
        noUserSession: (driver.noUserSession as boolean | undefined) ?? false,
        requireSubscription: policy('requireSubscription'),
        requireReputation: policy('requireReputation'),
    };
}

/**
 * Framework/lifecycle method names that must never be reachable via
 * `/drivers/call`. These live on `PuterDriver` (see `drivers/types.ts`) and are
 * the machinery the dispatch surface must exclude. For class-based drivers a
 * concrete `override` of one still carries the same name and is caught here;
 * for plain-object drivers (registered by extensions — see `server.ts`, `typeof
 * DriverClass === 'object'`) there is no base prototype to distinguish them, so
 * this denylist is the _only_ thing keeping a hook off the RPC surface. Any
 * lifecycle hook added to `PuterDriver` must be added here too — the per-driver
 * guard test (`callableMethods.test.ts`) fails loudly if a base method starts
 * leaking into every driver's surface.
 */
export const RESERVED_DRIVER_METHODS: ReadonlySet<string> = new Set([
    'onServerStart',
    'onServerPrepareShutdown',
    'onServerShutdown',
    'getReportedCosts',
]);

/**
 * Compute the set of method names a driver exposes over `/drivers/call`.
 *
 * The RPC surface is defined structurally rather than by a hand-maintained
 * per-method allow-list. Walking from the instance up to (but not including)
 * `Object.prototype`, a name is callable iff it resolves to a function and is
 * neither `constructor` nor a `RESERVED_DRIVER_METHODS` entry. This covers both
 * driver shapes the server accepts (`server.ts`): class instances (RPC methods
 * on the concrete prototype, config on the instance) and plain objects
 * (everything own, used verbatim by extensions). It excludes all
 * `Object.prototype` members (`toString`, `valueOf`, `__proto__`, …), the
 * `constructor`, and the lifecycle hooks.
 *
 * `#`-private helpers need no handling: they are not real property keys, so
 * `getOwnPropertyNames` never lists them and `driver['#x']` is `undefined`.
 * Only _plain_ public methods can appear here.
 *
 * Getters are excluded (we read the descriptor's `.value`, never access the
 * property), so evaluating this set never runs driver code. Intended to be
 * called once per driver at registration and cached — not on the hot path.
 */
export function resolveCallableMethods(driver: object): Set<string> {
    const callable = new Set<string>();
    const seen = new Set<string>();
    for (
        let o: object | null = driver;
        o && o !== Object.prototype;
        o = Object.getPrototypeOf(o) as object | null
    ) {
        for (const name of Object.getOwnPropertyNames(o)) {
            // First (lowest) definition wins — a subclass override shadows
            // the base, and we decide against the resolved descriptor.
            if (seen.has(name)) continue;
            seen.add(name);
            if (name === 'constructor') continue;
            if (RESERVED_DRIVER_METHODS.has(name)) continue;
            const desc = Object.getOwnPropertyDescriptor(o, name);
            if (desc && typeof desc.value === 'function') callable.add(name);
        }
    }
    return callable;
}
