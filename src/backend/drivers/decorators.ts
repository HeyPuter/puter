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

import {
    DRIVER_CONCURRENT_KEY,
    DRIVER_DEFAULT_KEY,
    DRIVER_INTERFACE_KEY,
    DRIVER_NAME_KEY,
    DRIVER_RATE_LIMIT_KEY,
    validateDriverConcurrent,
    validateDriverRateLimit,
    type DriverConcurrentConfig,
    type DriverRateLimitConfig,
} from './meta';

/**
 * Options for the `@Driver` class decorator.
 */
export interface DriverOptions {
    /** Unique name for this implementation within its interface. Defaults to the class name. */
    name?: string;
    /** When true, this driver is the default for its interface. */
    default?: boolean;
    /**
     * Rate-limit policy. Each driver method can declare its own limit /
     * window / storage backend; methods not listed inherit `default`,
     * and undeclared methods fall through to the global driver default
     * (600/min in `checkDriverRateLimit`).
     *
     * ```ts
     * @Driver('puter-kvstore', {
     *     rateLimit: {
     *         default: { limit: 600, window: 60_000 },
     *         methods: {
     *             list: { limit: 60,  window: 60_000, backend: 'kv' },
     *             set:  { limit: 200, window: 60_000, backend: 'redis' },
     *         },
     *     },
     * })
     * ```
     */
    rateLimit?: DriverRateLimitConfig;
    /**
     * Concurrent in-flight policy. Same envelope as `rateLimit` minus
     * `window`. Adds `bySubscription` to scale the cap by subscription
     * tier (`SubscriptionPolicy.id` from MeteringService).
     *
     * ```ts
     * @Driver('puter-chat-completion', {
     *     concurrent: {
     *         default: { limit: 5, backend: 'redis' },
     *         methods: {
     *             complete: {
     *                 limit: 5,
     *                 bySubscription: { user_free: 1, unlimited: 50 },
     *                 backend: 'redis',
     *             },
     *         },
     *     },
     * })
     * ```
     *
     * Methods that don't appear in either `default` or `methods` are
     * unbounded — matching today's behaviour where nothing is gated.
     */
    concurrent?: DriverConcurrentConfig;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

/**
 * Class decorator that marks a driver implementation and records its
 * interface + name on the prototype.
 *
 * Equivalent imperative approach (no decorator needed):
 * ```ts
 * class MyDriver extends PuterDriver {
 *     readonly driverInterface = 'puter-chat-completion';
 *     readonly driverName = 'my-impl';
 *     readonly isDefault = true;
 * }
 * ```
 *
 * Usage:
 * ```ts
 * @Driver('puter-chat-completion', { name: 'openai-completion', default: true })
 * class OpenAIChatDriver extends PuterDriver {
 *     async complete(args) { ... }
 * }
 * ```
 */
export function Driver(interfaceName: string, opts: DriverOptions = {}) {
    // Validate eagerly at decoration time so a malformed rateLimit /
    // concurrent block surfaces during module load — not when the first
    // request hits the route and the controller resolves driver meta.
    const label = `@Driver('${interfaceName}'${opts.name ? `, name='${opts.name}'` : ''})`;
    const rateLimit =
        opts.rateLimit !== undefined
            ? validateDriverRateLimit(opts.rateLimit, label)
            : undefined;
    const concurrent =
        opts.concurrent !== undefined
            ? validateDriverConcurrent(opts.concurrent, label)
            : undefined;

    return <T extends AnyCtor>(
        value: T,
        _context: ClassDecoratorContext<T>,
    ): void => {
        const proto = value.prototype as Record<string, unknown>;
        proto[DRIVER_INTERFACE_KEY] = interfaceName;
        proto[DRIVER_NAME_KEY] = opts.name ?? value.name;
        proto[DRIVER_DEFAULT_KEY] = opts.default ?? false;
        if (rateLimit) proto[DRIVER_RATE_LIMIT_KEY] = rateLimit;
        if (concurrent) proto[DRIVER_CONCURRENT_KEY] = concurrent;
    };
}
