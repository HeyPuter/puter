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
 * The subset of the metering service enforcement needs. Metering is optional
 * from a gate's point of view — a deployment without it enforces nothing.
 */
export interface CreditMeteringLike {
    hasAnyUsageCached?: (actor: Actor) => Promise<boolean>;
}

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
    metering: CreditMeteringLike | undefined,
    actor: Actor | undefined,
    config: EnforcementConfig,
): Promise<void> => {
    if (!metering?.hasAnyUsageCached) return;
    if (!enforcementEnabled(config)) return;
    if (creditEnforcementExempt(actor, config)) return;

    if (!(await metering.hasAnyUsageCached(actor!))) {
        throw new HttpError(402, 'No usage left for request.', {
            legacyCode: 'insufficient_funds',
        });
    }
};
