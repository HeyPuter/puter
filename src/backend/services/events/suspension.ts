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
    EVENTS_NO_CREDIT_BACKLOG_TTL_MS,
    EVENTS_SUSPENDED_BACKLOG_TTL_MS,
    EVENTS_SUSPENDED_PENDING_CAP,
} from '../../controllers/events/limits.js';
import type { DurableSubscription } from '../../stores/events/types.js';
import type { SuspendedReason } from '../../stores/events/DurableSubscriptionStore.js';

/**
 * Suspended-versus-active on a durable subscription, and what each reason does
 * to what the subscription is owed.
 *
 * Suspension is a state, not a deletion, so a bad deploy or a lapsed card is
 * recoverable: the row keeps its identity, stops being delivered to, stops
 * being metered, and comes out of every watched set until it resumes.
 *
 * The backlog policy is per reason because "stops metering" plus "holds
 * backlog" is a free memory hold — removing one widely-subscribed handler would
 * otherwise convert every dependent into a full unbilled backlog held forever.
 * A revoked grant is the one that purges: its backlog names paths its holder
 * has just lost the right to see, and keeping them for a resume that by design
 * never comes turns a revocation into a delayed disclosure.
 */

/** What a suspension does to the deliveries the subscription is still owed. */
export interface BacklogPolicy {
    /** Deliveries kept; the rest are shed with a gap marker in their place. */
    cap: number;
    /** How long the kept ones survive, or `0` to drop them now. */
    ttlMs: number;
    /** Whether the reason can be lifted at all. */
    resumable: boolean;
}

const HELD: BacklogPolicy = {
    cap: EVENTS_SUSPENDED_PENDING_CAP,
    ttlMs: EVENTS_SUSPENDED_BACKLOG_TTL_MS,
    resumable: true,
};

export const BACKLOG_POLICY: Record<SuspendedReason, BacklogPolicy> = {
    handler_not_found: HELD,
    failures: HELD,
    // The resume condition is a top-up, so the window is shorter.
    no_credit: {
        cap: EVENTS_SUSPENDED_PENDING_CAP,
        ttlMs: EVENTS_NO_CREDIT_BACKLOG_TTL_MS,
        resumable: true,
    },
    permission_revoked: { cap: 0, ttlMs: 0, resumable: false },
};

export const backlogPolicyFor = (reason: SuspendedReason): BacklogPolicy =>
    BACKLOG_POLICY[reason];

/** Whether a reason ever lifts. `permission_revoked` never does. */
export const isResumable = (reason: SuspendedReason): boolean =>
    BACKLOG_POLICY[reason].resumable;

/** Whether a suspended row is in the state a given resume would lift. */
export const suspendedFor = (
    row: Pick<DurableSubscription, 'suspendedAt' | 'suspendedReason'>,
    reason: SuspendedReason,
): boolean => row.suspendedAt !== null && row.suspendedReason === reason;
