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

import type { IConfig } from '../types';
import { isSystemActor, type Actor } from './actor';
import { HttpError } from './http/HttpError.js';

// -- Reputation gating -----------------------------------------------
//
// An account carries a score on the 0-100 scale: how much of the product it
// has earned the run of. What moves that score is not decided here — this
// module is only the gate, and it holds no judgement about who deserves what.
//
// A surface that wants a floor names a *tier* (`requireReputation: 'foo'`),
// and the score that tier takes is deployment config. Keeping the number out
// of the declaration is the point: what counts as "trusted enough" is policy,
// it differs per deployment, and it gets retuned far more often than the
// surfaces it protects. A tier the running config says nothing about is
// inert — an install that never scores its accounts must not start turning
// traffic away on a score it never computed.

/**
 * The score of an account nothing has been recorded against. Also the score of
 * an account whose stored value is missing or unreadable: absence of evidence
 * is neutral, not suspicion.
 */
export const DEFAULT_REPUTATION = 100;

/** Ends of the scale. A score outside them is clamped, never rejected. */
export const MIN_REPUTATION = 0;
export const MAX_REPUTATION = 100;

/**
 * What a surface asks for: the name of a tier whose minimum score lives in
 * config, or `false` for no requirement (the same as not declaring one).
 */
export type ReputationRequirement = string | false;

/** Config knobs; see `IConfig.reputationGate`. */
type ReputationConfig = Pick<IConfig, 'reputationGate'>;

export const clampReputation = (score: number): number =>
    Math.min(MAX_REPUTATION, Math.max(MIN_REPUTATION, score));

/**
 * Validate a requirement declared on a route or a driver method. Throws at
 * boot, where the declaration is read, rather than letting a malformed one
 * decide live requests: an empty tier name reads as a gate to whoever edits the
 * file next while admitting everybody, so it is an error, and `false` has to be
 * written deliberately.
 */
export const validateReputationRequirement = (
    value: unknown,
    label: string,
): ReputationRequirement => {
    if (value === false) return false;
    if (typeof value !== 'string') {
        throw new Error(`${label}: expected a tier name, or false`);
    }
    const tier = value.trim();
    if (tier === '') {
        throw new Error(`${label}: expected a non-empty tier name`);
    }
    return tier;
};

/**
 * The one master switch. Turning it off leaves every declaration in place and
 * stops all of them enforcing — the knob to reach for when a gate is turning
 * away traffic it shouldn't.
 */
export const reputationEnforcementEnabled = (
    config: ReputationConfig,
): boolean => config.reputationGate?.enabled !== false;

/**
 * The minimum score this deployment gives a tier, or `undefined` when it
 * defines none — in which case the tier is inert and everyone passes. A
 * malformed entry reads the same way as a missing one: a gate is not something
 * to guess a number for.
 */
export const resolveReputationThreshold = (
    config: ReputationConfig,
    tier: string,
): number | undefined => {
    const raw = config.reputationGate?.tiers?.[tier];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return clampReputation(raw);
};

/**
 * The score to judge an actor by, or `undefined` when there is no account to
 * score (an anonymous caller).
 *
 * The score rides on the actor's user record, so a gate costs a field read and
 * no lookup. This is the single place that resolution lives: a score that later
 * comes from somewhere livelier than the account record changes here and
 * nowhere else.
 */
export const resolveActorReputation = (
    actor: Actor | undefined,
): number | undefined => {
    if (!actor?.user?.uuid) return undefined;
    const raw = actor.user.reputation;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return DEFAULT_REPUTATION;
    }
    return clampReputation(raw);
};

/**
 * Deny without saying why. The caller learns the action isn't available to this
 * account and nothing else: not its score, not the tier it fell short of, not
 * which signal put it there. Anything more is a readout that tells whoever is
 * probing exactly how far to back off, and support can get the same answer from
 * the account instead.
 */
const denied = (): HttpError =>
    new HttpError(403, 'This account is not permitted to perform this action', {
        legacyCode: 'reputation_required',
    });

/**
 * Reject an actor whose account isn't trusted enough for the surface it is
 * calling.
 *
 * The system actor passes, as it does through every gate. An anonymous caller
 * does not: there is no account to have earned anything, and a surface that
 * asked for a floor did not mean "unless nobody is signed in". Routes get auth
 * pulled in ahead of this by the materializer, so in practice the anonymous
 * branch is the driver dispatch path's.
 *
 * A promise rather than a plain throw because the shape has to survive the
 * score being read from storage rather than off the actor — the call sites
 * shouldn't have to change for that.
 */
export const assertActorMeetsReputation = async (
    actor: Actor | undefined,
    requirement: ReputationRequirement,
    config: ReputationConfig,
): Promise<void> => {
    if (requirement === false) return;
    if (!reputationEnforcementEnabled(config)) return;

    const minimum = resolveReputationThreshold(config, requirement);
    if (minimum === undefined) return;

    if (actor && isSystemActor(actor)) return;

    const score = resolveActorReputation(actor);
    if (score === undefined) throw denied();
    if (score >= minimum) return;

    throw denied();
};
