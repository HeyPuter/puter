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

import type { EventKey } from '../../clients/event/types.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { AclMode } from '../acl/ACLService.js';
import { fsAnchorToken, type FsOp } from './subjects.js';

/**
 * The one place an internal bus event becomes a public subject. Fail closed: an
 * event with no entry here publishes nothing, so internal payloads cannot leak
 * through a new emit site. Every `fs.*`/`kv.*` key is either registered or
 * listed in `UNPUBLISHED_INTERNAL_EVENTS` with a reason.
 */

// -- Types ------------------------------------------------------------

export type DeliveryClass = 'broadcast' | 'single';

/** What subscribers receive. Additive only — puter.js ships unversioned. */
export interface ProjectedEvent {
    id: string;
    subject: string;
    op: FsOp;
    uid: string;
    path: string;
    /** True when the acting user is the subscription holder. */
    self: boolean;
    ts: number;
    seq: number;
}

/** What dispatch knows about one internal emit, before it picks subscribers. */
export interface EventContext {
    key: EventKey;
    entry: FSEntry;
    /** Ancestor uids of `entry`, deepest first. */
    ancestorUids: readonly string[];
    id: string;
    ts: number;
}

/** `EventContext` plus the fields that only exist per subscription. */
export interface DeliveryContext extends EventContext {
    self: boolean;
    seq: number;
}

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
export type NotifyProjection = (event: ProjectedEvent) => PushMessage | null;

export interface PublicSubject {
    subject: string;
    internal: readonly EventKey[];
    /** ACL mode required to subscribe to the anchor. */
    mode: AclMode;
    tokens: (event: EventContext) => string[];
    /** What a match filter globs against. */
    matchOn: (event: EventContext) => string;
    project: (delivery: DeliveryContext) => ProjectedEvent;
    notify: NotifyProjection | null;
    defaultDelivery: DeliveryClass;
}

export interface UnpublishedInternalEvent {
    event: EventKey;
    reason: string;
}

// -- FS projections ---------------------------------------------------

// Dispatch walks up, so a folder subscription is stored under that folder's
// uid alone and a deep write still matches.
const fsTokens = (event: EventContext): string[] => [
    fsAnchorToken(event.entry.uid),
    ...event.ancestorUids.map(fsAnchorToken),
];

const fsMatchOn = (event: EventContext): string => event.entry.path;

/** No human-facing projection, so nothing under FS is push-eligible yet. */
const NOT_PUSHABLE: NotifyProjection | null = null;

const fsProject =
    (op: FsOp) =>
    (delivery: DeliveryContext): ProjectedEvent => ({
        id: delivery.id,
        subject: `fs:${delivery.entry.uid}:${op}`,
        op,
        uid: delivery.entry.uid,
        path: delivery.entry.path,
        self: delivery.self,
        ts: delivery.ts,
        seq: delivery.seq,
    });

// -- Registry ---------------------------------------------------------

export const PUBLIC_SUBJECTS = [
    {
        subject: 'fs:*:write',
        internal: ['fs.write.file'],
        mode: 'list',
        tokens: fsTokens,
        matchOn: fsMatchOn,
        project: fsProject('write'),
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
    {
        subject: 'fs:*:add',
        internal: ['fs.create.file', 'fs.create.directory'],
        mode: 'list',
        tokens: fsTokens,
        matchOn: fsMatchOn,
        project: fsProject('add'),
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
    {
        subject: 'fs:*:move',
        internal: ['fs.move.node', 'fs.rename'],
        mode: 'list',
        tokens: fsTokens,
        matchOn: fsMatchOn,
        project: fsProject('move'),
        notify: NOT_PUSHABLE,
        defaultDelivery: 'broadcast',
    },
    {
        subject: 'fs:*:remove',
        internal: ['fs.remove.node'],
        mode: 'list',
        tokens: fsTokens,
        matchOn: fsMatchOn,
        project: fsProject('remove'),
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
] as const satisfies readonly UnpublishedInternalEvent[];

// Every `fs.*`/`kv.*` bus key needs a decision. A new key that is in neither
// list fails to compile here, naming itself in the error.
type AssertNever<T extends never> = T;
type SubscribableBusKey = Extract<EventKey, `fs.${string}` | `kv.${string}`>;
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

/** The push payload for an event, or `null` when the subject isn't pushable. */
export const pushProjection = (
    subject: PublicSubject,
    event: ProjectedEvent,
): PushMessage | null => subject.notify?.(event) ?? null;
