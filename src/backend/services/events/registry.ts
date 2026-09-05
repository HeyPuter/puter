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

import type { EventKey, KvOp } from '../../clients/event/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { AclMode } from '../acl/ACLService.js';
import type { NotificationAudience } from '../notification/notificationTypes.js';
import { relativeTo } from './matcher.js';
import {
    KV_MATCH_SEPARATOR,
    NOTIF_MATCH_SEPARATOR,
    fsAnchorToken,
    kvAnchorTokens,
    notifAnchorToken,
    notifMatchOn,
    type FsOp,
    type SubjectFamily,
} from './subjects.js';

/**
 * The one place an internal bus event becomes a public subject. Fail closed: an
 * event with no entry here publishes nothing, so internal payloads cannot leak
 * through a new emit site. Every `fs.*`/`kv.*` key is either registered or
 * listed in `UNPUBLISHED_INTERNAL_EVENTS` with a reason.
 */

// -- Types ------------------------------------------------------------

export type DeliveryClass = 'broadcast' | 'single';

/** Fields a projection only has once it is addressed to one subscription. */
export interface DeliveryFields {
    /** True when the acting user is the subscription holder. */
    self: boolean;
    seq: number;
}

interface ProjectedEventBase extends DeliveryFields {
    id: string;
    subject: string;
    ts: number;
}

/** What an FS subscriber receives. Additive only — puter.js ships unversioned. */
export interface ProjectedFsEvent extends ProjectedEventBase {
    op: FsOp;
    uid: string;
    path: string;
    /** Present only on a `move` a subscribed folder lost the node from. */
    from?: string;
}

/**
 * What a KV subscriber receives. `key` stands where an FS event carries
 * `uid`/`path`: a KV change happens to a key in a namespace, and there is no
 * node to name.
 */
export interface ProjectedKvEvent extends ProjectedEventBase {
    op: KvOp;
    key: string;
}

/**
 * What a notification subscriber receives.
 *
 * `id` is the row's own uid rather than a per-dispatch uuid: a client that
 * fetched a missed notification and then received the live copy has to be able
 * to tell they are the same thing, and the mailbox uid is the only identity
 * both halves share. `uid` carries it under the name the mailbox verbs
 * (`mark-ack`, `mark-shown`) take.
 *
 * `notification` is the payload the caller sent, which is exactly what the
 * socket adapter puts on `notif.message` — a subscriber reading this channel
 * sees no less than the desktop does, and no internal row either.
 */
export interface ProjectedNotifEvent extends ProjectedEventBase {
    op: 'post';
    uid: string;
    type: string;
    audience: NotificationAudience;
    /** App the notification is about; `null` for platform notifications. */
    appUid: string | null;
    notification: Record<string, unknown>;
}

export type ProjectedEvent =
    | ProjectedFsEvent
    | ProjectedKvEvent
    | ProjectedNotifEvent;

export type GapReason =
    | 'matched_subscription_limit'
    | 'filter_evaluation_limit'
    | 'delivery_rate_limit'
    | 'backlog_overflow'
    // A suspension holds what it is owed only for as long as the suspension is
    // plausibly recoverable; past that the backlog goes and this stands in.
    | 'suspended_backlog_expired'
    // The handler refused the delivery outright, so it is not offered again.
    | 'handler_rejected';

/**
 * `gap` says an event existed and was not delivered. It rides the delivery
 * channel because a subscriber that never saw one would read the silence as
 * "nothing happened", and carries no `uid`/`path` — what was dropped is exactly
 * what it cannot name.
 */
export interface GapMarker {
    id: string;
    subject: string;
    op: 'gap';
    reason: GapReason;
    ts: number;
}

/** Either shape a subscriber can be handed. */
export type DeliverableEvent = ProjectedEvent | GapMarker;

export interface EventContextBase {
    key: EventKey;
    id: string;
    ts: number;
}

/** What dispatch knows about one committed filesystem change. */
export interface FsEventContext extends EventContextBase {
    entry: FSEntry;
    /** Existing ancestors of `entry`, deepest first. */
    ancestors: ReadonlyArray<{ uid: string; path: string }>;
    /**
     * Present only for a move: where `entry` lived before it. A folder in this
     * chain lost the node, and its subscribers hear about that only if this
     * rides along — `entry` and `ancestors` alone name where the node is now,
     * never where it left.
     */
    movedFrom?: {
        path: string;
        ancestors: ReadonlyArray<{ uid: string; path: string }>;
    };
}

/**
 * What dispatch knows about one committed KV change. The namespace is already
 * split, because both the anchor token and the cross-app gate need its parts.
 */
export interface KvEventContext extends EventContextBase {
    /** Owner of the namespace the key lives in. */
    userUuid: string;
    /** App whose namespace it is — not necessarily the subscriber's own. */
    appUid: string;
    kvKey: string;
    op: KvOp;
}

/**
 * What dispatch knows about one persisted notification. The scope tuple rides
 * along because both the filter and the audience predicate need it, and the
 * recipient's uuid because the anchor token is the mailbox.
 */
export interface NotifEventContext extends EventContextBase {
    userId: number;
    userUuid: string;
    uid: string;
    type: string;
    audience: NotificationAudience;
    appUid: string | null;
    notification: Record<string, unknown>;
}

export type FsDeliveryContext = FsEventContext & DeliveryFields;
export type KvDeliveryContext = KvEventContext & DeliveryFields;
export type NotifDeliveryContext = NotifEventContext & DeliveryFields;

export interface PushMessage {
    title: string;
    body?: string;
    icon?: string;
    url?: string;
}

/**
 * Human-facing projection. Its absence is what makes a subject unpushable —
 * which subjects have one is a privacy decision, not a formatting one.
 */
export type NotifyProjection<P extends ProjectedEvent = ProjectedEvent> = (
    event: P,
) => PushMessage | null;

/** How one family's filters are compiled and what they are tested against. */
export interface MatchSpec {
    /** Delimiter a single `*` will not cross in this family's filters. */
    matchSeparator: string | null;
    /**
     * The value one row's filter is tested against, or `null` when the event is
     * outside that row's anchor.
     */
    matchScope: (anchorPath: string, matchOn: string) => string | null;
}

/**
 * One registry entry. Generic over what its family's dispatch carries and what
 * its subscribers receive, so an FS entry cannot be handed a KV event and the
 * two projections need not pretend to share a shape.
 */
export interface SubjectSpec<
    C extends EventContextBase,
    P extends ProjectedEvent,
> extends MatchSpec {
    family: SubjectFamily;
    subject: string;
    internal: readonly EventKey[];
    tokens: (event: C) => string[];
    /** What a match filter globs against. */
    matchOn: (event: C) => string;
    project: (delivery: C & DeliveryFields) => P;
    notify: NotifyProjection<P> | null;
    defaultDelivery: DeliveryClass;
}

export interface FsPublicSubject extends SubjectSpec<
    FsEventContext,
    ProjectedFsEvent
> {
    family: 'fs';
    /** ACL mode required to subscribe to the anchor. */
    mode: AclMode;
}

export interface KvPublicSubject extends SubjectSpec<
    KvEventContext,
    ProjectedKvEvent
> {
    family: 'kv';
}

export interface NotifPublicSubject extends SubjectSpec<
    NotifEventContext,
    ProjectedNotifEvent
> {
    family: 'notif';
}

export type PublicSubject =
    | FsPublicSubject
    | KvPublicSubject
    | NotifPublicSubject;

export interface UnpublishedInternalEvent {
    event: EventKey;
    reason: string;
}

// -- FS projections ---------------------------------------------------

// Dispatch walks up, so a folder subscription is stored under that folder's
// uid alone and a deep write still matches. A move also walks up the chain it
// left, or the folder it left would never see the node go.
const fsTokens = (event: FsEventContext): string[] => [
    ...new Set([
        fsAnchorToken(event.entry.uid),
        ...event.ancestors.map((ancestor) => fsAnchorToken(ancestor.uid)),
        ...(event.movedFrom?.ancestors.map((ancestor) =>
            fsAnchorToken(ancestor.uid),
        ) ?? []),
    ]),
];

const fsMatchOn = (event: FsEventContext): string => event.entry.path;

/** No human-facing projection, so nothing is push-eligible yet. */
const NOT_PUSHABLE: NotifyProjection<never> | null = null;

const fsProject =
    (op: FsOp) =>
    (delivery: FsDeliveryContext): ProjectedFsEvent => ({
        id: delivery.id,
        subject: `fs:${delivery.entry.uid}:${op}`,
        op,
        uid: delivery.entry.uid,
        path: delivery.entry.path,
        ...(delivery.movedFrom ? { from: delivery.movedFrom.path } : {}),
        self: delivery.self,
        ts: delivery.ts,
        seq: delivery.seq,
    });

// -- KV projections ---------------------------------------------------

// The exact key first, then its prefixes: a key-level subscription and a
// prefix-level one are different tokens, which is what makes `kv:<app>:cart`
// mean the key and `kv:<app>:cart:*` mean everything under it.
const kvTokens = (event: KvEventContext): string[] =>
    kvAnchorTokens(event.userUuid, event.appUid, event.kvKey);

const kvMatchOn = (event: KvEventContext): string => event.kvKey;

// A KV filter is written against the whole key rather than a suffix of it, so
// the anchor prefix does not narrow what the pattern sees.
const kvMatchScope = (_anchorPath: string, key: string): string => key;

const kvProject = (delivery: KvDeliveryContext): ProjectedKvEvent => ({
    id: delivery.id,
    subject: `kv:${delivery.appUid}:${delivery.kvKey}`,
    op: delivery.op,
    key: delivery.kvKey,
    self: delivery.self,
    ts: delivery.ts,
    seq: delivery.seq,
});

// -- Notification projections -----------------------------------------

/** The mailbox is the anchor; which slice of it a row wants is the filter. */
const notifTokens = (event: NotifEventContext): string[] => [
    notifAnchorToken(event.userUuid),
];

const notifMatchTarget = (event: NotifEventContext): string =>
    notifMatchOn(event.appUid ?? event.userUuid, event.audience);

const notifMatchScope = (_anchorPath: string, slice: string): string => slice;

const notifProject = (delivery: NotifDeliveryContext): ProjectedNotifEvent => ({
    id: delivery.uid,
    subject: `notif:${delivery.appUid ?? delivery.userUuid}:${delivery.audience}`,
    op: 'post',
    uid: delivery.uid,
    type: delivery.type,
    audience: delivery.audience,
    appUid: delivery.appUid,
    notification: delivery.notification,
    self: delivery.self,
    ts: delivery.ts,
    seq: delivery.seq,
});

// -- Registry ---------------------------------------------------------

export const PUBLIC_SUBJECTS = [
    {
        family: 'fs',
        subject: 'fs:*:write',
        internal: ['fs.write.file'],
        mode: 'list',
        tokens: fsTokens,
        matchOn: fsMatchOn,
        matchSeparator: '/',
        matchScope: relativeTo,
        project: fsProject('write'),
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
    {
        family: 'fs',
        subject: 'fs:*:add',
        internal: ['fs.create.file', 'fs.create.directory'],
        mode: 'list',
        tokens: fsTokens,
        matchOn: fsMatchOn,
        matchSeparator: '/',
        matchScope: relativeTo,
        project: fsProject('add'),
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
    {
        family: 'fs',
        subject: 'fs:*:move',
        internal: ['fs.move.node', 'fs.rename'],
        mode: 'list',
        tokens: fsTokens,
        matchOn: fsMatchOn,
        matchSeparator: '/',
        matchScope: relativeTo,
        project: fsProject('move'),
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
    {
        family: 'fs',
        subject: 'fs:*:remove',
        internal: ['fs.remove.node'],
        mode: 'list',
        tokens: fsTokens,
        matchOn: fsMatchOn,
        matchSeparator: '/',
        matchScope: relativeTo,
        project: fsProject('remove'),
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
    {
        family: 'kv',
        subject: 'kv:*',
        internal: ['kv.mutated'],
        tokens: kvTokens,
        matchOn: kvMatchOn,
        matchSeparator: KV_MATCH_SEPARATOR,
        matchScope: kvMatchScope,
        project: kvProject,
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
    {
        family: 'notif',
        subject: 'notif:*',
        internal: ['notif.created'],
        tokens: notifTokens,
        matchOn: notifMatchTarget,
        matchSeparator: NOTIF_MATCH_SEPARATOR,
        matchScope: notifMatchScope,
        project: notifProject,
        // The push seam fills this in; until then a notification is delivered
        // to what is connected, and found in the mailbox otherwise.
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
] as const satisfies readonly PublicSubject[];

export const UNPUBLISHED_INTERNAL_EVENTS = [
    {
        event: 'fs.copy.node',
        reason: 'Payload types its entries as `unknown` and carries S3 object keys; publishing the destination as `add` needs a typed payload first.',
    },
    {
        event: 'fs.create.shortcut',
        reason: 'A shortcut names another node, so the projection has to say whether `uid`/`path` describe the link or its target.',
    },
    {
        event: 'fs.create.symlink',
        reason: 'Same unresolved link-versus-target question as a shortcut.',
    },
    {
        event: 'fs.storage.upload-progress',
        reason: 'Progress ticks within one upload, not a committed change; the finished write publishes as `add` or `write`.',
    },
    {
        event: 'kv.flushed',
        reason: 'No subject addresses "the whole namespace went": the grammar anchors on a key or a prefix, and fanning a flush out per key would report keys a truncated enumeration never saw.',
    },
] as const satisfies readonly UnpublishedInternalEvent[];

// Every `fs.*`/`kv.*`/`notif.*` bus key needs a decision. A new key that is in
// neither list fails to compile here, naming itself in the error.
type AssertNever<T extends never> = T;
type SubscribableBusKey = Extract<
    EventKey,
    `fs.${string}` | `kv.${string}` | `notif.${string}`
>;
type DecidedBusKey =
    | (typeof PUBLIC_SUBJECTS)[number]['internal'][number]
    | (typeof UNPUBLISHED_INTERNAL_EVENTS)[number]['event'];
type _UndecidedBusKey = AssertNever<Exclude<SubscribableBusKey, DecidedBusKey>>;

// -- Lookup -----------------------------------------------------------

const byInternalKey = new Map<EventKey, PublicSubject>();
for (const entry of PUBLIC_SUBJECTS) {
    for (const key of entry.internal) byInternalKey.set(key, entry);
}

/** Fail-closed: no entry means the event publishes nothing. */
export const lookupPublicSubject = (key: EventKey): PublicSubject | undefined =>
    byInternalKey.get(key);

/** The FS entry for a bus key, or `undefined` for anything else. */
export const lookupFsSubject = (key: EventKey): FsPublicSubject | undefined => {
    const found = lookupPublicSubject(key);
    return found?.family === 'fs' ? found : undefined;
};

/** The KV entry for a bus key, or `undefined` for anything else. */
export const lookupKvSubject = (key: EventKey): KvPublicSubject | undefined => {
    const found = lookupPublicSubject(key);
    return found?.family === 'kv' ? found : undefined;
};

/** The notification entry for a bus key, or `undefined` for anything else. */
export const lookupNotifSubject = (
    key: EventKey,
): NotifPublicSubject | undefined => {
    const found = lookupPublicSubject(key);
    return found?.family === 'notif' ? found : undefined;
};

/** The push payload for an event, or `null` when the subject isn't pushable. */
export const pushProjection = <P extends ProjectedEvent>(
    subject: { notify: NotifyProjection<P> | null },
    event: P,
): PushMessage | null => subject.notify?.(event) ?? null;
