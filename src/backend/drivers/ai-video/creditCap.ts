/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';

export interface ICapSecondsParams {
    metering: MeteringService;
    actor: Actor;
    /** Price of one second of output, in micro-cents. */
    perSecondMicroCents: number;
    /** Duration the provider resolved from the request, in seconds. */
    requestedSeconds: number;
    /**
     * Durations the model actually accepts. When present the cap snaps _down_
     * to the longest supported duration the actor can pay for; when absent any
     * whole number of seconds down to `minSeconds` is allowed.
     */
    allowedSeconds?: readonly number[] | null;
    /** Floor for models with no discrete ladder. Defaults to 1. */
    minSeconds?: number;
    /** Model id, for the 402 message. */
    modelId?: string;
}

/**
 * Clamp a video's duration to what the actor's remaining credit actually buys.
 *
 * Video is the only AI modality where a single request can cost multiples of a
 * whole monthly allowance (Sora 2 Pro at 1080p is $0.70/second — a 12s clip is
 * $8.40), so an all-or-nothing affordability check leaves the entire request
 * cost as slop above the budget. This is the video analogue of the `max_tokens`
 * clamp in `ChatCompletionDriver`: shorten the output to fit the wallet, and
 * only reject outright when even the shortest supported clip is unaffordable.
 *
 * Returns the duration the caller must actually request upstream — callers MUST
 * use the returned value both for the upstream call and for metering, or the
 * cap buys nothing.
 */
export async function capSecondsToRemainingCredits({
    metering,
    actor,
    perSecondMicroCents,
    requestedSeconds,
    allowedSeconds,
    minSeconds,
    modelId,
}: ICapSecondsParams): Promise<number> {
    if (!actor) {
        throw new HttpError(401, 'Authentication required', {
            legacyCode: 'unauthorized',
        });
    }

    // Unpriced or free output — nothing to clamp against.
    if (!Number.isFinite(perSecondMicroCents) || perSecondMicroCents <= 0) {
        return requestedSeconds;
    }

    const remaining = await metering.getRemainingUsage(actor);
    const affordableSeconds = Math.floor(remaining / perSecondMicroCents);

    const ladder = (allowedSeconds ?? [])
        .filter((s) => Number.isFinite(s) && s > 0)
        .sort((a, b) => a - b);

    const usd = (microCents: number) => (microCents / 1e8).toFixed(2);
    const insufficient = (shortest: number) =>
        new HttpError(
            402,
            `Insufficient funds: the shortest ${modelId ?? 'video'} clip is ` +
                `${shortest}s ($${usd(shortest * perSecondMicroCents)}), ` +
                `more than the $${usd(remaining)} remaining.`,
            { legacyCode: 'insufficient_funds' },
        );

    if (ladder.length > 0) {
        // A sub-ladder request already gets rounded up to the shortest
        // supported duration by every provider, so price it that way here too.
        const ceiling = Math.min(
            Math.max(requestedSeconds, ladder[0]),
            affordableSeconds,
        );
        for (let i = ladder.length - 1; i >= 0; i--) {
            if (ladder[i] <= ceiling) return ladder[i];
        }
        throw insufficient(ladder[0]);
    }

    const floor = Math.max(1, minSeconds ?? 1);
    const capped = Math.min(requestedSeconds, affordableSeconds);
    if (capped < floor) throw insufficient(floor);
    return capped;
}
