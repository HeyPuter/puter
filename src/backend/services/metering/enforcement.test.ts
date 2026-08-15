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

import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_ACTOR, type Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { IConfig } from '../../types';
import {
    assertActorHasCredits,
    assertActorHasSubscription,
    creditEnforcementExempt,
    enforcementEnabled,
    subscriptionEnforcementEnabled,
    subscriptionSatisfies,
    validateSubscriptionRequirement,
} from './enforcement.js';

const userActor = (overrides: Partial<Actor> = {}): Actor =>
    ({
        user: { uuid: 'user-uuid', username: 'user' },
        ...overrides,
    }) as Actor;

const workerActor = (): Actor =>
    userActor({ session: { uid: 'session-uid', kind: 'worker' } });

const config = (overrides: Partial<IConfig> = {}): IConfig =>
    overrides as IConfig;

const brokeMetering = { hasAnyUsageCached: vi.fn().mockResolvedValue(false) };
const fundedMetering = { hasAnyUsageCached: vi.fn().mockResolvedValue(true) };

describe('enforcementEnabled', () => {
    it('is on unless turned off', () => {
        expect(enforcementEnabled(config())).toBe(true);
        expect(enforcementEnabled(config({ meteringEnforcement: {} }))).toBe(
            true,
        );
        expect(
            enforcementEnabled(
                config({ meteringEnforcement: { enabled: true } }),
            ),
        ).toBe(true);
        expect(
            enforcementEnabled(
                config({ meteringEnforcement: { enabled: false } }),
            ),
        ).toBe(false);
    });
});

describe('creditEnforcementExempt', () => {
    it('exempts callers there is no account to charge', () => {
        expect(creditEnforcementExempt(undefined, config())).toBe(true);
        expect(creditEnforcementExempt({ user: {} } as Actor, config())).toBe(
            true,
        );
    });

    it('exempts the system actor', () => {
        expect(creditEnforcementExempt(SYSTEM_ACTOR, config())).toBe(true);
    });

    it('exempts worker sessions by default, and stops when told to', () => {
        expect(creditEnforcementExempt(workerActor(), config())).toBe(true);
        expect(
            creditEnforcementExempt(
                workerActor(),
                config({ meteringEnforcement: { workers: true } }),
            ),
        ).toBe(false);
    });

    it('does not exempt an ordinary user or app caller', () => {
        expect(creditEnforcementExempt(userActor(), config())).toBe(false);
        expect(
            creditEnforcementExempt(
                userActor({ app: { uid: 'app-uid', id: 1 } }),
                config(),
            ),
        ).toBe(false);
    });
});

describe('assertActorHasCredits', () => {
    const expect402 = async (promise: Promise<unknown>) => {
        await expect(promise).rejects.toBeInstanceOf(HttpError);
        await expect(promise).rejects.toMatchObject({
            statusCode: 402,
            // Same code the AI surfaces reject with, so a client that already
            // handles running out of budget handles this too.
            legacyCode: 'insufficient_funds',
        });
    };

    it('rejects an account with nothing left', async () => {
        await expect402(
            assertActorHasCredits(brokeMetering, userActor(), config()),
        );
    });

    it('admits an account with budget left', async () => {
        await expect(
            assertActorHasCredits(fundedMetering, userActor(), config()),
        ).resolves.toBeUndefined();
    });

    it('admits everyone when enforcement is off', async () => {
        await expect(
            assertActorHasCredits(
                brokeMetering,
                userActor(),
                config({ meteringEnforcement: { enabled: false } }),
            ),
        ).resolves.toBeUndefined();
    });

    it('admits everyone with no metering service to ask', async () => {
        await expect(
            assertActorHasCredits(undefined, userActor(), config()),
        ).resolves.toBeUndefined();
    });

    it('does not ask about an exempt caller', async () => {
        const metering = {
            hasAnyUsageCached: vi.fn().mockResolvedValue(false),
        };
        await expect(
            assertActorHasCredits(metering, workerActor(), config()),
        ).resolves.toBeUndefined();
        expect(metering.hasAnyUsageCached).not.toHaveBeenCalled();
    });
});

// -- Subscription enforcement ----------------------------------------

const onPlan = (id: string) => ({
    getActorSubscription: vi.fn().mockResolvedValue({ id }),
});

describe('subscriptionSatisfies', () => {
    it('counts anything that is not a free policy as a subscription', () => {
        expect(subscriptionSatisfies('user_free', true)).toBe(false);
        expect(subscriptionSatisfies('temp_free', true)).toBe(false);
        // A plan an extension registered counts without core naming it.
        expect(subscriptionSatisfies('professional', true)).toBe(true);
        expect(subscriptionSatisfies('unlimited', true)).toBe(true);
    });

    it('matches an explicit allowlist exactly', () => {
        expect(subscriptionSatisfies('pro', ['business', 'pro'])).toBe(true);
        expect(subscriptionSatisfies('basic', ['business', 'pro'])).toBe(false);
    });

    it('treats an absent requirement as satisfied by any plan', () => {
        // `false` and `[]` say the surface asked for nothing. Reading either
        // as "paid plans only" would gate a route whose author opted out.
        expect(subscriptionSatisfies('user_free', false)).toBe(true);
        expect(subscriptionSatisfies('business', false)).toBe(true);
        expect(subscriptionSatisfies('user_free', [])).toBe(true);
    });
});

describe('validateSubscriptionRequirement', () => {
    it('passes booleans and non-empty id lists through', () => {
        expect(validateSubscriptionRequirement(true, 'x')).toBe(true);
        expect(validateSubscriptionRequirement(false, 'x')).toBe(false);
        expect(validateSubscriptionRequirement(['pro'], 'x')).toEqual(['pro']);
    });

    it('rejects a requirement that names nothing', () => {
        expect(() => validateSubscriptionRequirement([], 'x')).toThrow(
            /at least one subscription id/,
        );
        expect(() => validateSubscriptionRequirement([''], 'x')).toThrow(
            /must be strings/,
        );
        expect(() => validateSubscriptionRequirement([1], 'x')).toThrow(
            /must be strings/,
        );
    });

    it('rejects a shape that is neither', () => {
        expect(() => validateSubscriptionRequirement('pro', 'x')).toThrow(
            /expected true\/false or an array of ids/,
        );
        expect(() => validateSubscriptionRequirement(undefined, 'x')).toThrow(
            /expected true\/false or an array of ids/,
        );
    });

    it('names the surface it was reading', () => {
        expect(() =>
            validateSubscriptionRequirement([], 'route POST /a: x'),
        ).toThrow(/^route POST \/a: x:/);
    });
});

describe('subscriptionEnforcementEnabled', () => {
    it('is on by default and off on its own switch', () => {
        expect(subscriptionEnforcementEnabled(config())).toBe(true);
        expect(
            subscriptionEnforcementEnabled(
                config({ meteringEnforcement: { subscriptions: false } }),
            ),
        ).toBe(false);
    });

    it('follows the master enforcement switch', () => {
        // `enabled: false` is documented as the one knob that stops metering
        // turning traffic away — plan gates included.
        expect(
            subscriptionEnforcementEnabled(
                config({ meteringEnforcement: { enabled: false } }),
            ),
        ).toBe(false);
        expect(
            subscriptionEnforcementEnabled(
                config({
                    meteringEnforcement: {
                        enabled: false,
                        subscriptions: true,
                    },
                }),
            ),
        ).toBe(false);
    });
});

describe('assertActorHasSubscription', () => {
    const expect402 = async (promise: Promise<void>, fields?: unknown) => {
        await expect(promise).rejects.toBeInstanceOf(HttpError);
        await expect(promise).rejects.toMatchObject({
            statusCode: 402,
            legacyCode: 'subscription_required',
            ...(fields ? { fields } : {}),
        });
    };

    it('rejects an account on a free plan', async () => {
        await expect402(
            assertActorHasSubscription(
                onPlan('user_free'),
                userActor(),
                true,
                config(),
            ),
            { subscription: 'user_free' },
        );
    });

    it('admits an account on a paid plan', async () => {
        await expect(
            assertActorHasSubscription(
                onPlan('business'),
                userActor(),
                true,
                config(),
            ),
        ).resolves.toBeUndefined();
    });

    it('rejects a paying account whose plan is not in the allowlist', async () => {
        await expect402(
            assertActorHasSubscription(
                onPlan('basic'),
                userActor(),
                ['business', 'pro'],
                config(),
            ),
            { subscription: 'basic', required: ['business', 'pro'] },
        );
    });

    it('holds a worker to the account it acts for', async () => {
        // Unlike the credit check: entitlements do not widen because a
        // program is driving them.
        await expect402(
            assertActorHasSubscription(
                onPlan('user_free'),
                workerActor(),
                true,
                config(),
            ),
        );
    });

    it('does not ask when nothing is required', async () => {
        const metering = onPlan('user_free');
        await expect(
            assertActorHasSubscription(metering, userActor(), false, config()),
        ).resolves.toBeUndefined();
        await expect(
            assertActorHasSubscription(metering, userActor(), [], config()),
        ).resolves.toBeUndefined();
        expect(metering.getActorSubscription).not.toHaveBeenCalled();
    });

    it('admits everyone with no metering service to ask', async () => {
        await expect(
            assertActorHasSubscription(undefined, userActor(), true, config()),
        ).resolves.toBeUndefined();
    });

    it('admits everyone when subscription enforcement is switched off', async () => {
        await expect(
            assertActorHasSubscription(
                onPlan('user_free'),
                userActor(),
                true,
                config({ meteringEnforcement: { subscriptions: false } }),
            ),
        ).resolves.toBeUndefined();
    });

    it('admits everyone when metering enforcement is off wholesale', async () => {
        await expect(
            assertActorHasSubscription(
                onPlan('user_free'),
                userActor(),
                true,
                config({ meteringEnforcement: { enabled: false } }),
            ),
        ).resolves.toBeUndefined();
    });

    it('admits the system actor', async () => {
        const metering = onPlan('user_free');
        await expect(
            assertActorHasSubscription(metering, SYSTEM_ACTOR, true, config()),
        ).resolves.toBeUndefined();
        expect(metering.getActorSubscription).not.toHaveBeenCalled();
    });

    it('rejects a caller with no account to read a plan off', async () => {
        await expect(
            assertActorHasSubscription(
                onPlan('business'),
                undefined,
                true,
                config(),
            ),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'subscription_required',
        });
    });
});
