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

import type { Actor } from '../../core/actor';
import { isSystemActor } from '../../core/actor';
import { HttpError } from '../../core/http/HttpError.js';
import type { IConfig } from '../../types';
import { FREE_SUBSCRIPTION_IDS } from './consts.js';
import type { MeteringService } from './MeteringService';

// -- Credit enforcement ----------------------------------------------
//
// Storage and KV usage is recorded per request and settles seconds behind
// the traffic, so there is nothing to enforce at the point it is measured.
// What can be enforced is the state that usage produced: an account with
// nothing left of its budget is turned away from the operations that spend
// it, on the way in.
//
// Which operations those are is a per-route/per-method decision made where
// the surface is declared (`RouteOptions.requireCredits`, the KV driver's
// exempt list). Two rules hold across all of them:
//
//   - Only spending is gated. Listing, stat-ing and deleting stay open: an
//     account that has run out still has to be able to see what it has and
//     get rid of it, and turning away the operations that free resources
//     leaves no way back other than paying.
//   - Only the account's own traffic is gated. Serving a hosted site is
//     billed to the account hosting it but driven by visitors who have no
//     say in its balance, so it is metered and never blocked.

/**
 * The part of the metering service the credit check calls. Narrowed from the
 * service itself so a gate can't drift from it, and optional at the call site:
 * a deployment without metering enforces nothing.
 */
export type CreditMetering = Pick<MeteringService, 'hasAnyUsageCached'>;

/** Config knobs; see `IConfig.meteringEnforcement`. */
type EnforcementConfig = Pick<IConfig, 'meteringEnforcement'>;

export const enforcementEnabled = (config: EnforcementConfig): boolean =>
    config.meteringEnforcement?.enabled !== false;

/**
 * Actors whose usage is recorded but never blocked.
 *
 * A worker is a deployed program rather than someone sitting in front of a
 * screen: it finds out it has been cut off by failing mid-run, with no prompt
 * to read and nobody to act on it. Workers are exempt until that failure has
 * somewhere to surface — `meteringEnforcement.workers` turns it on.
 */
export const creditEnforcementExempt = (
    actor: Actor | undefined,
    config: EnforcementConfig,
): boolean => {
    if (!actor?.user?.uuid) return true;
    if (isSystemActor(actor)) return true;
    if (
        actor.session?.kind === 'worker' &&
        config.meteringEnforcement?.workers !== true
    ) {
        return true;
    }
    return false;
};

/**
 * Reject an actor with nothing left to spend. Same status and code the AI
 * surfaces use, so a client that already handles one handles this.
 */
export const assertActorHasCredits = async (
    metering: CreditMetering | undefined,
    actor: Actor | undefined,
    config: EnforcementConfig,
): Promise<void> => {
    if (!metering) return;
    if (!enforcementEnabled(config)) return;
    if (creditEnforcementExempt(actor, config)) return;

    if (!(await metering.hasAnyUsageCached(actor!))) {
        throw new HttpError(402, 'No usage left for request.', {
            legacyCode: 'insufficient_funds',
        });
    }
};

/** The part of the metering service the subscription check calls. */
export type SubscriptionMetering = Pick<
    MeteringService,
    'getActorSubscription'
>;

/**
 * What a surface asks for. `true` — any plan that isn't one of the free ones
 * (`FREE_SUBSCRIPTION_IDS`), so a plan added by an extension counts without
 * being named here. An array — the caller's own allowlist of policy ids, for
 * the narrower case of a feature that belongs to specific plans. `false` — no
 * requirement, the same as not declaring one.
 */
export type SubscriptionRequirement = boolean | readonly string[];

/**
 * Validate a requirement declared on a route or a driver method. Throws at
 * boot, where the declaration is read, rather than letting a malformed one
 * decide live requests: an empty array reads as "subscribers only" to the next
 * person editing the file while admitting everybody, so it is an error, and
 * `false` has to be written deliberately.
 */
export const validateSubscriptionRequirement = (
    value: unknown,
    label: string,
): SubscriptionRequirement => {
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        if (value.length === 0) {
            throw new Error(
                `${label}: expected at least one subscription id, or true`,
            );
        }
        for (const id of value) {
            if (typeof id !== 'string' || id.length === 0) {
                throw new Error(`${label}: subscription ids must be strings`);
            }
        }
        return value as readonly string[];
    }
    throw new Error(`${label}: expected true/false or an array of ids`);
};

/** Whether a resolved policy id satisfies a requirement. */
export const subscriptionSatisfies = (
    id: string,
    requirement: SubscriptionRequirement,
): boolean => {
    // No requirement is satisfied by every plan — `false` and `[]` mean the
    // surface asked for nothing, not that nothing passes.
    if (requirement === false) return true;
    if (Array.isArray(requirement)) {
        return requirement.length === 0 || requirement.includes(id);
    }
    return !FREE_SUBSCRIPTION_IDS.has(id);
};

/**
 * Plan gates ride on the same master switch as the rest of enforcement, so
 * `meteringEnforcement.enabled: false` is the one knob that stops metering
 * turning traffic away. `subscriptions` narrows it to the plan gates alone.
 */
export const subscriptionEnforcementEnabled = (
    config: EnforcementConfig,
): boolean =>
    enforcementEnabled(config) &&
    config.meteringEnforcement?.subscriptions !== false;

/**
 * Reject a caller whose plan doesn't cover the surface they're calling.
 *
 * Unlike the credit check, a worker session is not exempt: a worker acts for an
 * account, and an account's entitlements don't widen because a program is
 * driving them. The system actor still passes, and so does a deployment with no
 * metering wired — there are no plans to be on.
 *
 * The answer comes from the metering service's per-actor subscription cache, so
 * this normally costs a map lookup.
 */
export const assertActorHasSubscription = async (
    metering: SubscriptionMetering | undefined,
    actor: Actor | undefined,
    requirement: SubscriptionRequirement,
    config: EnforcementConfig,
): Promise<void> => {
    if (requirement === false) return;
    if (Array.isArray(requirement) && requirement.length === 0) return;
    if (!metering) return;
    if (!subscriptionEnforcementEnabled(config)) return;
    if (actor && isSystemActor(actor)) return;

    if (!actor?.user?.uuid) {
        throw new HttpError(403, 'A subscription is required for this action', {
            legacyCode: 'subscription_required',
        });
    }

    const subscription = await metering.getActorSubscription(actor);
    if (subscriptionSatisfies(subscription.id, requirement)) return;

    throw new HttpError(402, 'A subscription is required for this action', {
        legacyCode: 'subscription_required',
        fields: {
            subscription: subscription.id,
            ...(Array.isArray(requirement) ? { required: requirement } : {}),
        },
    });
};
