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

import type { AclMode } from '../../services/acl/ACLService.js';
import type { DeliveryClass } from '../../services/events/registry.js';
import type { FsOp } from '../../services/events/subjects.js';

/**
 * Row shapes shared by the two subscription stores. Session rows live in Redis
 * and die with their connection; durable rows live in a table and are cached
 * into the same Redis keyspace. Dispatch reads both out of one hash, matches
 * them with one matcher and re-checks them with one ACL call, so what it reads
 * is declared once here rather than per store.
 */

/** Transports a delivery may take. */
export const SUBSCRIPTION_TARGETS = ['socket', 'worker', 'push'] as const;

export type SubscriptionTarget = (typeof SUBSCRIPTION_TARGETS)[number];

export const isSubscriptionTarget = (
    value: unknown,
): value is SubscriptionTarget =>
    SUBSCRIPTION_TARGETS.includes(value as SubscriptionTarget);

/** Transports a session row may take: it has one connection and no handler. */
export const SESSION_TARGETS: SubscriptionTarget[] = ['socket'];

/** Transports a durable row takes unless the caller says otherwise. */
export const DEFAULT_DURABLE_TARGETS: SubscriptionTarget[] = [
    'socket',
    'worker',
];

/**
 * Whether a delivery class may carry these transports. `single` and `push` are
 * incompatible by construction — a lease can only be settled by a consumer that
 * reports back, and a device notification never does. An app's `single` row
 * also needs a `worker` to fall back to once the connected clients have had
 * their turns, or an unacknowledged delivery sits at the head of its queue for
 * good. An account's own row has no app to run a worker for, so it is held on
 * the socket alone and the pending hold is its backstop. Both are invariants
 * every writer is held to, not defaults.
 */
export const targetsAllowedForDelivery = (
    delivery: DeliveryClass,
    targets: readonly SubscriptionTarget[],
    appUid: string | null,
): boolean =>
    delivery !== 'single' ||
    (!targets.includes('push') &&
        (appUid === null || targets.includes('worker')));

/**
 * What a row's delivery re-check runs against. An access mode for a filesystem
 * row, which composes with its anchor uid; the whole grant string for a row on
 * a shared key-value region, where the grant is what a revoke names and there
 * is no anchor to compose it with.
 */
export type SubscriptionPermission = AclMode | string;

/** What dispatch needs from a subscription, whichever store it came from. */
export interface DispatchSubscription {
    subId: string;
    /** Who subscribed: the delivery target, and whose access is re-checked. */
    holderUserId: number;
    /** Owner of the anchor node: the keyspace this row is indexed in. */
    ownerUserId: number;
    /** The subject as the client asked for it. */
    subject: string;
    /** Anchor token the row is indexed under. */
    token: string;
    /**
     * What the row is anchored on, in its family's terms: an FS row names the
     * node's uid and path, a KV row names the app whose namespace it watches
     * and the key prefix its token stops at.
     */
    anchorUid: string;
    anchorPath: string;
    /**
     * Glob the anchor's members are filtered by, or `null` when the anchor is
     * exact. Relative to the anchor for FS; the whole key for KV.
     */
    match: string | null;
    /** FS rows only: KV subjects carry no operation filter. */
    op: FsOp | null;
    /** The app that created the row, and the scope of the three verbs. */
    appUid: string | null;
    /** What the subscribe check passed under; re-checked per delivery. */
    permission: SubscriptionPermission;
    /** Transports this row's deliveries may take. */
    targets?: SubscriptionTarget[];
    /** Session rows only: the connection a delivery is addressed at. */
    socketId?: string;
    /** Durable rows only: set on every row that outlives its connection. */
    durable?: true;
    delivery?: DeliveryClass;
    handlerName?: string | null;
    /** Durable rows only: handed to the handler, and read nowhere else. */
    context?: string | null;
}

export interface SessionSubscription extends DispatchSubscription {
    socketId: string;
}

/** A row in `event_subscriptions`, as the rest of the system sees it. */
export interface DurableSubscription extends DispatchSubscription {
    durable: true;
    delivery: DeliveryClass;
    targets: SubscriptionTarget[];
    handlerName: string | null;
    /** Plaintext JSON, capped at 4 KB. Never returned by `list`. */
    context: string | null;
    /** Unix seconds, or `null` for a subscription with no end. */
    expiresAt: number | null;
    suspendedAt: number | null;
    suspendedReason: string | null;
    createdAt: number;
}

/** One owner's generation after a change to the set of rows keyed under them. */
export interface GenerationBump {
    userId: number;
    generation: number;
}
