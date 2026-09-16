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

import {
    DRIVER_CONCURRENT_KEY,
    DRIVER_DEFAULT_KEY,
    DRIVER_INTERFACE_KEY,
    DRIVER_NAME_KEY,
    DRIVER_NO_USER_SESSION_KEY,
    DRIVER_RATE_LIMIT_KEY,
    DRIVER_REQUIRE_REPUTATION_KEY,
    DRIVER_REQUIRE_SUBSCRIPTION_KEY,
    validateDriverConcurrent,
    validateDriverRateLimit,
    validateDriverRequireReputation,
    validateDriverRequireSubscription,
    type DriverConcurrentConfig,
    type DriverRateLimitConfig,
    type DriverRequireReputationConfig,
    type DriverRequireSubscriptionConfig,
} from './meta';

/**
 * Options for the `@Driver` class decorator. Each policy takes `{ default?,
 * methods? }`; a method covered by neither is ungated (rate limits fall through
 * to the global driver default). See `DriverMeta` for semantics.
 */
export interface DriverOptions {
    /** Unique within the interface. Defaults to the class name. */
    name?: string;
    /** The default driver for its interface. */
    default?: boolean;
    rateLimit?: DriverRateLimitConfig;
    concurrent?: DriverConcurrentConfig;
    /** Reject bare account-session tokens on `/drivers/call`. */
    noUserSession?: boolean;
    /**
     * `true` accepts any non-free plan; an array of `SubscriptionPolicy.id`s
     * only those.
     */
    requireSubscription?: DriverRequireSubscriptionConfig;
    /** Reputation tier names; thresholds come from `reputationGate.tiers`. */
    requireReputation?: DriverRequireReputationConfig;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

/**
 * Class decorator that marks a driver implementation and records its interface
 *
 * - Name on the prototype.
 *
 * Equivalent imperative approach (no decorator needed):
 *
 * ```ts
 * class MyDriver extends PuterDriver {
 *     readonly driverInterface = 'puter-chat-completion';
 *     readonly driverName = 'my-impl';
 *     readonly isDefault = true;
 * }
 * ```
 *
 * Usage:
 *
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
    const requireSubscription =
        opts.requireSubscription !== undefined
            ? validateDriverRequireSubscription(opts.requireSubscription, label)
            : undefined;
    const requireReputation =
        opts.requireReputation !== undefined
            ? validateDriverRequireReputation(opts.requireReputation, label)
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
        if (requireSubscription)
            proto[DRIVER_REQUIRE_SUBSCRIPTION_KEY] = requireSubscription;
        if (requireReputation)
            proto[DRIVER_REQUIRE_REPUTATION_KEY] = requireReputation;
        if (opts.noUserSession) proto[DRIVER_NO_USER_SESSION_KEY] = true;
    };
}
